// Explicit, paid-service smoke test using only the synthetic sample PDF.
// Keeps its account and runs in a separate audit directory, never production data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
if(!process.argv.includes('--run-live'))throw Error('Pass --run-live to authorize real MinerU and model requests');
const output=path.join(root,'data','audit-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(output,{recursive:true});
const report={started_at:new Date().toISOString(),checks:[],data_directory:output};
const record=(name,status,detail)=>{report.checks.push({name,status,detail});console.log(JSON.stringify({name,status,detail}));};
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,REVIEW_DATA_DIR:output,REVIEW_DATABASE_PATH:path.join(output,'review.sqlite3'),REVIEW_PORT:'0'}});
const stderr=[];child.stderr.on('data',d=>stderr.push(d.toString()));
let cookie='';
const base=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',d=>{text+=d;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',c=>reject(Error('Audit service exited '+c)));});
console.log('AUDIT_DIRECTORY '+output);
const request=async(url,options={})=>{
 const res=await fetch(base+url,{...options,headers:{...(cookie?{Cookie:cookie}:{}),...(typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(60000)});
 const session=res.headers.get('set-cookie');if(session)cookie=session.split(';')[0];return res;
};
async function json(url,options){const res=await request(url,options),data=await res.json();if(!res.ok)throw Error(`${url} HTTP ${res.status}: ${data.error}`);return data;}
async function submit(form,label){
 const accepted=await json('/api/review',{method:'POST',body:form});record(label+' submission','pass',{task_id:accepted.task_id});
 let last='';const start=Date.now();
 while(Date.now()-start<30*60*1000){
  const task=await json('/api/tasks/'+accepted.task_id);
  const status=task.status+':'+task.message;
  if(status!==last){console.log(label+' '+status);last=status;}
  if(task.status==='failed'){record(label,'fail',{task_id:task.task_id,error:task.error});return null;}
  if(task.status==='succeeded'){
   const run=task.run;assert.equal(run.reviews.length,6);assert(run.blocks.length>0);
   const ids=new Set(run.blocks.map(b=>b.id));let evidence=0;
   for(const review of run.reviews)for(const issue of review.issues){for(const id of issue.evidence_ids)assert(ids.has(id));evidence+=issue.evidence.length;}
   record(label,'pass',{run_id:run.id,pages:run.page_count,blocks:run.blocks.length,issues:run.reviews.reduce((n,r)=>n+r.issues.length,0),evidence,model:run.model,seconds:Math.round((Date.now()-start)/1000)});
   return run;
  }
  await new Promise(r=>setTimeout(r,2000));
 }
 record(label,'fail','30-minute audit limit reached');return null;
}
async function verifyPdf(id){
 for(let i=0;i<60;i++){
  const run=await json('/api/runs/'+id);
  if(run.report?.status==='failed')throw Error('PDF generation failed: '+run.report.error);
  if(run.report?.status==='ready'){const res=await request(`/api/runs/${id}/export?format=pdf`);assert.equal(res.status,200);const bytes=Buffer.from(await res.arrayBuffer());assert(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));await fs.writeFile(path.join(output,`verified-report-${id}.pdf`),bytes);record('PDF export','pass',{run_id:id,bytes:bytes.length,total_score:run.total_score,grade:run.grade});return;}
  await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('PDF generation timed out');
}
try{
 const password=crypto.randomBytes(20).toString('hex');
 await json('/api/auth/register',{method:'POST',body:JSON.stringify({username:'audit_user',password})});record('register/session','pass');
 const config=await json('/api/config/status');record('configuration','pass',config);
 const pdf=await fs.readFile(path.join(root,'data','samples','sample-paper.pdf'));
 const firstProvider=config.models.find(m=>m.configured)?.id;if(!firstProvider)throw Error('No configured review model');
 const form=new FormData();form.set('provider',firstProvider);form.set('metadata',JSON.stringify({degree_type:'academic_master',discipline:'engineering',major:'计算机科学与技术',research_direction:'智能评审',completion_month:'2025-06'}));form.set('file',new Blob([pdf],{type:'application/pdf'}),'audit-synthetic-paper.pdf');
 const first=await submit(form,'upload-parse-review');
 if(first){
  for(let p=1;p<=first.page_count;p++){
   const res=await request(`/api/runs/${first.id}/pages/${p}.png`);assert.equal(res.status,200,'page '+p);const bytes=Buffer.from(await res.arrayBuffer());assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));await fs.writeFile(path.join(output,`verified-page-${p}.png`),bytes);
  }
  record('PDF page rendering','pass',{pages:first.page_count});
  for(const format of ['html','json'])assert.equal((await request(`/api/runs/${first.id}/export?format=${format}`)).status,200);record('report exports','pass');await verifyPdf(first.id);
  const prompts=await json('/api/prompts'),latest=prompts[0].at(-1);
  const edited=await json('/api/prompts/0',{method:'POST',body:JSON.stringify({text:latest.text+' 请明确指出研究目标是否可检验。',note:'隔离环境端到端重评测试',base_version:latest.version})});record('save focus','pass',{version:edited.version});
  const rerun=new FormData();rerun.set('provider',firstProvider);rerun.set('run_id',first.id);
  const second=await submit(rerun,'re-review');
  if(second){assert.equal(second.snapshots[0].version,edited.version);assert.equal(second.snapshots[0].text,edited.text);assert.deepEqual(second.blocks,first.blocks);assert.equal((await json('/api/runs/'+first.id)).snapshots[0].version,latest.version);record('rerun snapshots / parse reuse','pass');await verifyPdf(second.id);}
 }
 for(const option of config.models.filter(m=>m.id!==firstProvider)){if(!option.configured){record(option.label+' live review','blocked','该模型没有配置凭据或模型，未使用替代服务');continue;}if(first){const extra=new FormData();extra.set('provider',option.id);extra.set('run_id',first.id);const reviewed=await submit(extra,option.label+' live review');if(reviewed)await verifyPdf(reviewed.id);}}
}catch(error){record('audit exception','fail',error.message);process.exitCode=1;}
finally{
 if(report.checks.some(c=>c.status==='fail'))process.exitCode=1;
 report.finished_at=new Date().toISOString();await fs.writeFile(path.join(output,'audit-report.json'),JSON.stringify(report,null,2));
 // Server diagnostics are deliberately not printed: a provider can include sensitive data.
 if(stderr.length)await fs.writeFile(path.join(output,'server-diagnostics.log'),stderr.join(''));
 child.kill();console.log('REPORT '+path.join(output,'audit-report.json'));
}
