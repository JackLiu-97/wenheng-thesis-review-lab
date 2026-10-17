import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dimensions,standard} from './standards.mjs';
import {defaultPrompts,focusText,legacyDefaultFocus,defaultFocus} from './prompts.mjs';
import {pricingTable} from './pricing.mjs';
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const encode=v=>JSON.stringify(v??null);
const decode=(v,fallback=null)=>v==null?fallback:JSON.parse(v);
const fail=(status,message)=>Object.assign(Error(message),{status});
const stageNames={parsing:'解析论文',reviewing:'六维度评审',synthesizing:'综合评议'};

// Connection settings come from MYSQL_* variables (see .env.example).
export function databaseConfig(env=process.env){
 return {host:env.MYSQL_HOST||'127.0.0.1',port:Number(env.MYSQL_PORT||3306),user:env.MYSQL_USER||'wenheng',password:env.MYSQL_PASSWORD||'',database:env.MYSQL_DATABASE||'wenheng'};
}
const poolOptions={charset:'utf8mb4',connectionLimit:8,decimalNumbers:true,supportBigNumbers:true,dateStrings:true,timezone:'Z',waitForConnections:true};

// Creates the database when the account may do so, then applies pending schema migrations.
export async function openDatabase(config=databaseConfig()){
 if(!config.database)throw Error('未配置 MYSQL_DATABASE');
 const admin=await mysql.createConnection({host:config.host,port:config.port,user:config.user,password:config.password,charset:'utf8mb4'});
 try{await admin.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);}
 catch(error){if(!['ER_DBACCESS_DENIED_ERROR','ER_ACCESS_DENIED_ERROR','ER_SPECIFIC_ACCESS_DENIED_ERROR'].includes(error.code))throw error;}
 finally{await admin.end();}
 const pool=mysql.createPool({...poolOptions,...config});
 try{await migrate(pool,config);return new Repository(pool);}
 catch(error){await pool.end();throw error;}
}
// Drops a database; used by tests and tooling only.
export async function dropDatabase(config){
 const admin=await mysql.createConnection({host:config.host,port:config.port,user:config.user,password:config.password});
 try{await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(config.database)}`);}finally{await admin.end();}
}
// Schema files run once each, in order; a changed file that was already applied is refused.
async function migrate(pool,config){
 const directory=fileURLToPath(new URL('../migrations/',import.meta.url));
 const files=fs.readdirSync(directory).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
 const conn=await mysql.createConnection({...config,charset:'utf8mb4',multipleStatements:true});
 try{
  const [[exists]]=await conn.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='schema_migrations'");
  const applied=new Map(exists.n?(await conn.query('SELECT version,checksum FROM schema_migrations'))[0].map(r=>[r.version,r.checksum]):[]);
  for(const file of files){
   const version=Number(file.split('_')[0]),sql=fs.readFileSync(path.join(directory,file),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex');
   if(applied.has(version)){if(applied.get(version)!==checksum)throw Error('数据库迁移校验不一致，不能修改已应用的迁移文件：'+file);continue;}
   // MySQL commits DDL implicitly, so a migration is recorded only after all of its statements succeed.
   await conn.query(sql);await conn.query('INSERT INTO schema_migrations (version,checksum,applied_at) VALUES (?,?,?)',[version,checksum,now()]);
  }
  const [[latest]]=await conn.query('SELECT max(version) n FROM schema_migrations');
  if(latest.n>Math.max(...files.map(f=>Number(f.split('_')[0]))))throw Error('数据库版本高于本程序，请使用匹配版本');
 }finally{await conn.end();}
}

export class Repository{
 constructor(pool,conn=null){this.pool=pool;this.conn=conn;}
 async close(){if(!this.conn)await this.pool.end();}
 async q(sql,params=[]){const [rows]=await (this.conn||this.pool).query(sql,params);return rows;}
 async one(sql,params=[]){return (await this.q(sql,params))[0]??null;}
 // Runs fn(tx) on one connection inside a transaction; nested calls join the outer transaction.
 async transaction(fn){
  if(this.conn)return fn(this);
  const conn=await this.pool.getConnection(),tx=new Repository(this.pool,conn);
  try{await conn.beginTransaction();const result=await fn(tx);await conn.commit();return result;}
  catch(error){try{await conn.rollback();}catch{}throw error;}
  finally{conn.release();}
 }
 async insert(table,row){const keys=Object.keys(row);await this.q(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]??null));return row;}
 async insertMany(table,rows,chunk=200){if(!rows.length)return;const keys=Object.keys(rows[0]);for(let i=0;i<rows.length;i+=chunk){const part=rows.slice(i,i+chunk);await this.q(`INSERT INTO ${table} (${keys.join(',')}) VALUES ${part.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',')}`,part.flatMap(r=>keys.map(k=>r[k]??null)));}}
 async count(table){return (await this.one(`SELECT count(*) n FROM ${table}`)).n;}
 async meta(key){return (await this.one('SELECT meta_value FROM app_meta WHERE meta_key=?',[key]))?.meta_value;}
 async setMeta(key,value){await this.transaction(async tx=>{if(await tx.one('SELECT 1 FROM app_meta WHERE meta_key=? FOR UPDATE',[key]))await tx.q('UPDATE app_meta SET meta_value=? WHERE meta_key=?',[String(value),key]);else await tx.insert('app_meta',{meta_key:key,meta_value:String(value)});});}
 async seedStandard(){
  const s=standard,existing=await this.one('SELECT * FROM standard_versions WHERE id=?',[s.id]),payload={rubric_json:encode(s.rubric),degree_profiles_json:encode(s.degree_profiles),discipline_profiles_json:encode(s.discipline_profiles),scoring_rules_json:encode(s.scoring_rules)};
  if(existing&&Object.keys(payload).some(k=>existing[k]!==payload[k]))throw Error('系统标准内容已变更，必须发布新的标准版本');
  await this.q('INSERT IGNORE INTO standard_versions (id,standard_key,version,name,rubric_json,degree_profiles_json,discipline_profiles_json,scoring_rules_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[s.id,s.key,s.version,s.name,...Object.values(payload),now()]);
 }
 user(row){return row?{id:row.id,username:row.username,phone:row.phone,created_at:row.created_at,credentials:{hash:row.password_hash,salt:row.password_salt}}:null;}
 async userByName(name){return this.user(await this.one('SELECT * FROM users WHERE username_normalized=?',[name.toLowerCase()]));}
 async userById(userId){return this.user(await this.one('SELECT * FROM users WHERE id=?',[userId]));}
 createUser(user){return this.transaction(async tx=>{
  if(await tx.userByName(user.username))throw fail(409,'用户名已被注册');
  const first=(await tx.one('SELECT count(*) n FROM users FOR UPDATE')).n===0;
  await tx.insert('users',{id:user.id,username:user.username,username_normalized:user.username.toLowerCase(),phone:user.phone,password_hash:user.credentials.hash,password_salt:user.credentials.salt,created_at:user.created_at});
  await tx.importPrompts(user.id,first?await tx.prompts(null):defaultPrompts());
  if(first){await tx.q('UPDATE papers SET owner_id=? WHERE owner_id IS NULL',[user.id]);await tx.q('UPDATE review_tasks SET owner_id=? WHERE owner_id IS NULL',[user.id]);}
  return user;
 });}
 async addSession(hash,userId,expires){await this.q('DELETE FROM sessions WHERE expires_at<=?',[Date.now()]);await this.insert('sessions',{token_hash:hash,user_id:userId,expires_at:expires,created_at:now()});}
 async sessionUser(hash){const s=await this.one('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',[hash,Date.now()]);return s?this.userById(s.user_id):null;}
 async deleteSession(hash){await this.q('DELETE FROM sessions WHERE token_hash=?',[hash]);}
 changePassword(userId,credentials){return this.transaction(async tx=>{await tx.q('UPDATE users SET password_hash=?,password_salt=? WHERE id=?',[credentials.hash,credentials.salt,userId]);await tx.q('DELETE FROM sessions WHERE user_id=?',[userId]);});}
 async prompts(owner){const rows=await this.q('SELECT * FROM prompt_versions WHERE owner_id<=>? ORDER BY version',[owner]);return dimensions.map((_,i)=>{const versions=rows.filter(r=>r.dimension_code===`d${i+1}`).map(r=>({version:r.version,text:r.text,note:r.note,kind:r.kind,date:r.created_at}));return versions.length?versions:defaultPrompts()[i];});}
 async importPrompts(owner,prompts){
  const rows=[];prompts.forEach((versions,i)=>{for(const p of versions)rows.push({id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:p.version,text:p.text,note:p.note||'',kind:p.kind||null,created_at:p.date||now()});const latest=versions.at(-1);if(latest&&latest.kind!=='focus')rows.push({id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:Math.max(...versions.map(p=>p.version))+1,text:focusText(latest,i),note:'保留历史，迁移为补充重点',kind:'focus',created_at:now()});});
  await this.insertMany('prompt_versions',rows);
 }
 // Accounts whose latest prompt is still the old one-line default move to the current default; edited prompts are left alone.
 upgradeDefaultPrompts(){return this.transaction(async tx=>{let upgraded=0;const owners=(await tx.q('SELECT DISTINCT owner_id FROM prompt_versions')).map(r=>r.owner_id),next=defaultFocus();
  for(const owner of owners)for(const [i,versions] of (await tx.prompts(owner)).entries()){const latest=versions.at(-1);if(latest.kind!=='focus'||latest.text.trim()!==legacyDefaultFocus[i])continue;
   await tx.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:latest.version+1,text:next[i],note:'系统默认评审提示词升级',kind:'focus',created_at:now()});upgraded++;}
  return upgraded;});}
 appendPrompt(owner,index,input){return this.transaction(async tx=>{
  if(!Number.isInteger(index)||index<0||index>5||typeof input?.text!=='string'||!input.text.trim()||input.text.length>20000)throw fail(400,'无效的维度或提示词');
  if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>500))throw fail(400,'版本说明不得超过 500 字符');
  // Lock this dimension's versions so two saves cannot both build on the same base.
  await tx.q('SELECT id FROM prompt_versions WHERE owner_id<=>? AND dimension_code=? FOR UPDATE',[owner,`d${index+1}`]);
  const latest=(await tx.prompts(owner))[index].at(-1);if(input.base_version!==latest.version)throw fail(409,'该维度已有更新，请先载入最新版本；草稿仍保留');
  const p={version:latest.version+1,text:input.text.trim(),note:input.note?.trim()||'更新评审提示词',kind:'focus',date:now()};
  await tx.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${index+1}`,version:p.version,text:p.text,note:p.note,kind:p.kind,created_at:p.date});return p;
 });}
 async paper(paperId,owner){return this.one('SELECT * FROM papers WHERE id=? AND owner_id=?',[paperId,owner]);}
 createVersion({owner,paperId,filename,storagePath,metadata,bytes,versionId=id(),createdAt=now()}){return this.transaction(async tx=>{
  if(paperId&&!await tx.paper(paperId,owner))throw fail(404,'论文不存在');
  if(!paperId){paperId=id();await tx.insert('papers',{id:paperId,owner_id:owner,title:metadata?.title||filename,created_at:createdAt,updated_at:createdAt});}
  const n=(await tx.one('SELECT coalesce(max(version_no),0)+1 n FROM paper_versions WHERE paper_id=? FOR UPDATE',[paperId])).n;
  await tx.insert('paper_versions',{id:versionId,paper_id:paperId,version_no:n,original_filename:filename,storage_path:storagePath,sha256:bytes?crypto.createHash('sha256').update(bytes).digest('hex'):null,size_bytes:bytes?.length??null,metadata_json:encode(metadata),created_at:createdAt});
  await tx.q('UPDATE papers SET updated_at=? WHERE id=?',[createdAt,paperId]);return tx.version(versionId);
 });}
 async version(versionId){const row=await this.one('SELECT v.*,p.owner_id FROM paper_versions v JOIN papers p ON p.id=v.paper_id WHERE v.id=?',[versionId]);return row?{...row,metadata:decode(row.metadata_json)}:null;}
 async createTask(task){
  await this.insert('review_tasks',{id:task.id,owner_id:task.owner_id,paper_version_id:task.paper_version_id,parent_run_id:task.parent_run_id||null,provider:task.provider,model:task.model,status:task.status||'queued',stage:task.stage||'queued',request_snapshot_json:encode(task.request),checkpoint_json:null,error:task.error||null,message:task.message||'已加入评审队列',progress:task.progress||0,created_at:task.created_at||now(),started_at:null,finished_at:null});
  await this.logEvent(task.id,task.stage||'queued','info',task.message||'已加入评审队列');return this.task(task.id);
 }
 taskRow(row){return row?{...row,task_id:row.id,request:decode(row.request_snapshot_json,{}),checkpoint:decode(row.checkpoint_json),run_id:row.run_id||undefined}:null;}
 static taskSelect='SELECT t.*,v.original_filename filename,r.id run_id FROM review_tasks t LEFT JOIN paper_versions v ON v.id=t.paper_version_id LEFT JOIN review_runs r ON r.task_id=t.id';
 async task(taskId,owner){return this.taskRow(await this.one(`${Repository.taskSelect} WHERE t.id=?${owner===undefined?'':' AND t.owner_id=?'}`,owner===undefined?[taskId]:[taskId,owner]));}
 async tasks(owner){return (await this.q(`${Repository.taskSelect} WHERE t.owner_id=? AND t.dismissed_at IS NULL ORDER BY t.created_at`,[owner])).map(r=>this.taskRow(r));}
 async updateTask(taskId,changes){
  const allowed=['status','stage','error','message','progress','started_at','finished_at','checkpoint_json','stage_started_at'];const data=Object.fromEntries(Object.entries(changes).filter(([k])=>allowed.includes(k)));const keys=Object.keys(data);if(!keys.length)return;
  const before=await this.one('SELECT status,stage,message,error FROM review_tasks WHERE id=?',[taskId]);
  await this.q(`UPDATE review_tasks SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>data[k]),taskId]);
  if(!before)return;const stage=data.stage??before.stage;
  // Log only what a reader would care about: new messages, new errors and the final outcome.
  if(data.error&&data.error!==before.error)await this.logEvent(taskId,stage,'error',data.error);
  else if(data.message&&data.message!==before.message)await this.logEvent(taskId,stage,data.status==='succeeded'?'success':data.status==='failed'?'error':'info',data.message);
 }
 async logEvent(taskId,stage,level,message){await this.q('INSERT INTO task_events (task_id,created_at,stage,level,message) VALUES (?,?,?,?,?)',[taskId,now(),stage||null,level,String(message).slice(0,2000)]);}
 // Recorded events; tasks from before event logging get a log rebuilt from their attempts.
 async taskLog(taskId,limit=300){
  const events=(await this.q('SELECT created_at,stage,level,message FROM task_events WHERE task_id=? ORDER BY id DESC LIMIT ?',[taskId,limit])).reverse();
  if(events.length)return events;
  const task=await this.one('SELECT * FROM review_tasks WHERE id=?',[taskId]);if(!task)return [];
  const log=[{created_at:task.created_at,stage:'queued',level:'info',message:'已加入评审队列'}];
  for(const a of await this.q('SELECT * FROM review_attempts WHERE task_id=? ORDER BY started_at',[taskId])){
   log.push({created_at:a.started_at,stage:a.stage,level:'info',message:`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用开始`});
   if(a.finished_at)log.push({created_at:a.finished_at,stage:a.stage,level:a.status==='succeeded'?'success':'error',message:a.status==='succeeded'?`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用完成`:`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用${a.status==='interrupted'?'被中断':'失败'}${a.error?'：'+a.error:''}`});
  }
  if(task.status==='succeeded')log.push({created_at:task.finished_at||task.created_at,stage:'completed',level:'success',message:task.message||'评审完成'});
  else if(task.error&&!log.some(e=>e.message.endsWith(task.error)))log.push({created_at:task.finished_at||task.created_at,stage:task.stage,level:'error',message:task.error});
  return log;
 }
 async dismissTask(taskId,owner){const task=await this.task(taskId,owner);if(!task)throw fail(404,'任务不存在');if(!['failed','interrupted'].includes(task.status))throw fail(409,'仅失败或中断的任务可以移除');await this.q('UPDATE review_tasks SET dismissed_at=? WHERE id=?',[now(),taskId]);}
 // Recent successful durations (seconds) of a model stage; used to estimate remaining time.
 async stageDurations(stage,model,limit=20){
  const query=async sameModel=>(await this.q(`SELECT a.started_at,a.finished_at FROM review_attempts a JOIN review_tasks t ON t.id=a.task_id WHERE a.stage=? AND a.status='succeeded' AND a.finished_at IS NOT NULL${sameModel?' AND t.model=?':''} ORDER BY a.started_at DESC LIMIT ?`,sameModel?[stage,model,limit]:[stage,limit])).map(r=>(new Date(r.finished_at)-new Date(r.started_at))/1000).filter(n=>Number.isFinite(n)&&n>0);
  const own=model?await query(true):[];return own.length?own:query(false);
 }
 async runningAttempt(taskId){return this.one("SELECT stage,attempt_no,started_at FROM review_attempts WHERE task_id=? AND status='running' ORDER BY started_at DESC LIMIT 1",[taskId]);}
 async queuePosition(taskId,createdAt){return (await this.one("SELECT count(*) n FROM review_tasks WHERE id<>? AND (status='running' OR (status='queued' AND created_at<?))",[taskId,createdAt])).n;}
 async recover(){
  await this.transaction(async tx=>{
   for(const t of await tx.q("SELECT id,stage FROM review_tasks WHERE status='running'"))await tx.logEvent(t.id,t.stage,'error','服务重启，任务已中断；可从已完成阶段重试');
   await tx.q("UPDATE review_tasks SET status='interrupted',error='服务重启，任务已中断；可从已完成阶段重试',message='任务已中断' WHERE status='running'");
   await tx.q("UPDATE review_attempts SET status='interrupted',finished_at=? WHERE status='running'",[now()]);
   await tx.q("UPDATE report_files SET status='failed',error='报告生成被中断，可单独重试' WHERE status='generating'");
  });
  return (await this.q("SELECT id FROM review_tasks WHERE status='queued' ORDER BY created_at")).map(t=>t.id);
 }
 saveParse(versionId,parsed,artifactPath,parser='MinerU'){return this.transaction(async tx=>{
  const parseId=id(),blocks=parsed.blocks||[],count=parsed.pageSizes?.length||Math.max(1,...blocks.map(b=>b.page));
  await tx.insert('parse_results',{id:parseId,paper_version_id:versionId,parser,parser_version:process.env.MINERU_MODEL_VERSION||'vlm',status:'ready',page_count:count,page_sizes_json:encode(parsed.pageSizes||[]),coordinate_system_json:encode(parsed.coordinateSize||[1000,1000]),artifact_path:artifactPath,error:null,created_at:now()});
  await tx.insertMany('document_blocks',blocks.map((b,i)=>({id:`${parseId}:${b.id}`,parse_result_id:parseId,source_block_id:b.id,sequence_no:i,page_no:b.page,block_type:b.type||'text',text:b.text,bbox_json:encode(b.bbox)})));
  return tx.parse(parseId);
 });}
 async parse(parseId){
  const row=await this.one('SELECT * FROM parse_results WHERE id=?',[parseId]);if(!row)return null;
  const blocks=(await this.q('SELECT * FROM document_blocks WHERE parse_result_id=? ORDER BY sequence_no',[parseId])).map(b=>({id:b.source_block_id,type:b.block_type,page:b.page_no,text:b.text,bbox:decode(b.bbox_json)}));
  return {...row,pageSizes:decode(row.page_sizes_json,[]),coordinateSize:decode(row.coordinate_system_json,[1000,1000]),blocks};
 }
 // A finished parse of a byte-identical PDF made with the current parser settings, if any.
 async reusableParse(sha256,parser='MinerU',parserVersion=process.env.MINERU_MODEL_VERSION||'vlm'){
  if(!sha256)return null;
  return this.one("SELECT p.id,v.original_filename FROM parse_results p JOIN paper_versions v ON v.id=p.paper_version_id WHERE v.sha256=? AND p.status='ready' AND p.parser=? AND p.parser_version<=>? AND EXISTS (SELECT 1 FROM document_blocks b WHERE b.parse_result_id=p.id) ORDER BY p.created_at DESC LIMIT 1",[sha256,parser,parserVersion]);
 }
 // Copies a parse onto another paper version so each upload keeps its own blocks and evidence links.
 cloneParse(sourceId,versionId){return this.transaction(async tx=>{
  const source=await tx.one('SELECT * FROM parse_results WHERE id=?',[sourceId]);if(!source)throw fail(404,'可复用的解析结果不存在');
  const parseId=id();await tx.insert('parse_results',{...source,id:parseId,paper_version_id:versionId,created_at:now()});
  await tx.q("INSERT INTO document_blocks (id,parse_result_id,source_block_id,sequence_no,page_no,block_type,text,bbox_json) SELECT CONCAT(?,':',source_block_id),?,source_block_id,sequence_no,page_no,block_type,text,bbox_json FROM document_blocks WHERE parse_result_id=?",[parseId,parseId,sourceId]);
  return tx.parse(parseId);
 });}
 async latestParse(versionId){const row=await this.one("SELECT id FROM parse_results WHERE paper_version_id=? AND status='ready' ORDER BY created_at DESC LIMIT 1",[versionId]);return row?this.parse(row.id):null;}
 attempt(taskId,stage,inputPath){return this.transaction(async tx=>{
  const n=(await tx.one('SELECT coalesce(max(attempt_no),0)+1 n FROM review_attempts WHERE task_id=? AND stage=? FOR UPDATE',[taskId,stage])).n;
  const row={id:id(),task_id:taskId,stage,attempt_no:n,status:'running',input_path:inputPath,output_path:null,error:null,started_at:now(),finished_at:null};
  await tx.insert('review_attempts',row);await tx.logEvent(taskId,stage,'info',`${stageNames[stage]||stage}：第 ${n} 次模型调用开始`);return row;
 });}
 // billing: token counts and cost from priceUsage, plus the raw provider usage; null when the call returned no usage.
 async finishAttempt(attemptId,status,outputPath,error=null,billing=null){
  await this.q('UPDATE review_attempts SET status=?,output_path=?,error=?,finished_at=?,input_tokens=?,cache_hit_tokens=?,output_tokens=?,reasoning_tokens=?,cost_usd=?,price_tier=?,usage_json=? WHERE id=?',
   [status,outputPath,error,now(),billing?.input_tokens??null,billing?.cache_hit_tokens??null,billing?.output_tokens??null,billing?.reasoning_tokens??null,billing?.cost_usd??null,billing?.price_tier??null,billing?.usage?encode(billing.usage):null,attemptId]);
  const a=await this.one('SELECT task_id,stage,attempt_no,started_at,finished_at FROM review_attempts WHERE id=?',[attemptId]);if(!a)return;
  const seconds=Math.max(0,Math.round((new Date(a.finished_at)-new Date(a.started_at))/1000)),name=stageNames[a.stage]||a.stage;
  const rate=pricingTable().usd_to_cny,usage=billing?.input_tokens!=null?`；输入 ${billing.input_tokens.toLocaleString('en-US')} / 输出 ${billing.output_tokens.toLocaleString('en-US')} token${billing.cost_usd!=null?`，约 ¥${(billing.cost_usd*rate).toFixed(3)}（$${billing.cost_usd.toFixed(4)}）`:''}`:'';
  await this.logEvent(a.task_id,a.stage,status==='succeeded'?'success':'warning',status==='succeeded'?`${name}：第 ${a.attempt_no} 次模型调用完成，用时 ${seconds} 秒${usage}`:`${name}：第 ${a.attempt_no} 次模型调用失败（用时 ${seconds} 秒${usage}）${error?'：'+error:''}`);
 }
 // A task and the failed tasks it was retried from (retry_of_task_id chain), newest first.
 async taskChain(taskId){
  const ids=[];let current=taskId;
  while(current&&!ids.includes(current)&&ids.length<20){ids.push(current);const row=await this.one('SELECT request_snapshot_json FROM review_tasks WHERE id=?',[current]);current=row?decode(row.request_snapshot_json,{}).retry_of_task_id:null;}
  return ids;
 }
 // Token and cost totals over every model call of the given tasks, failed and corrective calls included.
 async usageSummary(taskIds){
  const attempts=taskIds.length?await this.q(`SELECT task_id,stage,attempt_no,status,started_at,finished_at,input_tokens,cache_hit_tokens,output_tokens,reasoning_tokens,cost_usd,price_tier FROM review_attempts WHERE task_id IN (${taskIds.map(()=>'?').join(',')}) ORDER BY started_at`,taskIds):[];
  const sum=key=>attempts.reduce((n,a)=>n+(a[key]||0),0),recorded=attempts.filter(a=>a.input_tokens!=null);
  return {calls:attempts.length,failed_calls:attempts.filter(a=>a.status!=='succeeded').length,unrecorded_calls:attempts.length-recorded.length,unpriced_calls:recorded.filter(a=>a.cost_usd==null).length,
   input_tokens:sum('input_tokens'),cache_hit_tokens:sum('cache_hit_tokens'),output_tokens:sum('output_tokens'),reasoning_tokens:sum('reasoning_tokens'),cost_usd:Math.round(sum('cost_usd')*1e6)/1e6,usd_to_cny:pricingTable().usd_to_cny,attempts};
 }
 // Per-task totals for the task list (own calls only).
 async usageByTask(taskIds){
  if(!taskIds.length)return new Map();
  const rows=await this.q(`SELECT task_id,count(*) calls,sum(status<>'succeeded') failed_calls,sum(input_tokens IS NULL) unrecorded_calls,coalesce(sum(input_tokens),0) input_tokens,coalesce(sum(output_tokens),0) output_tokens,coalesce(sum(cost_usd),0) cost_usd FROM review_attempts WHERE task_id IN (${taskIds.map(()=>'?').join(',')}) GROUP BY task_id`,taskIds);
  return new Map(rows.map(r=>[r.task_id,{calls:Number(r.calls),failed_calls:Number(r.failed_calls),unrecorded_calls:Number(r.unrecorded_calls),input_tokens:Number(r.input_tokens),output_tokens:Number(r.output_tokens),cost_usd:Number(r.cost_usd)}]));
 }
 saveRun(taskId,parseId,result,{runId=taskId,createdAt=now(),legacy=false}={}){return this.transaction(async tx=>{
  await tx.insert('review_runs',{id:runId,task_id:taskId,parse_result_id:parseId,result_schema_version:legacy?1:2,overall_summary:result.overall_summary||null,strengths_json:encode(result.strengths||[]),limitations_json:encode(result.limitations||[]),revision_plan_json:encode(result.revision_plan||[]),recommendation_reason:result.recommendation_reason||null,total_score:result.total_score??null,grade:result.grade||null,recommendation:result.recommendation||null,assessment_status:legacy?'legacy':result.assessment_status,compliance_json:result.compliance?encode(result.compliance.map(({evidence,...c})=>c)):null,created_at:createdAt});
  const dims=[],issues=[],evidence=[];
  for(const [i,r] of result.reviews.entries()){
   const dimId=`${runId}:d${i+1}`;dims.push({id:dimId,run_id:runId,dimension_code:`d${i+1}`,summary:r.summary||'',assessment_status:r.assessment_status||(legacy?'legacy':'assessed'),score:r.score??null,weight:r.weight??null,score_reason:r.score_reason||null,criteria_json:encode(r.criteria||[])});
   for(const [n,issue] of (r.issues||[]).entries()){
    const issueId=issue.id||`${runId}-${i+1}-${n+1}`;issues.push({id:issueId,dimension_review_id:dimId,criterion_code:issue.criterion_code||null,severity:issue.severity,title:issue.title,detail:issue.detail,suggestion:issue.suggestion,evidence_status:issue.evidence_status||(issue.evidence_ids?.length?'located':'unlocated'),sequence_no:n});
    // Evidence ids are scoped to this run's parse, so evidence cannot point into another document.
    for(const [k,blockId] of [...new Set(issue.evidence_ids||issue.evidence?.map(e=>e.id)||[])].entries())evidence.push({issue_id:issueId,block_id:`${parseId}:${blockId}`,sequence_no:k});
   }
  }
  await tx.insertMany('dimension_reviews',dims);await tx.insertMany('review_issues',issues);await tx.insertMany('issue_evidence',evidence);
  return tx.run(runId);
 });}
 async run(runId,owner){
  const r=await this.one(`SELECT r.* FROM review_runs r JOIN review_tasks t ON t.id=r.task_id WHERE r.id=?${owner===undefined?'':' AND t.owner_id=?'}`,owner===undefined?[runId]:[runId,owner]);if(!r)return null;
  const task=await this.task(r.task_id),v=await this.version(task.paper_version_id),parsed=await this.parse(r.parse_result_id),byId=new Map(parsed.blocks.map(b=>[b.id,b]));
  const dims=await this.q('SELECT * FROM dimension_reviews WHERE run_id=? ORDER BY dimension_code',[runId]);
  const issueRows=await this.q('SELECT i.* FROM review_issues i JOIN dimension_reviews d ON d.id=i.dimension_review_id WHERE d.run_id=? ORDER BY i.dimension_review_id,i.sequence_no',[runId]);
  const evidenceRows=await this.q('SELECT e.issue_id,b.source_block_id FROM issue_evidence e JOIN review_issues i ON i.id=e.issue_id JOIN dimension_reviews d ON d.id=i.dimension_review_id JOIN document_blocks b ON b.id=e.block_id WHERE d.run_id=? ORDER BY e.issue_id,e.sequence_no',[runId]);
  const evidenceByIssue=new Map();for(const e of evidenceRows){if(!evidenceByIssue.has(e.issue_id))evidenceByIssue.set(e.issue_id,[]);evidenceByIssue.get(e.issue_id).push(e.source_block_id);}
  const reviews=dims.map((d,i)=>({dimension:dimensions[i],dimension_code:d.dimension_code,summary:d.summary,assessment_status:d.assessment_status,score:d.score,weight:d.weight,score_reason:d.score_reason,criteria:decode(d.criteria_json,[]),issues:issueRows.filter(x=>x.dimension_review_id===d.id).map(issue=>{const ids=evidenceByIssue.get(issue.id)||[];return {id:issue.id,criterion_code:issue.criterion_code,severity:issue.severity,title:issue.title,detail:issue.detail,suggestion:issue.suggestion,evidence_status:issue.evidence_status,dimension:dimensions[i],dimension_index:i,evidence_ids:ids,evidence:ids.map(k=>byId.get(k))};})}));
  return {id:r.id,task_id:task.id,owner_id:task.owner_id,paper_id:v.paper_id,paper_version_id:v.id,version_no:v.version_no,parent_run_id:task.parent_run_id,filename:v.original_filename,created_at:r.created_at,provider:task.provider,model:task.model,metadata:task.request.metadata||null,standard_snapshot:task.request.standard||null,snapshots:task.request.snapshots||[],prompt_template_version:task.request.prompt_template_version||'legacy',result_schema_version:r.result_schema_version,source_pdf:`/api/runs/${r.id}/pdf`,page_count:parsed.page_count,page_sizes:parsed.pageSizes,coordinate_size:parsed.coordinateSize,blocks:parsed.blocks,reviews,total_score:r.total_score,grade:r.grade,recommendation:r.recommendation,assessment_status:r.assessment_status,overall_summary:r.overall_summary,strengths:decode(r.strengths_json,[]),limitations:decode(r.limitations_json,[]),revision_plan:decode(r.revision_plan_json,[]),recommendation_reason:r.recommendation_reason,compliance:decode(r.compliance_json)?.map(c=>({...c,evidence:c.evidence_ids.map(id=>byId.get(id)).filter(Boolean)}))??null,usage:await this.usageSummary(await this.taskChain(task.id)),report:await this.report(r.id)};
 }
 async runs(owner,filters={}){
  const field=key=>`JSON_UNQUOTE(JSON_EXTRACT(t.request_snapshot_json,'$.metadata.${key}'))`;
  const clauses=['t.owner_id=?'],values=[owner];
  if(filters.degree_type){clauses.push(`${field('degree_type')}=?`);values.push(filters.degree_type);}
  if(filters.grade){clauses.push('r.grade LIKE ?');values.push(filters.grade+'%');}
  if(filters.q){clauses.push(`(v.original_filename LIKE ? OR ${field('major')} LIKE ? OR ${field('title')} LIKE ?)`);values.push(...Array(3).fill('%'+filters.q+'%'));}
  const rows=await this.q(`SELECT r.id,r.task_id,r.created_at,r.total_score,r.grade,r.recommendation,t.provider,t.model,t.request_snapshot_json,v.original_filename filename,v.paper_id,v.id paper_version_id,(SELECT count(*) FROM review_issues i JOIN dimension_reviews d ON d.id=i.dimension_review_id WHERE d.run_id=r.id) issue_count FROM review_runs r JOIN review_tasks t ON t.id=r.task_id JOIN paper_versions v ON v.id=t.paper_version_id WHERE ${clauses.join(' AND ')} ORDER BY r.created_at DESC`,values);
  return Promise.all(rows.map(async({request_snapshot_json,...r})=>{const {attempts,...usage}=await this.usageSummary(await this.taskChain(r.task_id));return {...r,metadata:decode(request_snapshot_json,{}).metadata||null,usage,report:await this.report(r.id)};}));
 }
 async report(runId){const row=await this.one('SELECT * FROM report_files WHERE run_id=? ORDER BY seq DESC LIMIT 1',[runId]);if(!row)return null;const {seq,...report}=row;return report;}
 async setReport(runId,templateVersion,status,details={}){
  const values={status,storage_path:details.path||null,sha256:details.sha256||null,generated_at:details.generated_at||null,error:details.error||null};
  await this.transaction(async tx=>{
   if(await tx.one('SELECT id FROM report_files WHERE run_id=? AND template_version=? FOR UPDATE',[runId,templateVersion]))await tx.q('UPDATE report_files SET status=?,storage_path=?,sha256=?,generated_at=?,error=? WHERE run_id=? AND template_version=?',[...Object.values(values),runId,templateVersion]);
   else await tx.insert('report_files',{id:id(),run_id:runId,template_version:templateVersion,...values});
  });
  return this.report(runId);
 }
}
