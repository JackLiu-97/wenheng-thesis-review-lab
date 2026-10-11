import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {openDatabase} from './database.mjs';
import {defaultPrompts} from './prompts.mjs';
import {dimensions} from './standards.mjs';

export function inspectLegacy(source,dataDir){
 const raw=fs.readFileSync(source);const store=JSON.parse(raw.toString('utf8'));
 if(!Array.isArray(store.runs)||!Array.isArray(store.prompts))throw Error('旧存储缺少 runs 或 prompts 数组');
 for(const key of ['runs','users','tasks']){const ids=(store[key]||[]).map(x=>x.id||x.task_id);if(ids.some(x=>!x)||new Set(ids).size!==ids.length)throw Error(`旧存储 ${key} 存在缺失或重复 ID`);}
 const userIds=new Set((store.users||[]).map(u=>u.id));
 for(const prompts of [store.prompts,...(store.users||[]).map(u=>u.prompts||defaultPrompts())]){
  if(prompts.length!==6||prompts.some(v=>!Array.isArray(v)||!v.length||v.some(p=>!Number.isInteger(p.version)||typeof p.text!=='string')||new Set(v.map(p=>p.version)).size!==v.length))throw Error('旧提示词版本结构无效');
 }
 for(const r of store.runs){
  if(r.owner_id&&!userIds.has(r.owner_id))throw Error('旧运行引用了不存在的用户');
  if(!Array.isArray(r.blocks)||new Set(r.blocks.map(b=>b.id)).size!==r.blocks.length)throw Error('旧运行文本块缺失或 ID 重复');
  if(r.reviews?.length!==6||r.reviews.some((d,i)=>d.dimension!==dimensions[i]))throw Error('旧运行评审维度缺失或顺序异常，需先检查原记录');
  const ids=new Set(r.blocks.map(b=>b.id));for(const issue of r.reviews.flatMap(d=>d.issues||[]))if((issue.evidence_ids||issue.evidence?.map(b=>b.id)||[]).some(id=>!ids.has(id)))throw Error('旧运行包含不存在的证据引用');
 }
 const files=new Map();const missing=[];
 for(const r of store.runs){
  const folder=path.join(dataDir,'runs',r.id);
  if(path.dirname(path.resolve(folder))!==path.resolve(dataDir,'runs'))throw Error('旧记录包含无效的文件目录');
  const filename=fs.existsSync(folder)?fs.readdirSync(folder).find(f=>f.toLowerCase().endsWith('.pdf')):null;
  const pdf=filename?path.join(folder,filename):path.join(folder,path.basename(r.filename||'missing.pdf'));
  if(!fs.existsSync(pdf))missing.push({run_id:r.id,filename:r.filename});
  files.set(r.id,pdf);
 }
 const allIssues=store.runs.flatMap(r=>(r.reviews||[]).flatMap(d=>d.issues||[]));
 const counts={users:store.users?.length||0,tasks:store.tasks?.length||0,runs:store.runs.length,issues:allIssues.length,evidence:allIssues.reduce((n,i)=>n+new Set(i.evidence_ids||i.evidence?.map(e=>e.id)||[]).size,0),missing_files:missing};
 return {store,files,counts,hash:crypto.createHash('sha256').update(raw).digest('hex')};
}

export function migrateLegacy({source,dataDir,target,dryRun=false}){
 const inspected=inspectLegacy(source,dataDir);const {store,files,counts,hash}=inspected;
 if(dryRun)return {mode:'dry-run',source,target,counts,source_sha256:hash};
 if(fs.existsSync(target)){
  const existing=openDatabase(target);try{if(existing.meta('legacy_sha256')===hash)return {mode:'already-migrated',counts};throw Error('目标数据库已存在且不属于本次旧存储迁移；不会覆盖');}finally{existing.close();}
 }
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const backup=source+'.before-sqlite-'+Date.now()+'.bak';fs.copyFileSync(source,backup,fs.constants.COPYFILE_EXCL);
 const temporary=target+'.migrating-'+crypto.randomUUID();const repo=openDatabase(temporary);
 try{
  repo.transaction(()=>{
   repo.importPrompts(null,store.prompts);repo.seedStandard();
   for(const u of store.users||[]){repo.insert('users',{id:u.id,username:u.username,username_normalized:u.username.toLowerCase(),phone:u.phone||'',password_hash:u.credentials.hash,password_salt:u.credentials.salt,created_at:u.created_at});repo.importPrompts(u.id,u.prompts||defaultPrompts());}
   for(const s of store.sessions||[])repo.addSession(s.hash,s.user_id,s.expires);
   const tasks=new Map((store.tasks||[]).map(t=>[t.task_id||t.id,t]));const imported=new Set();
   for(const r of store.runs){
    const pdf=files.get(r.id);const bytes=fs.existsSync(pdf)?fs.readFileSync(pdf):null;
    const version=repo.createVersion({owner:r.owner_id||null,filename:r.filename,storagePath:pdf,metadata:null,bytes,createdAt:r.created_at});
    const parsed=repo.saveParse(version.id,{blocks:r.blocks||[],pageSizes:r.page_sizes||[],coordinateSize:r.coordinate_size||[1000,1000]},path.dirname(pdf),'legacy');
    const oldTask=[...tasks.values()].find(t=>t.run_id===r.id)||tasks.get(r.id);const taskId=oldTask?.task_id||oldTask?.id||r.id;
    repo.createTask({id:taskId,owner_id:r.owner_id||oldTask?.owner_id||null,paper_version_id:version.id,provider:r.provider||'gpt',model:r.model||null,status:'succeeded',stage:'completed',created_at:oldTask?.created_at||r.created_at,progress:100,message:'历史评审已迁移',request:{snapshots:r.snapshots||[],metadata:null,standard:null,prompt_template_version:r.prompt_template_version||'legacy'}});
    repo.saveRun(taskId,parsed.id,{reviews:r.reviews||[]},{runId:r.id,createdAt:r.created_at,legacy:true});imported.add(taskId);
   }
   for(const [taskId,t] of tasks){if(imported.has(taskId))continue;repo.createTask({id:taskId,owner_id:t.owner_id||null,paper_version_id:null,provider:t.provider||'gpt',model:t.model||null,status:'failed',stage:'legacy',created_at:t.created_at,error:t.error||'旧任务缺少可恢复的提交文件，请重新提交',message:'历史任务已归档',progress:100,request:{legacy_task:t}});}
   const actual={users:repo.db.prepare('SELECT count(*) n FROM users').get().n,runs:repo.db.prepare('SELECT count(*) n FROM review_runs').get().n,issues:repo.db.prepare('SELECT count(*) n FROM review_issues').get().n,evidence:repo.db.prepare('SELECT count(*) n FROM issue_evidence').get().n};
   for(const key of Object.keys(actual))if(actual[key]!==counts[key])throw Error(`迁移数量校验失败：${key}`);
   if(repo.db.pragma('foreign_key_check').length)throw Error('迁移外键校验失败');
   repo.setMeta('legacy_sha256',hash);repo.setMeta('migration_report',JSON.stringify({counts,backup,source}));
  });
  repo.db.pragma('wal_checkpoint(TRUNCATE)');repo.close();fs.renameSync(temporary,target);
  const report={mode:'migrated',source,target,backup,counts,source_sha256:hash};fs.writeFileSync(target+'.migration-report.json',JSON.stringify(report,null,2));return report;
 }catch(error){try{repo.close();}catch{}// A uniquely named, unactivated file is retained for diagnostics.
  throw Object.assign(Error('迁移失败，原数据未更改：'+error.message),{cause:error});
 }
}
