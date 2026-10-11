import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {File} from 'node:buffer';
import {parseHTML} from 'linkedom';
import {dimensions,defaultPrompts,appendFocusVersion} from '../src/prompts.mjs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
import {reviewOptions} from '../src/standards.mjs';
import {metadata} from './helpers.mjs';
const settings=fs.readFileSync(new URL('../public/js/review-settings.js',import.meta.url),'utf8');
const portal=fs.readFileSync(new URL('../public/js/portal.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
function setup({empty=false,legacy=false}={}){
 const {document,Event,HTMLElement,HTMLInputElement,HTMLSelectElement}=parseHTML(html);
 // Geometry and form controls are browser facilities, mocked for DOM logic tests.
 HTMLElement.prototype.getBoundingClientRect=()=>({top:0,bottom:800,width:600,height:800});
 HTMLElement.prototype.scrollTo=function({top}){this.scrollTop=top;};
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{get:()=>600,configurable:true});
 Object.defineProperty(HTMLInputElement.prototype,'checked',{get(){return this.hasAttribute('checked');},set(v){this.toggleAttribute('checked',v);},configurable:true});
 Object.defineProperty(HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){this.querySelectorAll('option').forEach(o=>o.toggleAttribute('selected',o.value===v));},configurable:true});
 document.querySelectorAll('form').forEach(f=>f.reset=()=>{f.querySelectorAll('input').forEach(i=>{i.value='';if(i.type==='file')i.files=[];});});
 const store={prompts:defaultPrompts()},requests=[];
 const block={id:'b1',page:1,bbox:[100,100,600,140],text:'实验没有报告统计检验。'};
 const run={metadata:legacy?null:structuredClone(metadata),total_score:legacy?null:82,grade:legacy?null:'B／良好',report:{status:'ready'},id:'run-one',filename:'test-paper.pdf',created_at:'2026-01-01',page_count:1,page_sizes:[[595,842]],coordinate_size:[1000,1000],source_pdf:'/api/runs/run-one/pdf',model:'test-gpt',snapshots:defaultPrompts().map(v=>v[0]),blocks:[block],reviews:dimensions.map((dimension,i)=>({dimension,summary:'总结',issues:[{id:'issue-'+i,title:'意见 '+i,severity:i===0?'major':'minor',detail:'详细意见',suggestion:'建议',evidence_ids:['b1'],evidence:[block]}]}))};
 const context=vm.createContext({document,console,Event,FormData,Blob,File,URL,URLSearchParams,Date,structuredClone,
  location:{hash:'',href:'',replace(url){this.href=url;}},history:{replaceState(_a,_b,value){context.location.hash=value;}},
  requestAnimationFrame:fn=>{fn();return 1;},setInterval:()=>1,setTimeout:(fn,delay)=>{if(delay===2000)queueMicrotask(fn);return 1;},clearTimeout(){},addEventListener(){},
  fetch:async(url,options={})=>{
   requests.push({url,options});let data;
   if(url==='/api/auth/me')data={user:{username:'tester',phone:'',created_at:'2026-01-01'}};
   else if(url==='/api/review-options')data=reviewOptions();
   else if(url==='/api/review-preview')data={prompt:'平台默认评审标准预览',metadata:JSON.parse(options.body).metadata};
   else if(url==='/api/config/status')data={mineru_configured:true,models:[{id:'gpt',model:'test-gpt',configured:true},{id:'deepseek',configured:false}]};
   else if(url==='/api/runs')data=empty?[]:[{...run,issue_count:6}];
   else if(url==='/api/tasks')data=[];
   else if(url==='/api/runs/run-one')data=run;
   else if(url==='/api/prompts')data=store.prompts;
   else if(url.startsWith('/api/prompts/'))data=appendFocusVersion(store,Number(url.split('/').at(-1)),JSON.parse(options.body));
   else if(url==='/api/review')data={task_id:'test-task'};
   else if(url==='/api/tasks/test-task')data={status:'succeeded',progress:100,message:'完成',run:{...run,id:'run-two',snapshots:store.prompts.map(v=>v.at(-1))}};
   else if(url==='/api/auth/logout')data={ok:true};
   else throw Error('Unexpected mock request '+url);
   return {ok:true,status:200,json:async()=>structuredClone(data)};
  }
 });
 context.window=context;
 vm.runInContext(app,context);vm.runInContext(settings,context);vm.runInContext(portal,context);
 const $=id=>document.getElementById(id);
 const click=node=>node.dispatchEvent(new Event('click',{bubbles:true}));
 const event=(node,type)=>node.dispatchEvent(new Event(type,{bubbles:true,cancelable:true}));
 return {context,document,$,click,event,requests,store,run};
}

