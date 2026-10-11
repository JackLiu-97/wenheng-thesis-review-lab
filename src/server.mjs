import {createAuth,publicUser} from './auth.mjs';
import {dimensions,defaultPrompts,migratePrompts,appendFocusVersion,buildPrompt,promptTemplateVersion} from './prompts.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=fileURLToPath(new URL('..',import.meta.url));
const publicDir=path.join(root,'public');
if(!process.env.REVIEW_SKIP_ENV)try{loadEnvFile(path.join(root,'.env'));}catch{}
const dataDir=process.env.REVIEW_DATA_DIR||path.join(root,'data'); const runDir=path.join(dataDir,'runs');
await fsp.mkdir(runDir,{recursive:true});
const storePath=path.join(dataDir,'store.json');
const execFileAsync=promisify(execFile);
const jobs=[];let processing=false;
const modelOptions=()=>[
 {id:'gpt',label:'GPT',model:process.env.REVIEW_CODEX_MODEL||null,configured:Boolean(process.env.CODEX_API_KEY&&process.env.CODEX_BASE_URL&&process.env.REVIEW_CODEX_MODEL)},
 {id:'deepseek',label:'DeepSeek',model:process.env.DEEPSEEK_MODEL||null,configured:Boolean(process.env.DEEPSEEK_API_KEY&&process.env.DEEPSEEK_MODEL)}
];
async function selectedReview(prompt,dir,provider){
 if(provider==='gpt')return codexReview(prompt,dir);
 const response=await fetch((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'')+'/chat/completions',{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},
  body:JSON.stringify({model:process.env.DEEPSEEK_MODEL,messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},stream:false}),
  signal:AbortSignal.timeout(1800000)
 });
 if(!response.ok)throw new Error('DeepSeek 请求失败：HTTP '+response.status);
 const data=await response.json(),choice=data.choices?.[0];
 if(choice?.finish_reason!=='stop')throw new Error('DeepSeek 输出未完整结束，请检查模型输出限制');
 try{return JSON.parse(choice.message.content);}catch{throw new Error('DeepSeek 返回的 JSON 无效');}
}

