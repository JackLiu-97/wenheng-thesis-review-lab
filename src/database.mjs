import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dimensions,standard} from './standards.mjs';
import {defaultPrompts,focusText,legacyDefaultFocus,defaultFocus} from './prompts.mjs';
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const encode=v=>JSON.stringify(v??null);
const decode=(v,fallback=null)=>v==null?fallback:JSON.parse(v);
const fail=(status,message)=>Object.assign(Error(message),{status});
const stageNames={parsing:'解析论文',reviewing:'六维度评审',synthesizing:'综合评议'};

export function openDatabase(filename){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
 const db=new Database(filename);
 db.pragma('foreign_keys = ON');db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 5000');
 try{
  const directory=fileURLToPath(new URL('../migrations/',import.meta.url));
  const files=fs.readdirSync(directory).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
  for(const file of files){const version=Number(file.split('_')[0]),migration=fs.readFileSync(path.join(directory,file),'utf8'),checksum=crypto.createHash('sha256').update(migration).digest('hex');
   const hasTable=db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get();const applied=hasTable?db.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(version):null;
   if(applied){if(applied.checksum!==checksum)throw Error('数据库迁移校验不一致，不能修改已应用的迁移文件：'+file);}
   else db.transaction(()=>{db.exec(migration);db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(version,checksum,now());})();
  }
  if(db.prepare('SELECT max(version) n FROM schema_migrations').get().n>Math.max(...files.map(f=>Number(f.split('_')[0]))))throw Error('数据库版本高于本程序，请使用匹配版本');
  return new Repository(db);
 }catch(error){db.close();throw error;}
}

