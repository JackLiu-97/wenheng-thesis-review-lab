import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {dimensions,defaultPrompts} from '../src/prompts.mjs';
import {openDatabase} from '../src/database.mjs';
import {metadata} from './helpers.mjs';

test('real HTTP account lifecycle, private data, exports and task failure recovery',{timeout:30000},async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'review-accounts-test-'));
 const root=fileURLToPath(new URL('..',import.meta.url));
 const original={prompts:defaultPrompts(),runs:[{id:'legacy-run',filename:'paper.pdf',created_at:'2026-01-01',page_count:1,page_sizes:[[595,841]],source_pdf:'/api/runs/legacy-run/pdf',blocks:[{id:'b1',page:1,text:'论文内容'}],snapshots:defaultPrompts().map(v=>v[0]),reviews:dimensions.map(d=>({dimension:d,summary:'<script>unsafe</script>',issues:[]}))}]};
 await fs.mkdir(path.join(data,'runs','legacy-run'),{recursive:true});
 await fs.writeFile(path.join(data,'runs','legacy-run','paper.pdf'),'%PDF-1.4 test');
 await fs.writeFile(path.join(data,'runs','legacy-run','page-1.png'),Buffer.from([137,80,78,71]));
 await fs.writeFile(path.join(data,'store.json'),JSON.stringify(original));
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,REVIEW_SKIP_ENV:'1',REVIEW_DATA_DIR:data,REVIEW_PORT:'0',CODEX_API_KEY:'fake-test-key',CODEX_BASE_URL:'https://example.invalid',REVIEW_CODEX_MODEL:'test',REVIEW_CODEX_BIN:path.join(data,'missing-cli.exe'),DEEPSEEK_API_KEY:'',MINERU_TOKEN:'fake-parser-key'}});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 const base=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',d=>{output+=d;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',code=>reject(Error('Server exited '+code+stderr)));});
 function client(){let cookie='';return async(url,options={})=>{
  const response=await fetch(base+url,{redirect:'manual',...options,headers:{...(cookie?{Cookie:cookie}:{}),...(typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});
  const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return response;
 };}
 const a=client(),b=client(),anonymous=client();
 const post=(body)=>({method:'POST',body:JSON.stringify(body)});
 try{
  assert.equal((await anonymous('/')).status,302);
  assert.equal((await anonymous('/api/runs')).status,401);
  assert.equal((await anonymous('/api/runs/legacy-run/pdf')).status,401);
  assert.equal((await anonymous('/login.html')).status,200);
  assert.equal((await anonymous('/.env')).status,404);
  // Every relocated browser asset must be served; private directories stay inaccessible.
  for(const url of ['/login.html','/register.html','/js/app.js','/js/auth.js','/js/portal.js','/css/style.css','/css/theme.css','/css/portal.css']){
   const response=await anonymous(url);assert.equal(response.status,200,url);
   const type=url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':'text/html';
   assert(response.headers.get('content-type').startsWith(type),url);
   assert((await response.text()).length>0,url);
  }
  for(const url of ['/src/server.mjs','/data/store.json','/local/tmp_forum.html','/config/oral-download.env','/package.json'])assert.equal((await anonymous(url)).status,404,url);
  assert.equal((await anonymous('/api/auth/register',post({username:'user_a',password:'short'}))).status,400);
  const registration=await a('/api/auth/register',post({username:'user_a',password:'test-password-a'}));assert.equal(registration.status,200);
  assert.match(registration.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const ua=(await registration.json()).user;assert.equal(ua.username,'user_a');assert.equal(ua.credentials,undefined);
  const index=await a('/');assert.equal(index.status,200);
  const html=await index.text();
  for(const match of html.matchAll(/(?:src|href)="(\/(?:js|css)\/[^\"]+)"/g))assert.equal((await a(match[1])).status,200,match[1]);
  assert.equal((await (await a('/api/runs')).json()).length,1);
  assert.equal((await a('/api/runs/legacy-run/pdf')).status,200);
  const report=await (await a('/api/runs/legacy-run/export')).text();assert(report.includes('&lt;script&gt;'));assert(!report.includes('<script>'));
  assert.equal((await a('/api/runs/legacy-run/export?format=json')).status,200);
  assert.equal((await b('/api/auth/register',post({username:'user_a',password:'different-password'}))).status,409);
  assert.equal((await b('/api/auth/register',post({username:'user_b',password:'test-password-b'}))).status,200);
  assert.deepEqual(await (await b('/api/runs')).json(),[]);
  for(const url of ['/api/runs/legacy-run','/api/runs/legacy-run/pdf','/api/runs/legacy-run/pages/1.png','/api/runs/legacy-run/export'])assert.equal((await b(url)).status,404);
  assert.equal((await a('/api/prompts/0',post({text:'账号 A 的重点',base_version:1}))).status,201);
  assert.equal((await a('/api/prompts/0',post({text:'过期',base_version:1}))).status,409);
  assert.equal((await a('/api/prompts/0',post({text:'',base_version:2}))).status,400);
  assert.equal((await (await b('/api/prompts')).json())[0].length,1);
  assert.equal((await a('/api/auth/logout',{method:'POST',headers:{Origin:'https://outside.invalid'}})).status,403);
  const db=openDatabase(path.join(data,'review.sqlite3'));
  assert(db.userByName('user_a').credentials.hash);assert(db.db.prepare('SELECT token_hash FROM sessions').all().every(s=>s.token_hash.length===64));
  assert.deepEqual(db.run('legacy-run').snapshots,original.runs[0].snapshots);db.close();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,'store.json'),'utf8')),original);
  // An invalid local CLI exercises the real job queue without a paid/network model call.
  for(const [provider,filename,content,status] of [['gpt','bad.pdf','not a PDF',400],['gpt','bad.txt','%PDF-1.4',400],['unknown','paper.pdf','%PDF-1.4',400],['deepseek','paper.pdf','%PDF-1.4',400]]){
   const invalid=new FormData();invalid.set('provider',provider);invalid.set('file',new Blob([content]),filename);
   assert.equal((await a('/api/review',{method:'POST',body:invalid})).status,status);
  }
  const form=new FormData();form.set('provider','gpt');form.set('run_id','legacy-run');form.set('metadata',JSON.stringify(metadata));
  const queued=await a('/api/review',{method:'POST',body:form});assert.equal(queued.status,202);
  const taskId=(await queued.json()).task_id;
  assert.equal((await b('/api/tasks/'+taskId)).status,404);
  let task;
  for(let i=0;i<60;i++){task=await (await a('/api/tasks/'+taskId)).json();if(task.status==='failed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(task.status,'failed',stderr);assert(!task.error.includes('fake-test-key'));
  // Multiple accepted jobs must all leave the queue, even when the previous one fails.
  const queuedIds=[];
  for(let i=0;i<2;i++){const next=await a('/api/review',{method:'POST',body:form});assert.equal(next.status,202);queuedIds.push((await next.json()).task_id);}
  for(const id of queuedIds){let done;for(let i=0;i<60;i++){done=await (await a('/api/tasks/'+id)).json();if(done.status==='failed')break;await new Promise(r=>setTimeout(r,50));}assert.equal(done.status,'failed');}

  const actualPrompt=await fs.readFile(path.join(data,'runs',taskId,'prompt.txt'),'utf8');assert(actualPrompt.includes('账号 A 的重点'));assert.equal(actualPrompt.split('严格输出 JSON').length-1,1);
  assert.equal((await a('/api/auth/password',post({current_password:'wrong',password:'new-test-password'}))).status,400);
  assert.equal((await a('/api/auth/password',post({current_password:'test-password-a',password:'new-test-password'}))).status,200);
  assert.equal((await a('/api/auth/me')).status,401);
  assert.equal((await a('/api/auth/login',post({username:'user_a',password:'test-password-a'}))).status,401);
  assert.equal((await a('/api/auth/login',post({username:'user_a',password:'new-test-password'}))).status,200);
  assert.equal((await a('/api/auth/logout',{method:'POST'})).status,200);
  assert.equal((await a('/api/auth/me')).status,401);
 }finally{
  child.kill();await once(child,'exit');
  assert(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep+'review-accounts-test-'));
  await fs.rm(data,{recursive:true,force:true});
 }
});