test('actual HTML/scripts: dashboard, navigation, filters, details and evidence links',async()=>{
 const h=setup();await tick();
 assert.equal(h.$('current-username').textContent,'tester');assert.equal(h.$('stat-done').textContent,'1');
 h.click(h.document.querySelector('[data-open-run]'));await tick();
 assert.equal(h.$('page-workspace').classList.contains('hidden'),false);
 assert.equal(h.document.querySelectorAll('.issue').length,6);
 assert.equal(h.document.querySelectorAll('.evidence-highlight').length,6);
 h.click(h.document.querySelector('[data-expand]'));assert.equal(h.document.querySelector('.issue-details').classList.contains('hidden'),false);
 h.click(h.document.querySelector('[data-filter="2"]'));assert.equal(h.document.querySelectorAll('.issue').length,1);
 h.click(h.document.querySelector('[data-pdf-issue="issue-0"]'));assert.equal(h.document.querySelectorAll('.issue').length,6);assert(h.$('issue-issue-0').classList.contains('selected'));
 h.click(h.document.querySelector('[data-page="profile"]'));assert(!h.$('page-profile').classList.contains('hidden'));
});

test('actual editor: save custom focus, rerun selected model, preserve latest snapshot',async()=>{
 const h=setup();await tick();
 h.click(h.document.querySelector('[data-page="workspace"]'));
 h.click(h.document.querySelector('[data-tab="prompts"]'));await tick();
 assert.equal(h.$('prompt-text').readOnly,false);
 h.$('prompt-text').value='检查变量控制与统计检验';h.event(h.$('prompt-text'),'input');
 h.click(h.$('rerun-top'));await tick();assert.equal(h.requests.filter(r=>r.url==='/api/review').length,0);
 h.click(h.$('save-prompt'));await tick();assert.equal(h.store.prompts[0].at(-1).text,'检查变量控制与统计检验');
 h.click(h.$('rerun-top'));await tick();
 const request=h.requests.find(r=>r.url==='/api/review');assert(request);assert.equal(request.options.body.get('provider'),'gpt');assert.equal(request.options.body.get('run_id'),'run-one');
 assert.equal(vm.runInContext('realRun.snapshots[0].version',h.context),2);
 assert(h.$('run-overlay').classList.contains('hidden'));
 h.$('review-model').value='deepseek';h.event(h.$('review-model'),'change');assert.equal(h.$('rerun-top').disabled,true);
});

test('actual upload form: PDF submission, invalid file rejection and empty-account workspace',async()=>{
 const h=setup({empty:true});await tick();
 h.click(h.document.querySelector('[data-page="workspace"]'));assert(!h.$('workspace-empty').classList.contains('hidden'));
 h.click(h.document.querySelector('[data-page="review"]'));
 h.$('paper-file').files=[new File(['%PDF-1.4'],'paper.pdf',{type:'application/pdf'})];h.event(h.$('paper-file'),'change');
 for(const [key,value] of Object.entries(metadata))h.$('upload-'+key).value=value;
 h.event(h.$('review-form'),'submit');await tick();
 const request=h.requests.find(r=>r.url==='/api/review');assert.equal(request.options.body.get('file').name,'paper.pdf');assert.equal(request.options.body.get('provider'),'gpt');
 h.$('paper-file').files=[new File(['text'],'not-pdf.txt')];h.event(h.$('paper-file'),'change');h.event(h.$('review-form'),'submit');await tick();
 assert.equal(h.requests.filter(r=>r.url==='/api/review').length,1);assert(!h.$('upload-error').classList.contains('hidden'));
});

test('an opinion without located evidence does not claim a fabricated page or evidence count',async()=>{
 const h=setup();await tick();
 h.run.reviews[0].issues[0].evidence=[];h.run.reviews[0].issues[0].evidence_ids=[];
 h.context.testRun=h.run;vm.runInContext('normalizeRun(testRun);renderAll()',h.context);
 const issue=h.$('issue-issue-0');assert(!issue.textContent.includes('1 处证据'));assert(!issue.textContent.includes('第 1 页'));assert(issue.textContent.includes('未定位到原文证据'));
});