const readStore=async()=>{try{return JSON.parse(await fsp.readFile(storePath,'utf8'));}catch(error){if(error.code==='ENOENT')return {prompts:defaultPrompts(),runs:[]};throw error;}};
const writeStore=async store=>{
 const temp=storePath+'.tmp';await fsp.writeFile(temp,JSON.stringify(store,null,2),'utf8');
 // Windows readers or scanners can briefly hold the destination open.
 for(let attempt=0;;attempt++){
  try{await fsp.rename(temp,storePath);return;}
  catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=12)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(25*2**attempt,250)));}
 }
};
let storeQueue=Promise.resolve();
const updateStore=change=>{
 const operation=storeQueue.then(async()=>{const store=await readStore();const result=await change(store);await writeStore(store);return result;});
 storeQueue=operation.catch(()=>{});return operation;
};
const initialStore=await readStore();
if(migratePrompts(initialStore)){
 await fsp.copyFile(storePath,storePath+'.before-focus-'+Date.now()+'.bak');
 await writeStore(initialStore);
}
const send=(res,status,payload)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));};
const bodyBuffer=req=>new Promise((resolve,reject)=>{const chunks=[];let size=0;const limit=req.headers['content-type']?.startsWith('multipart/')?31*1024*1024:128*1024;req.on('data',x=>{size+=x.length;if(size>limit){reject(Object.assign(new Error('请求过大，PDF 限制为 30 MB'),{status:413}));return;}chunks.push(x);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});
const safeName=name=>path.basename(name||'paper.pdf').replace(/[^\w\-.\u4e00-\u9fff ]/g,'_')||'paper.pdf';
function run(cmd,args,opts={}){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{...opts,windowsHide:true});let out='',err='';p.stdout?.on('data',d=>out+=d);p.stderr?.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(new Error(`${cmd} exited ${code}: ${err.slice(-1200)}`)):resolve({out,err}));});}
async function parseMineru(pdfPath,target){const token=process.env.MINERU_TOKEN;if(!token)throw new Error('MINERU_TOKEN 未配置');const base=(process.env.MINERU_API_BASE||'https://mineru.net/api/v4').replace(/\/$/,'');const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};const req=await fetch(`${base}/file-urls/batch`,{method:'POST',headers,body:JSON.stringify({files:[{name:path.basename(pdfPath),data_id:path.basename(pdfPath,path.extname(pdfPath))}],model_version:process.env.MINERU_MODEL_VERSION||'vlm'})});if(!req.ok)throw new Error(`MinerU 申请上传地址失败: HTTP ${req.status}`);const j=await req.json(),d=j.data||{};if(!d.batch_id||!d.file_urls?.[0])throw new Error('MinerU 返回缺少 batch_id 或 upload URL');const put=await fetch(d.file_urls[0],{method:'PUT',body:fs.createReadStream(pdfPath),duplex:'half'});if(!put.ok)throw new Error(`MinerU 上传 PDF 失败: HTTP ${put.status}`);let result;for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,2000));const poll=await fetch(`${base}/extract-results/batch/${d.batch_id}`,{headers:{Authorization:`Bearer ${token}`}});if(!poll.ok)throw new Error(`MinerU 查询失败: HTTP ${poll.status}`);const pj=await poll.json();result=(pj.data?.extract_result||[])[0];if(result?.state==='done')break;if(result?.state==='failed')throw new Error(`MinerU 解析失败: ${result.err_msg||'unknown'}`);}if(result?.state!=='done'||!result.full_zip_url)throw new Error('MinerU 解析超时');const zipPath=path.join(target,'mineru.zip');const zr=await fetch(result.full_zip_url);if(!zr.ok)throw new Error('MinerU 结果下载失败');await fsp.writeFile(zipPath,Buffer.from(await zr.arrayBuffer()));const unpack=path.join(target,'mineru');await fsp.mkdir(unpack,{recursive:true});const q=s=>s.replaceAll("'","''");await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${q(zipPath)}' -DestinationPath '${q(unpack)}' -Force`]);let contentList=null,markdown=null;const walk=async dir=>{for(const e of await fsp.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('_content_list.json')||e.name==='content_list.json')contentList??=p;else if(e.name.endsWith('.md'))markdown??=p;}};await walk(unpack);if(!contentList&&markdown)return {markdown,blocks:[]};if(!contentList)throw new Error('MinerU 结果中未找到 content_list.json');const raw=JSON.parse(await fsp.readFile(contentList,'utf8'));let pageSizes=[];try{const layout=JSON.parse(await fsp.readFile(path.join(unpack,'layout.json'),'utf8'));pageSizes=(layout.pdf_info||[]).map(x=>x.page_size||[595,841]);}catch{}const blocks=raw.map((x,i)=>({id:`b${i+1}`,type:x.type||'text',text:String(x.text||x.content||x.html||''),page:Number(x.page_idx??x.page_number??0)+1,bbox:x.bbox||x.box||null})).filter(x=>x.text.trim());await fsp.writeFile(path.join(target,'blocks.json'),JSON.stringify(blocks,null,2));return {markdown,blocks,pageSizes};}
async function codexReview(prompt,dir){const key=process.env.CODEX_API_KEY;if(!key)throw new Error('CODEX_API_KEY 未配置');const model=process.env.REVIEW_CODEX_MODEL;if(!model)throw new Error('REVIEW_CODEX_MODEL 未配置');const cli=process.env.REVIEW_CODEX_BIN||process.env.CODEX_CLI_PATH||'codex';const home=await fsp.mkdtemp(path.join(os.tmpdir(),'review-codex-'));const base=(process.env.CODEX_BASE_URL||'').replaceAll('\"','');const cfg=`model_provider = "review_provider"\nmodel = "${model.replaceAll('\"','')}"\n[model_providers.review_provider]\nname = "Review Provider"\nbase_url = "${base}"\nenv_key = "CODEX_API_KEY"\nwire_api = "responses"\n`;await fsp.writeFile(path.join(home,'config.toml'),cfg);const schema=path.join(home,'schema.json');const issue={type:'object',additionalProperties:false,required:['title','severity','detail','evidence_ids','suggestion'],properties:{title:{type:'string'},severity:{enum:['major','minor','positive']},detail:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}},suggestion:{type:'string'}}};await fsp.writeFile(schema,JSON.stringify({type:'object',additionalProperties:false,required:['dimensions'],properties:{dimensions:{type:'array',items:{type:'object',additionalProperties:false,required:['dimension','summary','issues'],properties:{dimension:{type:'string'},summary:{type:'string'},issues:{type:'array',items:issue}}}}}}));const out=path.join(home,'result.json');const env={...process.env,CODEX_HOME:home,CODEX_API_KEY:key};await new Promise((resolve,reject)=>{const p=spawn(cli,['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never','--output-schema',schema,'--output-last-message',out,'-m',model,'-'],{cwd:dir,env,windowsHide:true});let err='';p.stderr.on('data',d=>err+=d);p.on('error',reject);p.stdin.end(prompt);p.on('close',code=>code?reject(new Error(`Codex CLI 失败: ${err.slice(-1800)}`)):resolve());});return JSON.parse(await fsp.readFile(out,'utf8'));}
async function reviewPaper(file,filename,provider,previous=null,ownerId=null,submittedSnapshots=null,taskId=null){const id=taskId||crypto.randomUUID(),dir=path.join(runDir,id);await fsp.mkdir(dir,{recursive:true});const pdf=path.join(dir,safeName(filename));await fsp.writeFile(pdf,file);const parsed=previous?{blocks:previous.blocks,pageSizes:previous.page_sizes||[]}:await parseMineru(pdf,dir),store=await readStore(),snapshots=submittedSnapshots||store.prompts.map(v=>structuredClone(v.at(-1))),prompt=buildPrompt(snapshots,parsed.blocks),savedPrompt=await fsp.writeFile(path.join(dir,'prompt.txt'),prompt,'utf8'),result=await selectedReview(prompt,dir,provider),byName=new Map((result.dimensions||[]).map(x=>[x.dimension,x]));const missing=dimensions.filter(d=>!byName.has(d));if(missing.length)throw new Error(`模型未返回完整评审维度: ${missing.join('、')}`);const blockIds=new Set(parsed.blocks.map(b=>b.id));const reviews=dimensions.map((dimension,i)=>{const item=byName.get(dimension);return {dimension,summary:item.summary||'',issues:(item.issues||[]).map((x,n)=>{if(!x||typeof x.title!=='string'||typeof x.detail!=='string'||typeof x.suggestion!=='string'||!['major','minor','positive'].includes(x.severity)||!Array.isArray(x.evidence_ids))throw new Error('评审意见字段不完整');const ids=x.evidence_ids;const invalid=ids.filter(eid=>!blockIds.has(eid));if(invalid.length)throw new Error(`维度「${dimension}」返回了无效证据 ID: ${invalid.join(',')}`);return {...x,id:`${id}-${i+1}-${n+1}`,dimension,dimension_index:i,evidence:ids.map(eid=>parsed.blocks.find(b=>b.id===eid))};})};});const pageCount=parsed.pageSizes.length||Math.max(...parsed.blocks.map(b=>b.page),1);const maxX=Math.max(...parsed.blocks.map(b=>b.bbox?.[2]||0),0),maxY=Math.max(...parsed.blocks.map(b=>b.bbox?.[3]||0),0);const coordinateSize=[1000,1000];const runData={id,owner_id:ownerId,prompt_template_version:promptTemplateVersion,provider,model:modelOptions().find(x=>x.id===provider).model,created_at:new Date().toISOString(),filename,source_pdf:`/api/runs/${id}/pdf`,page_count:pageCount,page_sizes:parsed.pageSizes,coordinate_size:coordinateSize,snapshots,reviews,blocks:parsed.blocks};await updateStore(latest=>{latest.runs.push(runData);});return runData;}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.pdf':'application/pdf'};
const publicFiles=new Set(['/login.html','/register.html','/js/auth.js','/css/theme.css','/css/portal.css','/index.html','/js/portal.js','/js/app.js','/css/style.css']);
const auth=createAuth({readStore,updateStore,defaultPrompts});
if(fs.existsSync(storePath)&&!initialStore.users){await fsp.copyFile(storePath,storePath+'.before-accounts-'+Date.now()+'.bak');}
await updateStore(store=>{store.tasks??=[];for(const task of store.tasks)if(['queued','running'].includes(task.status)){task.status='failed';task.message='服务重启，任务已中断';task.error='请重新提交评审';}});
const userPrompts=(store,id)=>store.users.find(u=>u.id===id).prompts;
const ownedRun=(store,id,user)=>store.runs.find(r=>r.id===id&&r.owner_id===user.id);
const summary=r=>({id:r.id,filename:r.filename,created_at:r.created_at,provider:r.provider,model:r.model,page_count:r.page_count,issue_count:r.reviews.reduce((n,r)=>n+(r.issues?.length||0),0)});
async function jsonBody(req){try{return JSON.parse((await bodyBuffer(req)).toString('utf8'));}catch(error){if(error.status)throw error;throw Object.assign(new Error('无效的 JSON 请求'),{status:400});}}
async function pumpJobs(){
 if(processing)return;processing=true;
 try{while(jobs.length){const job=jobs.shift();
  await updateStore(s=>Object.assign(s.tasks.find(t=>t.task_id===job.id),{status:'running',message:'正在解析论文并生成六维度评审',progress:10}));
  try{const result=await reviewPaper(job.bytes,job.filename,job.provider,job.previous,job.owner,job.snapshots,job.id);
   await updateStore(s=>Object.assign(s.tasks.find(t=>t.task_id===job.id),{status:'succeeded',progress:100,message:'评审完成',run_id:result.id}));
  }catch(error){await updateStore(s=>Object.assign(s.tasks.find(t=>t.task_id===job.id),{status:'failed',progress:100,message:'评审失败',error:job.provider==='gpt'?'GPT 评审未完成，请检查模型配置、连接和论文解析服务。':error.message}));}
 }}finally{processing=false;}
}
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reportHtml(run){return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(run.filename)} · 文衡评审报告</title><style>body{max-width:900px;margin:50px auto;padding:0 24px;background:#fbfaf8;color:#171717;font:16px/1.9 system-ui}h1,h2{color:#a65034}article{background:white;border:1px solid #e8e3dc;border-radius:12px;padding:20px;margin:16px 0}p{white-space:pre-wrap}small{color:#6e685f}@media print{body{margin:0;background:white}article{break-inside:avoid}}</style><h1>文衡 · 学位论文评审报告</h1><p>${escapeHtml(run.filename)}<br>${escapeHtml(run.model||'历史模型未记录')} · ${escapeHtml(run.created_at)}</p>${run.reviews.map(r=>`<h2>${escapeHtml(r.dimension)}</h2><p>${escapeHtml(r.summary)}</p>${r.issues.map(i=>`<article><h3>${escapeHtml(i.title)}</h3><small>${escapeHtml(i.severity)}</small><p>${escapeHtml(i.detail)}</p><h4>原文证据</h4>${(i.evidence||[]).map(e=>`<p>第 ${e.page} 页：${escapeHtml(e.text)}</p>`).join('')}<h4>修改建议</h4><p>${escapeHtml(i.suggestion)}</p></article>`).join('')}`).join('')}`;}
async function handler(req,res){
 const u=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 try{
  const allowedHost=/^(127\.0\.0\.1|localhost)(:\d+)?$/i;
  if(!allowedHost.test(req.headers.host||''))return send(res,403,{error:'无效的访问地址'});
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'不允许跨站提交'});
  if(req.method==='POST'&&['/api/auth/register','/api/auth/login'].includes(u.pathname)){
   if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'请使用 JSON 请求'});
   const input=await jsonBody(req),user=u.pathname.endsWith('/register')?await auth.register(input,req,res):await auth.login(input,req,res);
   return send(res,200,{user});
  }
  const user=await auth.authenticate(req);
  if(u.pathname.startsWith('/api/')&&!user)return send(res,401,{error:'请先登录'});
  if(req.method==='GET'&&u.pathname==='/api/auth/me')return send(res,200,{user:publicUser(user)});
  if(req.method==='POST'&&u.pathname==='/api/auth/logout'){await auth.logout(req,res);return send(res,200,{ok:true});}
  if(req.method==='POST'&&u.pathname==='/api/auth/password'){await auth.changePassword(user,await jsonBody(req),res);return send(res,200,{ok:true});}
  if(req.method==='GET'&&u.pathname==='/api/config/status')return send(res,200,{mineru_configured:Boolean(process.env.MINERU_TOKEN),models:modelOptions()});
  if(req.method==='GET'&&u.pathname==='/api/prompts')return send(res,200,userPrompts(await readStore(),user.id));
  if(req.method==='POST'&&/^\/api\/prompts\/\d+$/.test(u.pathname)){
   const input=await jsonBody(req),index=Number(u.pathname.split('/')[3]);
   const version=await updateStore(store=>appendFocusVersion({prompts:userPrompts(store,user.id)},index,input));return send(res,201,version);
  }
  if(req.method==='GET'&&u.pathname==='/api/tasks')return send(res,200,(await readStore()).tasks.filter(t=>t.owner_id===user.id).map(({owner_id,...t})=>t));
  if(req.method==='GET'&&u.pathname.startsWith('/api/tasks/')){
   const store=await readStore(),task=store.tasks.find(t=>t.task_id===u.pathname.split('/')[3]&&t.owner_id===user.id);
   if(!task)return send(res,404,{error:'任务不存在'});
   const {owner_id,...result}=task;return send(res,200,{...result,...(task.run_id?{run:ownedRun(store,task.run_id,user)}:{})});
  }
  if(req.method==='GET'&&u.pathname==='/api/runs')return send(res,200,(await readStore()).runs.filter(r=>r.owner_id===user.id).map(summary));
  if(req.method==='POST'&&u.pathname==='/api/review'){
   const form=await new Request('http://localhost',{method:'POST',headers:req.headers,body:await bodyBuffer(req)}).formData();
   const provider=form.get('provider')||'gpt',option=modelOptions().find(x=>x.id===provider);
   if(!option)return send(res,400,{error:'仅支持 GPT 或 DeepSeek'});
   if(!option.configured)return send(res,400,{error:option.label+' 尚未配置 API Key 或模型'});
   const store=await readStore();
   if(store.tasks.filter(t=>t.owner_id===user.id&&['running','queued'].includes(t.status)).length>=10)return send(res,429,{error:'待处理任务已达 10 个，请等待任务完成'});
   let previous=null,bytes,filename;
   if(form.get('run_id')){
    previous=ownedRun(store,form.get('run_id'),user);
    if(!previous)return send(res,404,{error:'原评审记录不存在'});
    if(!previous.blocks?.length)return send(res,400,{error:'原评审没有可复用的解析文本'});
    const folder=path.join(runDir,previous.id),pdf=(await fsp.readdir(folder)).find(f=>f.toLowerCase().endsWith('.pdf'));
    if(!pdf)return send(res,404,{error:'原论文 PDF 不存在'});
    bytes=await fsp.readFile(path.join(folder,pdf));filename=previous.filename;
   }else{
    const uploaded=form.get('file');
    if(!uploaded||typeof uploaded.arrayBuffer!=='function'||!String(uploaded.name).toLowerCase().endsWith('.pdf'))return send(res,400,{error:'请上传 PDF 文件'});
    if(!process.env.MINERU_TOKEN)return send(res,400,{error:'论文解析服务尚未配置'});
    if(uploaded.size>30*1024*1024)return send(res,413,{error:'每份 PDF 不得超过 30 MB'});
    bytes=Buffer.from(await uploaded.arrayBuffer());filename=safeName(uploaded.name);
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))return send(res,400,{error:'文件不是有效的 PDF'});
   }
   const id=crypto.randomUUID(),snapshots=userPrompts(store,user.id).map(v=>structuredClone(v.at(-1)));
   await updateStore(s=>s.tasks.push({task_id:id,owner_id:user.id,status:'queued',progress:0,message:'已加入评审队列',filename,provider,model:option.model,created_at:new Date().toISOString()}));
   jobs.push({id,bytes,filename,provider,previous,owner:user.id,snapshots});pumpJobs().catch(error=>console.error('review queue failed:',error.message));
   return send(res,202,{task_id:id,status:'accepted'});
  }
  if(req.method==='GET'&&u.pathname.startsWith('/api/runs/')){
   const parts=u.pathname.split('/'),id=parts[3],store=await readStore(),run=ownedRun(store,id,user);
   if(!run)return send(res,404,{error:'评审记录不存在'});
   if(parts.length===4)return send(res,200,run);
   if(parts[4]==='export'){
    const format=u.searchParams.get('format')||'html';if(!['html','json'].includes(format))return send(res,400,{error:'不支持的导出格式'});
    res.setHeader('Content-Disposition',`attachment; filename="review-${id}.${format}"`);
    res.setHeader('Content-Type',format==='html'?'text/html; charset=utf-8':'application/json; charset=utf-8');
    return res.end(format==='html'?reportHtml(run):JSON.stringify(run,null,2));
   }
   const folder=path.join(runDir,id),pdf=(await fsp.readdir(folder)).find(f=>f.toLowerCase().endsWith('.pdf'));
   if(!pdf)return send(res,404,{error:'PDF 不存在'});
   if(parts[4]==='pdf'){res.setHeader('Content-Type','application/pdf');return fs.createReadStream(path.join(folder,pdf)).pipe(res);}
   if(parts[4]==='pages'&&/^\d+\.png$/.test(parts[5]||'')){
    const page=Number(parts[5].replace('.png',''));
    if(page<1||page>(run.page_count||Math.max(...run.blocks.map(b=>b.page),1)))return send(res,404,{error:'页码不存在'});
    const cache=path.join(folder,`page-${page}.png`);
    try{await fsp.access(cache);}catch{await execFileAsync(process.env.PDFTOPPM_BIN||'pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-png','-r','120',path.join(folder,pdf),path.join(folder,`page-${page}`)],{windowsHide:true});}
    res.setHeader('Content-Type','image/png');return fs.createReadStream(cache).pipe(res);
   }
  }
  const route=u.pathname==='/'?'/index.html':u.pathname;
  if(!publicFiles.has(route)){res.writeHead(404);return res.end('Not found');}
  if(route==='/index.html'&&!user){res.writeHead(302,{Location:'/login.html'});return res.end();}
  if(['GET','HEAD'].includes(req.method)){const data=await fsp.readFile(path.join(publicDir,route));res.setHeader('Content-Type',types[path.extname(route)]||'text/plain');return res.end(req.method==='HEAD'?undefined:data);}
  return send(res,405,{error:'不支持的请求方法'});
 }catch(error){console.error('request failed:',error.status||500);return send(res,error.status||500,{error:error.status?error.message:'服务暂时无法完成请求，请稍后重试'});}
}
const server=http.createServer(handler);
server.listen(Number(process.env.REVIEW_PORT||4173),'127.0.0.1',()=>console.log('Review backend: http://127.0.0.1:'+server.address().port));
