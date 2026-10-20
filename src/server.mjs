import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAuth,publicUser} from './auth.mjs';
import {openDatabase,databaseConfig} from './database.mjs';
import {standard,validateMetadata,reviewOptions} from './standards.mjs';
import {buildPrompt,promptTemplateVersion} from './prompts.mjs';
import {complianceVersion} from './compliance.mjs';
import {modelOptions,modelConfig,safeError} from './models.mjs';
import {createReportService,reportHtml,reportTemplateVersion} from './reports.mjs';
import {createReviewEngine} from './review-engine.mjs';
import {liveProgress} from './progress.mjs';
import {pricingTable} from './pricing.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
if(!process.env.REVIEW_SKIP_ENV)try{process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const dataDir=path.resolve(process.env.REVIEW_DATA_DIR||path.join(root,'data'));
await fsp.mkdir(dataDir,{recursive:true});
const repo=await openDatabase(databaseConfig());await repo.seedStandard();await repo.upgradeDefaultPrompts();
// Host names the app answers to; add the server's IP or domain when it runs behind a reverse proxy.
const allowedHosts=new Set(['127.0.0.1','localhost',...String(process.env.REVIEW_ALLOWED_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean)]);
const hostAllowed=host=>allowedHosts.has(String(host||'').toLowerCase().replace(/:\d+$/,''));
const reports=createReportService(repo,dataDir),engine=createReviewEngine(repo,dataDir,reports),auth=createAuth({repo});
const execFileAsync=promisify(execFile);const pageRenders=new Map();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.pdf':'application/pdf'};
const publicFiles=new Set(['/login.html','/register.html','/js/auth.js','/css/theme.css','/index.html','/js/portal.js','/js/app.js','/js/form-controls.js','/js/review-settings.js']);
const send=(res,status,payload)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));};
const fail=(status,message)=>Object.assign(Error(message),{status});
const safeName=name=>path.basename(name||'paper.pdf').replace(/[^\w\-.\u4e00-\u9fff ]/g,'_');
async function bodyBuffer(req){const chunks=[];let size=0;const limit=req.headers['content-type']?.startsWith('multipart/')?31*1024*1024:128*1024;for await(const chunk of req){size+=chunk.length;if(size>limit)throw fail(413,'请求过大，每份 PDF 限制为 30 MB');chunks.push(chunk);}return Buffer.concat(chunks);}
async function jsonBody(req){try{return JSON.parse((await bodyBuffer(req)).toString('utf8'));}catch(error){if(error.status)throw error;throw fail(400,'无效的 JSON 请求');}}
async function publicTask(t){const report=t.run_id?await repo.report(t.run_id):null;return {task_id:t.id,filename:t.filename||t.request?.legacy_task?.filename||'历史任务',provider:t.provider,model:t.model,status:t.status,stage:t.stage,message:t.message,error:t.error,created_at:t.created_at,started_at:t.started_at,finished_at:t.finished_at,...await liveProgress(repo,t),run_id:t.run_id,metadata:t.request.metadata||null,report:publicReport(report),retry_of_task_id:t.request.retry_of_task_id||null,can_retry:['failed','interrupted'].includes(t.status)&&!!t.paper_version_id&&!!t.request.model_config};}
function publicReport(r){if(!r)return null;const {storage_path,sha256,...result}=r;return result;}
function publicRun(r){const {owner_id,...result}=r;return {...result,report:publicReport(result.report)};}
async function sendFile(res,filename,type){await fsp.access(filename).catch(error=>{if(error.code==='ENOENT')throw fail(404,'文件不存在，请检查文件存储或重新生成报告');throw error;});res.setHeader('Content-Type',type);const stream=fs.createReadStream(filename);stream.on('error',()=>res.destroy());stream.pipe(res);}
// Each dimension uses the chosen prompt version, or its latest version when none is chosen.
async function promptSnapshots(owner,versions){
 const all=await repo.prompts(owner);if(versions==null)return all.map(v=>structuredClone(v.at(-1)));
 if(!Array.isArray(versions)||versions.length!==all.length)throw fail(400,'提示词版本参数无效');
 return all.map((list,i)=>{const chosen=versions[i]==null?list.at(-1):list.find(v=>v.version===versions[i]);if(!chosen)throw fail(400,`所选提示词版本不存在：第 ${i+1} 维度 v${versions[i]}`);if(chosen.kind!=='focus')throw fail(400,'旧版完整提示词不能直接用于评审，请选择评审提示词版本');return structuredClone(chosen);});
}
async function snapshot(owner,metadata,config,versions=null){return {metadata,standard:structuredClone(standard),snapshots:await promptSnapshots(owner,versions),prompt_template_version:promptTemplateVersion,compliance_version:complianceVersion,model_config:config};}