test('batch metadata overrides affect only their own paper and preview uses the final parameters',async()=>{
 const h=setup({empty:true});await tick();
 for(const [key,value] of Object.entries(metadata))h.$('upload-'+key).value=value;
 h.$('paper-file').files=[new File(['%PDF-1.4'],'first.pdf'),new File(['%PDF-1.4'],'second.pdf')];h.event(h.$('paper-file'),'change');
 h.$('file-1-degree_type').value='academic_doctor';h.event(h.$('file-1-degree_type'),'change');h.$('file-1-major').value='艺术理论';h.event(h.$('file-1-major'),'input');
 h.click(h.document.querySelector('[data-file-preview="1"]'));await tick();const preview=h.requests.find(r=>r.url==='/api/review-preview');assert.equal(JSON.parse(preview.options.body).metadata.degree_type,'academic_doctor');
 h.event(h.$('review-form'),'submit');await tick();const submissions=h.requests.filter(r=>r.url==='/api/review');assert.equal(submissions.length,2);
 const a=JSON.parse(submissions[0].options.body.get('metadata')),b=JSON.parse(submissions[1].options.body.get('metadata'));assert.equal(a.degree_type,'academic_master');assert.equal(a.major,metadata.major);assert.equal(b.degree_type,'academic_doctor');assert.equal(b.major,'艺术理论');assert.equal(b.completion_month,metadata.completion_month);
});

test('legacy rerun requires metadata and history filters distinguish degree and grade',async()=>{
 const h=setup({legacy:true});await tick();h.click(h.$('rerun-top'));await tick();assert.equal(h.requests.filter(r=>r.url==='/api/review').length,0);assert(h.$('toast').textContent.includes('学位'));
 const normal=setup();await tick();normal.$('history-degree').value='academic_doctor';normal.event(normal.$('history-degree'),'change');assert(normal.$('archive-list').textContent.includes('没有匹配'));
 normal.$('history-degree').value='academic_master';normal.$('history-grade').value='B';normal.event(normal.$('history-grade'),'change');assert(normal.$('archive-list').querySelector('[data-open-run]'));
});

test('history search, export, PDF controls, mobile navigation and logout are wired',async()=>{
 const h=setup();await tick();
 h.click(h.document.querySelector('[data-page="history"]'));
 h.$('history-search').value='does-not-exist';h.event(h.$('history-search'),'input');assert(h.$('archive-list').textContent.includes('没有匹配'));
 h.$('history-search').value='test-paper';h.event(h.$('history-search'),'input');assert(h.$('archive-list').querySelector('[data-open-run]'));
 assert.equal(h.$('archive-list').querySelector('a[href*="format=json"]').getAttribute('href'),'/api/runs/run-one/export?format=json');
 h.click(h.$('export'));assert.equal(h.context.location.href,'/api/runs/run-one/export?format=pdf');
 h.click(h.$('zoom-in'));assert.equal(h.$('zoom-label').textContent,'110%');
 h.click(h.$('fit-page'));assert.equal(h.$('zoom-label').textContent,'100%');
 h.$('highlight-toggle').checked=false;h.event(h.$('highlight-toggle'),'change');assert.equal(h.document.querySelectorAll('.evidence-highlight').length,0);
 h.$('highlight-toggle').checked=true;h.event(h.$('highlight-toggle'),'change');assert.equal(h.document.querySelectorAll('.evidence-highlight').length,6);
 h.click(h.$('mobile-menu-btn'));assert.equal(h.$('mobile-menu-btn').getAttribute('aria-expanded'),'true');
 h.click(h.$('sidebar-overlay'));assert.equal(h.$('mobile-menu-btn').getAttribute('aria-expanded'),'false');
 h.click(h.$('logout-btn'));await tick();assert.equal(h.context.location.href,'/login.html');
});

test('login/register forms submit credentials and show a useful error for mismatched passwords',async()=>{
 for(const register of [false,true]){
  const page=fs.readFileSync(new URL(register?'../public/register.html':'../public/login.html',import.meta.url),'utf8');
  const {document,Event}=parseHTML(page),requests=[];
  const context=vm.createContext({document,window:{location:{replace(url){context.destination=url;}}},fetch:async(url,options)=>{requests.push({url,data:JSON.parse(options.body)});return {ok:true,json:async()=>({user:{username:'tester'}})};}});
  vm.runInContext(fs.readFileSync(new URL('../public/js/auth.js',import.meta.url),'utf8'),context);
  document.getElementById(register?'reg-username':'login-username').value='tester';
  document.getElementById(register?'reg-password':'login-password').value='test-password';
  if(register){document.getElementById('reg-confirm').value='mismatch';document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.equal(requests.length,0);assert(!document.getElementById('auth-message').classList.contains('hidden'));document.getElementById('reg-confirm').value='test-password';}
  document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  assert.equal(requests[0].url,register?'/api/auth/register':'/api/auth/login');assert.equal(context.destination,'/#dashboard');
 }
});