export class Repository{
 constructor(db){this.db=db;}
 close(){this.db.close();}
 transaction(fn){return this.db.transaction(fn)();}
 insert(table,row){const keys=Object.keys(row);this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]??null));return row;}
 meta(key){return this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value;}
 setMeta(key,value){this.db.prepare('INSERT INTO app_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
 seedStandard(){const s=standard,existing=this.db.prepare('SELECT * FROM standard_versions WHERE id=?').get(s.id),payload={rubric_json:encode(s.rubric),degree_profiles_json:encode(s.degree_profiles),discipline_profiles_json:encode(s.discipline_profiles),scoring_rules_json:encode(s.scoring_rules)};if(existing&&Object.keys(payload).some(k=>existing[k]!==payload[k]))throw Error('系统标准内容已变更，必须发布新的标准版本');this.db.prepare('INSERT OR IGNORE INTO standard_versions VALUES (?,?,?,?,?,?,?,?,?)').run(s.id,s.key,s.version,s.name,...Object.values(payload),now());}
 user(row){return row?{id:row.id,username:row.username,phone:row.phone,created_at:row.created_at,credentials:{hash:row.password_hash,salt:row.password_salt}}:null;}
 userByName(name){return this.user(this.db.prepare('SELECT * FROM users WHERE username_normalized=?').get(name.toLowerCase()));}
 userById(userId){return this.user(this.db.prepare('SELECT * FROM users WHERE id=?').get(userId));}
 createUser(user){return this.transaction(()=>{
  if(this.userByName(user.username))throw fail(409,'用户名已被注册');
  const first=this.db.prepare('SELECT count(*) n FROM users').get().n===0;
  this.insert('users',{id:user.id,username:user.username,username_normalized:user.username.toLowerCase(),phone:user.phone,password_hash:user.credentials.hash,password_salt:user.credentials.salt,created_at:user.created_at});
  const prompts=first?this.prompts(null):defaultPrompts();this.importPrompts(user.id,prompts);
  if(first){this.db.prepare('UPDATE papers SET owner_id=? WHERE owner_id IS NULL').run(user.id);this.db.prepare('UPDATE review_tasks SET owner_id=? WHERE owner_id IS NULL').run(user.id);}
  return user;
 });}
 addSession(hash,userId,expires){this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());this.insert('sessions',{token_hash:hash,user_id:userId,expires_at:expires,created_at:now()});}
 sessionUser(hash){const s=this.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash,Date.now());return s?this.userById(s.user_id):null;}
 deleteSession(hash){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);}
 changePassword(userId,credentials){this.transaction(()=>{this.db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(credentials.hash,credentials.salt,userId);this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);});}
 prompts(owner){const rows=this.db.prepare('SELECT * FROM prompt_versions WHERE owner_id IS ? ORDER BY version').all(owner);return dimensions.map((_,i)=>{const versions=rows.filter(r=>r.dimension_code===`d${i+1}`).map(r=>({version:r.version,text:r.text,note:r.note,kind:r.kind,date:r.created_at}));return versions.length?versions:defaultPrompts()[i];});}
 importPrompts(owner,prompts){prompts.forEach((versions,i)=>{for(const p of versions)this.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:p.version,text:p.text,note:p.note||'',kind:p.kind||null,created_at:p.date||now()});const latest=versions.at(-1);if(latest&&latest.kind!=='focus')this.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:Math.max(...versions.map(p=>p.version))+1,text:focusText(latest,i),note:'保留历史，迁移为补充重点',kind:'focus',created_at:now()});});}
 // Accounts whose latest prompt is still the old one-line default move to the current default; edited prompts are left alone.
 upgradeDefaultPrompts(){return this.transaction(()=>{let upgraded=0;const owners=this.db.prepare('SELECT DISTINCT owner_id FROM prompt_versions').all().map(r=>r.owner_id),next=defaultFocus();
  for(const owner of owners)this.prompts(owner).forEach((versions,i)=>{const latest=versions.at(-1);if(latest.kind!=='focus'||latest.text.trim()!==legacyDefaultFocus[i])return;
   this.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${i+1}`,version:latest.version+1,text:next[i],note:'系统默认评审提示词升级',kind:'focus',created_at:now()});upgraded++;});
  return upgraded;});}
 appendPrompt(owner,index,input){return this.transaction(()=>{if(!Number.isInteger(index)||index<0||index>5||typeof input?.text!=='string'||!input.text.trim()||input.text.length>20000)throw fail(400,'无效的维度或提示词');if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>500))throw fail(400,'版本说明不得超过 500 字符');const latest=this.prompts(owner)[index].at(-1);if(input.base_version!==latest.version)throw fail(409,'该维度已有更新，请先载入最新版本；草稿仍保留');const p={version:latest.version+1,text:input.text.trim(),note:input.note?.trim()||'更新评审提示词',kind:'focus',date:now()};this.insert('prompt_versions',{id:id(),owner_id:owner,dimension_code:`d${index+1}`,version:p.version,text:p.text,note:p.note,kind:p.kind,created_at:p.date});return p;});}
 paper(paperId,owner){return this.db.prepare('SELECT * FROM papers WHERE id=? AND owner_id=?').get(paperId,owner);}
 createVersion({owner,paperId,filename,storagePath,metadata,bytes,versionId=id(),createdAt=now()}){return this.transaction(()=>{
  if(paperId&&!this.paper(paperId,owner))throw fail(404,'论文不存在');
  if(!paperId){paperId=id();this.insert('papers',{id:paperId,owner_id:owner,title:metadata?.title||filename,created_at:createdAt,updated_at:createdAt});}
  const n=this.db.prepare('SELECT coalesce(max(version_no),0)+1 n FROM paper_versions WHERE paper_id=?').get(paperId).n;
  this.insert('paper_versions',{id:versionId,paper_id:paperId,version_no:n,original_filename:filename,storage_path:storagePath,sha256:bytes?crypto.createHash('sha256').update(bytes).digest('hex'):null,size_bytes:bytes?.length??null,metadata_json:encode(metadata),created_at:createdAt});
  this.db.prepare('UPDATE papers SET updated_at=? WHERE id=?').run(createdAt,paperId);return this.version(versionId);
 });}
 version(versionId){const row=this.db.prepare('SELECT v.*,p.owner_id FROM paper_versions v JOIN papers p ON p.id=v.paper_id WHERE v.id=?').get(versionId);return row?{...row,metadata:decode(row.metadata_json)}:null;}
 createTask(task){this.insert('review_tasks',{id:task.id,owner_id:task.owner_id,paper_version_id:task.paper_version_id,parent_run_id:task.parent_run_id||null,provider:task.provider,model:task.model,status:task.status||'queued',stage:task.stage||'queued',request_snapshot_json:encode(task.request),checkpoint_json:null,error:task.error||null,message:task.message||'已加入评审队列',progress:task.progress||0,created_at:task.created_at||now(),started_at:null,finished_at:null});this.logEvent(task.id,task.stage||'queued','info',task.message||'已加入评审队列');return this.task(task.id);}
 task(taskId,owner){const row=this.db.prepare(`SELECT t.*,v.original_filename filename FROM review_tasks t LEFT JOIN paper_versions v ON v.id=t.paper_version_id WHERE t.id=?${owner===undefined?'':' AND t.owner_id=?'}`).get(...(owner===undefined?[taskId]:[taskId,owner]));if(!row)return null;const run=this.db.prepare('SELECT id FROM review_runs WHERE task_id=?').get(taskId);return {...row,task_id:row.id,request:decode(row.request_snapshot_json,{}),checkpoint:decode(row.checkpoint_json),run_id:run?.id};}
 tasks(owner){return this.db.prepare('SELECT id FROM review_tasks WHERE owner_id=? AND dismissed_at IS NULL ORDER BY created_at').all(owner).map(r=>this.task(r.id,owner));}
 updateTask(taskId,changes){const allowed=['status','stage','error','message','progress','started_at','finished_at','checkpoint_json','stage_started_at'];const data=Object.fromEntries(Object.entries(changes).filter(([k])=>allowed.includes(k)));const keys=Object.keys(data);if(!keys.length)return;
  const before=this.db.prepare('SELECT status,stage,message,error FROM review_tasks WHERE id=?').get(taskId);
  this.db.prepare(`UPDATE review_tasks SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`).run(...keys.map(k=>data[k]),taskId);
  if(!before)return;const stage=data.stage??before.stage;
  // Log only what a reader would care about: new messages, new errors and the final outcome.
  if(data.error&&data.error!==before.error)this.logEvent(taskId,stage,'error',data.error);
  else if(data.message&&data.message!==before.message)this.logEvent(taskId,stage,data.status==='succeeded'?'success':data.status==='failed'?'error':'info',data.message);
 }
 logEvent(taskId,stage,level,message){this.db.prepare('INSERT INTO task_events (task_id,created_at,stage,level,message) VALUES (?,?,?,?,?)').run(taskId,now(),stage||null,level,String(message).slice(0,2000));}
 // Recorded events; tasks from before event logging get a log rebuilt from their attempts.
 taskLog(taskId,limit=300){
  const events=this.db.prepare('SELECT created_at,stage,level,message FROM task_events WHERE task_id=? ORDER BY id DESC LIMIT ?').all(taskId,limit).reverse();
  if(events.length)return events;
  const task=this.db.prepare('SELECT * FROM review_tasks WHERE id=?').get(taskId);if(!task)return [];
  const log=[{created_at:task.created_at,stage:'queued',level:'info',message:'已加入评审队列'}];
  for(const a of this.db.prepare('SELECT * FROM review_attempts WHERE task_id=? ORDER BY started_at').all(taskId)){
   log.push({created_at:a.started_at,stage:a.stage,level:'info',message:`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用开始`});
   if(a.finished_at)log.push({created_at:a.finished_at,stage:a.stage,level:a.status==='succeeded'?'success':'error',message:a.status==='succeeded'?`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用完成`:`${stageNames[a.stage]||a.stage}：第 ${a.attempt_no} 次模型调用${a.status==='interrupted'?'被中断':'失败'}${a.error?'：'+a.error:''}`});
  }
  if(task.status==='succeeded')log.push({created_at:task.finished_at||task.created_at,stage:'completed',level:'success',message:task.message||'评审完成'});
  else if(task.error&&!log.some(e=>e.message.endsWith(task.error)))log.push({created_at:task.finished_at||task.created_at,stage:task.stage,level:'error',message:task.error});
  return log;
 }
 dismissTask(taskId,owner){const task=this.task(taskId,owner);if(!task)throw fail(404,'任务不存在');if(!['failed','interrupted'].includes(task.status))throw fail(409,'仅失败或中断的任务可以移除');this.db.prepare('UPDATE review_tasks SET dismissed_at=? WHERE id=?').run(now(),taskId);}
 // Recent successful durations (seconds) of a model stage; used to estimate remaining time.
 stageDurations(stage,model,limit=20){const query=sameModel=>this.db.prepare(`SELECT (julianday(a.finished_at)-julianday(a.started_at))*86400 seconds FROM review_attempts a JOIN review_tasks t ON t.id=a.task_id WHERE a.stage=? AND a.status='succeeded' AND a.finished_at IS NOT NULL${sameModel?' AND t.model=?':''} ORDER BY a.started_at DESC LIMIT ?`).all(...(sameModel?[stage,model,limit]:[stage,limit])).map(r=>r.seconds).filter(n=>Number.isFinite(n)&&n>0);const own=model?query(true):[];return own.length?own:query(false);}
 runningAttempt(taskId){return this.db.prepare("SELECT stage,attempt_no,started_at FROM review_attempts WHERE task_id=? AND status='running' ORDER BY started_at DESC LIMIT 1").get(taskId)||null;}
 queuePosition(taskId,createdAt){return this.db.prepare("SELECT count(*) n FROM review_tasks WHERE id<>? AND (status='running' OR (status='queued' AND created_at<?))").get(taskId,createdAt).n;}
 recover(){this.transaction(()=>{for(const t of this.db.prepare("SELECT id,stage FROM review_tasks WHERE status='running'").all())this.logEvent(t.id,t.stage,'error','服务重启，任务已中断；可从已完成阶段重试');this.db.prepare("UPDATE review_tasks SET status='interrupted',error='服务重启，任务已中断；可从已完成阶段重试',message='任务已中断' WHERE status='running'").run();this.db.prepare("UPDATE review_attempts SET status='interrupted',finished_at=? WHERE status='running'").run(now());this.db.prepare("UPDATE report_files SET status='failed',error='报告生成被中断，可单独重试' WHERE status='generating'").run();});return this.db.prepare("SELECT id FROM review_tasks WHERE status='queued' ORDER BY created_at").all().map(t=>t.id);}
 saveParse(versionId,parsed,artifactPath,parser='MinerU'){
  return this.transaction(()=>{const parseId=id();const blocks=parsed.blocks||[];const count=parsed.pageSizes?.length||Math.max(1,...blocks.map(b=>b.page));
   this.insert('parse_results',{id:parseId,paper_version_id:versionId,parser,parser_version:process.env.MINERU_MODEL_VERSION||'vlm',status:'ready',page_count:count,page_sizes_json:encode(parsed.pageSizes||[]),coordinate_system_json:encode(parsed.coordinateSize||[1000,1000]),artifact_path:artifactPath,error:null,created_at:now()});
   for(const [i,b] of blocks.entries())this.insert('document_blocks',{id:`${parseId}:${b.id}`,parse_result_id:parseId,source_block_id:b.id,sequence_no:i,page_no:b.page,block_type:b.type||'text',text:b.text,bbox_json:encode(b.bbox)});
   return this.parse(parseId);
  });
 }
 parse(parseId){const row=this.db.prepare('SELECT * FROM parse_results WHERE id=?').get(parseId);if(!row)return null;return {...row,pageSizes:decode(row.page_sizes_json,[]),coordinateSize:decode(row.coordinate_system_json,[1000,1000]),blocks:this.db.prepare('SELECT * FROM document_blocks WHERE parse_result_id=? ORDER BY sequence_no').all(parseId).map(b=>({id:b.source_block_id,type:b.block_type,page:b.page_no,text:b.text,bbox:decode(b.bbox_json)}))};}
 latestParse(versionId){const row=this.db.prepare("SELECT id FROM parse_results WHERE paper_version_id=? AND status='ready' ORDER BY created_at DESC LIMIT 1").get(versionId);return row?this.parse(row.id):null;}
 attempt(taskId,stage,inputPath){const n=this.db.prepare('SELECT coalesce(max(attempt_no),0)+1 n FROM review_attempts WHERE task_id=? AND stage=?').get(taskId,stage).n;const row={id:id(),task_id:taskId,stage,attempt_no:n,status:'running',input_path:inputPath,output_path:null,error:null,started_at:now(),finished_at:null};this.insert('review_attempts',row);this.logEvent(taskId,stage,'info',`${stageNames[stage]||stage}：第 ${n} 次模型调用开始`);return row;}
 finishAttempt(attemptId,status,outputPath,error=null){this.db.prepare('UPDATE review_attempts SET status=?,output_path=?,error=?,finished_at=? WHERE id=?').run(status,outputPath,error,now(),attemptId);
  const a=this.db.prepare('SELECT task_id,stage,attempt_no,started_at,finished_at FROM review_attempts WHERE id=?').get(attemptId);if(!a)return;
  const seconds=Math.max(0,Math.round((new Date(a.finished_at)-new Date(a.started_at))/1000)),name=stageNames[a.stage]||a.stage;
  this.logEvent(a.task_id,a.stage,status==='succeeded'?'success':'warning',status==='succeeded'?`${name}：第 ${a.attempt_no} 次模型调用完成，用时 ${seconds} 秒`:`${name}：第 ${a.attempt_no} 次模型调用失败（用时 ${seconds} 秒）${error?'：'+error:''}`);
 }
 saveRun(taskId,parseId,result,{runId=taskId,createdAt=now(),legacy=false}={}){return this.transaction(()=>{
  this.insert('review_runs',{id:runId,task_id:taskId,parse_result_id:parseId,result_schema_version:legacy?1:2,overall_summary:result.overall_summary||null,strengths_json:encode(result.strengths||[]),limitations_json:encode(result.limitations||[]),revision_plan_json:encode(result.revision_plan||[]),recommendation_reason:result.recommendation_reason||null,total_score:result.total_score??null,grade:result.grade||null,recommendation:result.recommendation||null,assessment_status:legacy?'legacy':result.assessment_status,compliance_json:result.compliance?encode(result.compliance.map(({evidence,...c})=>c)):null,created_at:createdAt});
  for(const [i,r] of result.reviews.entries()){
   const dimId=`${runId}:d${i+1}`;this.insert('dimension_reviews',{id:dimId,run_id:runId,dimension_code:`d${i+1}`,summary:r.summary||'',assessment_status:r.assessment_status||(legacy?'legacy':'assessed'),score:r.score??null,weight:r.weight??null,score_reason:r.score_reason||null,criteria_json:encode(r.criteria||[])});
   for(const [n,issue] of (r.issues||[]).entries()){
    const issueId=issue.id||`${runId}-${i+1}-${n+1}`;this.insert('review_issues',{id:issueId,dimension_review_id:dimId,criterion_code:issue.criterion_code||null,severity:issue.severity,title:issue.title,detail:issue.detail,suggestion:issue.suggestion,evidence_status:issue.evidence_status||(issue.evidence_ids?.length?'located':'unlocated'),sequence_no:n});
    for(const [k,blockId] of [...new Set(issue.evidence_ids||issue.evidence?.map(e=>e.id)||[])].entries())this.insert('issue_evidence',{issue_id:issueId,block_id:`${parseId}:${blockId}`,sequence_no:k});
   }
  }return this.run(runId);
 });}
 run(runId,owner){const r=this.db.prepare(`SELECT r.* FROM review_runs r JOIN review_tasks t ON t.id=r.task_id WHERE r.id=?${owner===undefined?'':' AND t.owner_id=?'}`).get(...(owner===undefined?[runId]:[runId,owner]));if(!r)return null;
  const task=this.task(r.task_id),v=this.version(task.paper_version_id),parsed=this.parse(r.parse_result_id),byId=new Map(parsed.blocks.map(b=>[b.id,b]));
  const reviews=this.db.prepare('SELECT * FROM dimension_reviews WHERE run_id=? ORDER BY dimension_code').all(runId).map((d,i)=>({dimension:dimensions[i],dimension_code:d.dimension_code,summary:d.summary,assessment_status:d.assessment_status,score:d.score,weight:d.weight,score_reason:d.score_reason,criteria:decode(d.criteria_json,[]),issues:this.db.prepare('SELECT * FROM review_issues WHERE dimension_review_id=? ORDER BY sequence_no').all(d.id).map(issue=>{const ids=this.db.prepare('SELECT b.source_block_id FROM issue_evidence e JOIN document_blocks b ON b.id=e.block_id WHERE issue_id=? ORDER BY e.sequence_no').all(issue.id).map(b=>b.source_block_id);return {id:issue.id,criterion_code:issue.criterion_code,severity:issue.severity,title:issue.title,detail:issue.detail,suggestion:issue.suggestion,evidence_status:issue.evidence_status,dimension:dimensions[i],dimension_index:i,evidence_ids:ids,evidence:ids.map(k=>byId.get(k))};})}));
  return {id:r.id,task_id:task.id,owner_id:task.owner_id,paper_id:v.paper_id,paper_version_id:v.id,version_no:v.version_no,parent_run_id:task.parent_run_id,filename:v.original_filename,created_at:r.created_at,provider:task.provider,model:task.model,metadata:task.request.metadata||null,standard_snapshot:task.request.standard||null,snapshots:task.request.snapshots||[],prompt_template_version:task.request.prompt_template_version||'legacy',result_schema_version:r.result_schema_version,source_pdf:`/api/runs/${r.id}/pdf`,page_count:parsed.page_count,page_sizes:parsed.pageSizes,coordinate_size:parsed.coordinateSize,blocks:parsed.blocks,reviews,total_score:r.total_score,grade:r.grade,recommendation:r.recommendation,assessment_status:r.assessment_status,overall_summary:r.overall_summary,strengths:decode(r.strengths_json,[]),limitations:decode(r.limitations_json,[]),revision_plan:decode(r.revision_plan_json,[]),recommendation_reason:r.recommendation_reason,compliance:decode(r.compliance_json)?.map(c=>({...c,evidence:c.evidence_ids.map(id=>byId.get(id)).filter(Boolean)}))??null,report:this.report(r.id)};
 }
 runs(owner,filters={}){const clauses=['t.owner_id=?'],values=[owner];if(filters.degree_type){clauses.push("json_extract(t.request_snapshot_json,'$.metadata.degree_type')=?");values.push(filters.degree_type);}if(filters.grade){clauses.push('r.grade LIKE ?');values.push(filters.grade+'%');}if(filters.q){clauses.push("(v.original_filename LIKE ? OR json_extract(t.request_snapshot_json,'$.metadata.major') LIKE ? OR json_extract(t.request_snapshot_json,'$.metadata.title') LIKE ?)");values.push(...Array(3).fill('%'+filters.q+'%'));}
  return this.db.prepare(`SELECT r.id,r.created_at,r.total_score,r.grade,r.recommendation,t.provider,t.model,t.request_snapshot_json,v.original_filename filename,v.paper_id,v.id paper_version_id,(SELECT count(*) FROM review_issues i JOIN dimension_reviews d ON d.id=i.dimension_review_id WHERE d.run_id=r.id) issue_count FROM review_runs r JOIN review_tasks t ON t.id=r.task_id JOIN paper_versions v ON v.id=t.paper_version_id WHERE ${clauses.join(' AND ')} ORDER BY r.created_at DESC`).all(...values).map(({request_snapshot_json,...r})=>({...r,metadata:decode(request_snapshot_json,{}).metadata||null,report:this.report(r.id)}));
 }
 report(runId){return this.db.prepare('SELECT * FROM report_files WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(runId)||null;}
 setReport(runId,templateVersion,status,details={}){this.db.prepare('INSERT INTO report_files (id,run_id,template_version,status,storage_path,sha256,generated_at,error) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(run_id,template_version) DO UPDATE SET status=excluded.status,storage_path=excluded.storage_path,sha256=excluded.sha256,generated_at=excluded.generated_at,error=excluded.error').run(id(),runId,templateVersion,status,details.path||null,details.sha256||null,details.generated_at||null,details.error||null);return this.report(runId);}
}