async function handler(req,res){
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 try{
  if(!hostAllowed(req.headers.host))return send(res,403,{error:'无效的访问地址'});
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return send(res,403,{error:'不允许跨站提交'});
  if(req.method==='POST'&&['/api/auth/register','/api/auth/login'].includes(url.pathname)){
   if(!req.headers['content-type']?.startsWith('application/json'))throw fail(415,'请使用 JSON 请求');
   const input=await jsonBody(req),user=url.pathname.endsWith('/register')?await auth.register(input,req,res):await auth.login(input,req,res);return send(res,200,{user});
  }
  const user=await auth.authenticate(req);
  if(url.pathname.startsWith('/api/')&&!user)throw fail(401,'请先登录');
  if(req.method==='GET'&&url.pathname==='/api/auth/me')return send(res,200,{user:publicUser(user)});
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){await auth.logout(req,res);return send(res,200,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/auth/password'){await auth.changePassword(user,await jsonBody(req),res);return send(res,200,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/config/status')return send(res,200,{mineru_configured:Boolean(process.env.MINERU_TOKEN),models:modelOptions(),usd_to_cny:pricingTable().usd_to_cny});
  if(req.method==='GET'&&url.pathname==='/api/review-options')return send(res,200,{...reviewOptions(),models:modelOptions()});
  if(req.method==='POST'&&url.pathname==='/api/review-preview'){
   const input=await jsonBody(req),metadata=validateMetadata(input.metadata,input.filename),request=await snapshot(user.id,metadata,null,input.prompt_versions??null);
   return send(res,200,{metadata,standard:standard.name,weights:standard.degree_profiles[metadata.degree_type].weights,prompt:buildPrompt(request.snapshots,[],request,{hideCompliance:true})});
  }
  if(req.method==='GET'&&url.pathname==='/api/prompts')return send(res,200,await repo.prompts(user.id));
  if(req.method==='POST'&&/^\/api\/prompts\/\d+$/.test(url.pathname))return send(res,201,await repo.appendPrompt(user.id,Number(url.pathname.split('/')[3]),await jsonBody(req)));
  if(req.method==='GET'&&url.pathname==='/api/tasks'){
   // A failed task that already has a linked retry is superseded and no longer needs attention.
   const tasks=await repo.tasks(user.id),retried=new Set(tasks.map(t=>t.request.retry_of_task_id).filter(Boolean)),usage=await repo.usageByTask(tasks.map(t=>t.id));
   return send(res,200,await Promise.all(tasks.map(async t=>({...await publicTask(t),superseded:retried.has(t.id),usage:usage.get(t.id)||null}))));
  }
  if(req.method==='GET'&&/^\/api\/tasks\/[^/]+\/log$/.test(url.pathname)){
   const id=url.pathname.split('/')[3];if(!await repo.task(id,user.id))throw fail(404,'任务不存在');return send(res,200,await repo.taskLog(id));
  }
  if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/dismiss$/.test(url.pathname)){await repo.dismissTask(url.pathname.split('/')[3],user.id);return send(res,200,{ok:true});}
  if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/retry$/.test(url.pathname)){
   const taskId=await engine.retry(url.pathname.split('/')[3],user.id);engine.enqueue(taskId);return send(res,202,{task_id:taskId,status:'accepted'});
  }
  if(req.method==='GET'&&/^\/api\/tasks\/[^/]+$/.test(url.pathname)){
   const task=await repo.task(url.pathname.split('/')[3],user.id);if(!task)throw fail(404,'任务不存在');return send(res,200,{...await publicTask(task),...(task.run_id?{run:publicRun(await repo.run(task.run_id,user.id))}:{})});
  }
  if(req.method==='GET'&&url.pathname==='/api/runs')return send(res,200,(await repo.runs(user.id,Object.fromEntries(url.searchParams))).map(r=>({...r,report:publicReport(r.report)})));
  if(req.method==='POST'&&url.pathname==='/api/review'){
   const form=await new Request('http://localhost',{method:'POST',headers:req.headers,body:await bodyBuffer(req)}).formData();
   const config=modelConfig(form.get('provider')||'gpt');
   if((await repo.tasks(user.id)).filter(t=>['running','queued'].includes(t.status)).length>=10)throw fail(429,'待处理任务已达 10 个，请等待任务完成');
   let previous=null,version=null,bytes=null,filename='';
   if(form.get('run_id')){
    previous=await repo.run(form.get('run_id'),user.id);if(!previous)throw fail(404,'原评审记录不存在');
    version=await repo.version(previous.paper_version_id);filename=previous.filename;await fsp.access(version.storage_path).catch(()=>{throw fail(404,'原论文 PDF 不存在');});
   }else{
    const file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||!String(file.name).toLowerCase().endsWith('.pdf'))throw fail(400,'请上传 PDF 文件');
    if(file.size>30*1024*1024)throw fail(413,'每份 PDF 不得超过 30 MB');
    bytes=Buffer.from(await file.arrayBuffer());if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw fail(400,'文件不是有效的 PDF');
    if(!process.env.MINERU_TOKEN)throw fail(400,'论文解析服务尚未配置');filename=safeName(file.name);
   }
   let input=previous?.metadata;try{if(form.has('metadata'))input=JSON.parse(form.get('metadata'));}catch{throw fail(400,'无效的论文参数 JSON');}
   let versions=null;try{if(form.has('prompt_versions'))versions=JSON.parse(form.get('prompt_versions'));}catch{throw fail(400,'提示词版本参数无效');}
   const metadata=validateMetadata(input,filename);const request=await snapshot(user.id,metadata,config,versions);const taskId=crypto.randomUUID();
   const paperId=form.get('paper_id')||null;if(paperId&&!await repo.paper(paperId,user.id))throw fail(404,'论文不存在');
   if(previous&&paperId)throw fail(400,'重新评审不能同时指定修订稿论文');
   let storagePath=null,versionId=null;
   if(bytes){versionId=crypto.randomUUID();storagePath=path.join(dataDir,'papers',versionId,'source.pdf');await fsp.mkdir(path.dirname(storagePath),{recursive:true});await fsp.writeFile(storagePath,bytes,{flag:'wx'});}
   await repo.transaction(async tx=>{
    if((await tx.tasks(user.id)).filter(t=>['running','queued'].includes(t.status)).length>=10)throw fail(429,'待处理任务已达 10 个');
    if(!version)version=await tx.createVersion({owner:user.id,paperId,filename,storagePath,metadata,bytes,versionId});
    await tx.createTask({id:taskId,owner_id:user.id,paper_version_id:version.id,parent_run_id:previous?.id,provider:config.provider,model:config.model,request});
   });
   engine.enqueue(taskId);return send(res,202,{task_id:taskId,status:'accepted'});
  }
  if(req.method==='POST'&&/^\/api\/runs\/[^/]+\/reports$/.test(url.pathname)){
   const id=url.pathname.split('/')[3];if(!await repo.run(id,user.id))throw fail(404,'评审记录不存在');const job=reports.request(id);job.catch(error=>console.error('report queue:',safeError(error)));await job.started;return send(res,202,{report:publicReport(await repo.report(id))});
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/runs/')){
   const parts=url.pathname.split('/'),id=parts[3],run=await repo.run(id,user.id);if(!run)throw fail(404,'评审记录不存在');
   if(parts.length===4)return send(res,200,publicRun(run));
   if(parts.length===5&&parts[4]==='export'){
    const format=url.searchParams.get('format')||'html';if(!['html','json','pdf'].includes(format))throw fail(400,'不支持的导出格式');
    if(format==='pdf'){
     const report=await repo.report(id);if(!report||report.status!=='ready')return send(res,409,{error:report?.status==='failed'?'报告生成失败，请单独重试':'PDF 尚未就绪，请生成报告并等待完成',report:publicReport(report)});
     if(!fs.existsSync(report.storage_path)){await repo.setReport(id,report.template_version,'failed',{error:'报告文件缺失，可单独重新生成'});throw fail(404,'报告文件缺失，请重新生成 PDF');}
     res.setHeader('Content-Disposition',`attachment; filename="review-${id}.pdf"`);await sendFile(res,report.storage_path,'application/pdf');return;
    }
    res.setHeader('Content-Disposition',`attachment; filename="review-${id}.${format}"`);res.setHeader('Content-Type',format==='html'?'text/html; charset=utf-8':'application/json; charset=utf-8');return res.end(format==='html'?reportHtml(run):JSON.stringify(publicRun(run),null,2));
   }
   const version=await repo.version(run.paper_version_id);
   if(parts.length===5&&parts[4]==='pdf'){await sendFile(res,version.storage_path,'application/pdf');return;}
   if(parts.length===6&&parts[4]==='pages'&&/^\d+\.png$/.test(parts[5])){
    const page=Number(parts[5].replace('.png',''));if(page<1||page>run.page_count)throw fail(404,'页码不存在');
    const folder=path.dirname(version.storage_path),cache=path.join(folder,`page-${page}.png`);
    if(!fs.existsSync(cache)){
     // Concurrent requests for one page share a render, which goes to a temporary name so a half-written image is never served.
     if(!pageRenders.has(cache))pageRenders.set(cache,execFileAsync(process.env.PDFTOPPM_BIN||'pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-png','-r','120',version.storage_path,cache+'.tmp']).then(()=>fsp.rename(cache+'.tmp.png',cache)).finally(()=>pageRenders.delete(cache)));
     await pageRenders.get(cache);
    }
    // A paper version never changes, so its page images can stay in the browser cache.
    res.setHeader('Cache-Control','private, max-age=604800, immutable');await sendFile(res,cache,'image/png');return;
   }
   throw fail(404,'资源不存在');
  }
  const route=url.pathname==='/'?'/index.html':url.pathname;
  if(!publicFiles.has(route)){res.writeHead(404);return res.end('Not found');}
  if(route==='/index.html'&&!user){res.writeHead(302,{Location:'/login.html'});return res.end();}
  if(['GET','HEAD'].includes(req.method)){const data=await fsp.readFile(path.join(root,'public',route));res.setHeader('Content-Type',types[path.extname(route)]||'text/plain');return res.end(req.method==='HEAD'?undefined:data);}
  throw fail(405,'不支持的请求方法');
 }catch(error){if(res.headersSent){res.destroy();return;}console.error('request failed:',error.status||500);return send(res,error.status||500,{error:error.status?safeError(error):'服务暂时无法完成请求，请稍后重试'});}
}
const server=http.createServer(handler);
server.on('error',error=>{console.error('启动失败：',error.code||'unknown');repo.close().catch(()=>{});process.exitCode=1;});
const listenHost=process.env.REVIEW_HOST||'127.0.0.1';
server.listen(Number(process.env.REVIEW_PORT||4173),listenHost,async()=>{
 try{
  // Do not mark tasks interrupted until this process has successfully bound its port.
  const recovery=await repo.recover();console.log(`Review backend: http://${listenHost}:${server.address().port}`);
  for(const id of recovery)engine.enqueue(id);
  // Reports still pending, never generated, or built with an older template are (re)generated.
  const pending=await repo.q("SELECT run_id FROM report_files WHERE status='pending' UNION SELECT id AS run_id FROM review_runs WHERE result_schema_version>=2 AND NOT EXISTS (SELECT 1 FROM report_files WHERE run_id=review_runs.id AND template_version=?)",[reportTemplateVersion]);
  for(const row of pending)reports.request(row.run_id).catch(error=>console.error('report queue:',safeError(error)));
 }catch(error){console.error('startup recovery failed:',safeError(error));}
});
// Close the database pool cleanly when the process is asked to stop.
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();repo.close().finally(()=>process.exit(0));});
