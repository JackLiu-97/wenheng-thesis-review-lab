import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {blocks,metadata,detailedFixture,synthesisFixture} from './helpers.mjs';

// Stored ZIP entries use the real MinerU extraction path, without an external service.
function zip(files){
 const crc=buffer=>{let c=0xffffffff;for(const byte of buffer){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 let offset=0;const local=[],central=[];
 for(const [name,value] of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(30),c=Buffer.alloc(46),checksum=crc(data);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(checksum,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(checksum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
 }
 const entries=Object.keys(files).length,cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries,8);end.writeUInt16LE(entries,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end]);
}
function tinyPdf(){const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>','<< /Length 53 >>\nstream\nBT /F1 12 Tf 50 780 Td (Synthetic review paper.) Tj ET\nendstream','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>','<< /Length 53 >>\nstream\nBT /F1 12 Tf 50 780 Td (Synthetic evidence page.) Tj ET\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];let text='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`;}const xref=Buffer.byteLength(text);text+=`xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(text);}

test('real HTTP upload, two model stages, browser workflow and PDF download',{timeout:120000},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));const data=await fs.mkdtemp(path.join(os.tmpdir(),'review-http-v2-'));
 const archive=zip({'content_list.json':blocks.map(b=>({type:b.type,text:b.text,page_idx:b.page-1,bbox:b.bbox})),'layout.json':{pdf_info:[{page_size:[595,842]},{page_size:[595,842]}]}});
 const calls=[],modelRequests=[];let mockBase;
 const mock=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const send=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(req.url==='/api/v4/file-urls/batch')return send({data:{batch_id:'fixture-batch',file_urls:[mockBase+'/upload']}});
  if(req.url==='/upload'){assert(Buffer.concat(chunks).subarray(0,5).equals(Buffer.from('%PDF-')));return send({ok:true});}
  if(req.url==='/api/v4/extract-results/batch/fixture-batch')return send({data:{extract_result:[{state:'done',full_zip_url:mockBase+'/zip'}]}});
  if(req.url==='/zip')return res.end(archive);
  if(req.url==='/chat/completions'){
   const body=JSON.parse(Buffer.concat(chunks));const prompt=body.messages[0].content;calls.push(prompt);modelRequests.push({model:body.model,authorization:req.headers.authorization});
   let result;if(prompt.includes('已完成评审：')){const reviews=JSON.parse(prompt.split('已完成评审：')[1]),fixed=JSON.parse(prompt.match(/固定分数与建议：(.*)\n/)[1]);result=synthesisFixture({...fixed,reviews});}else result=detailedFixture();
   return send({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  }
  res.statusCode=404;res.end();
 });mock.listen(0,'127.0.0.1');await once(mock,'listening');mockBase='http://127.0.0.1:'+mock.address().port;
 const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,REVIEW_SKIP_ENV:'1',REVIEW_DATA_DIR:data,REVIEW_DATABASE_PATH:path.join(data,'review.sqlite3'),REVIEW_PORT:'0',MINERU_TOKEN:'fixture-parser',MINERU_API_BASE:mockBase+'/api/v4',CODEX_API_KEY:'',REVIEW_CODEX_MODEL:'gpt-6.1-sol',DEEPSEEK_API_KEY:'fixture-model',DEEPSEEK_MODEL:'',DEEPSEEK_FLASH_MODEL:'deepseek-flash',DEEPSEEK_PRO_MODEL:'deepseek-v4-pro',DEEPSEEK_BASE_URL:mockBase}});
 let diagnostics='';server.stderr.on('data',b=>diagnostics+=b);let browser;
 try{
  const base=await new Promise((resolve,reject)=>{let text='';server.stdout.on('data',b=>{text+=b;const match=text.match(/http:\/\/127.0.0.1:\d+/);if(match)resolve(match[0]);});server.on('error',reject);server.on('exit',()=>reject(Error(diagnostics)));});
  const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'workflow_user',password:'workflow-password'})});assert.equal(registration.status,200);const cookie=registration.headers.get('set-cookie').split(';')[0];
  const request=(url,options={})=>fetch(base+url,{...options,headers:{Cookie:cookie,...options.headers}});
  const options=await (await request('/api/review-options')).json();assert.equal(Object.keys(options.degrees).length,4);
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:'review_session',value:cookie.split('=')[1],url:base}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/#review');
  await page.waitForFunction(()=>document.getElementById('upload-degree_type')?.options.length===5);
  const expected=['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','deepseek-flash','deepseek-v4-pro'];
  assert.deepEqual(options.models.map(m=>m.id),expected);
  for(const selector of ['#upload-model','#review-model'])assert.deepEqual(await page.locator(selector+' option').evaluateAll(items=>items.map(o=>o.value)),expected);
  await page.locator('#upload-model').selectOption('deepseek-flash');
  await page.locator('#paper-file').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:tinyPdf()});
  await page.locator('#upload-degree_type').selectOption(metadata.degree_type);await page.locator('#upload-discipline').selectOption(metadata.discipline);await page.locator('#upload-major').fill(metadata.major);await page.locator('#upload-completion_month').fill(metadata.completion_month);
  await page.locator('#preview-standard').click();await page.waitForFunction(()=>document.getElementById('standard-preview-text').textContent.includes('平台默认评审标准'));
  const output=path.join(root,'data','ui-verification');await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'upload-desktop.png'),fullPage:true});
  await page.locator('#submit-btn').click();
  let task;for(let n=0;n<90;n++){const tasks=await (await request('/api/tasks')).json();task=tasks[0];if(task?.status==='failed')throw Error(task.error);if(task?.status==='succeeded'&&task.report?.status==='ready')break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(task?.status,'succeeded',diagnostics);assert.equal(task.report?.status,'ready');assert.equal(calls.length,2);assert(calls[0].includes(metadata.major));assert(calls[1].includes('固定分数与建议'));
  const run=await (await request('/api/runs/'+task.run_id)).json();assert.equal(run.total_score,82);assert.equal(run.recommendation,'修改后答辩');assert.equal(run.metadata.degree_type,metadata.degree_type);assert.equal(run.model,'deepseek-flash');assert.equal(run.provider,'deepseek');
  await page.goto(base+'/#workspace/'+task.run_id);await page.waitForSelector('.total-score');assert.equal(await page.locator('.total-score').textContent(),'82.0');await page.waitForFunction(()=>{const image=document.querySelector('.paper-page img');return image?.complete&&image.naturalWidth>0;});await page.screenshot({path:path.join(output,'results-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'results-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile page overflows horizontally');
  const pdf=await request(`/api/runs/${run.id}/export?format=pdf`);assert.equal(pdf.status,200);const bytes=Buffer.from(await pdf.arrayBuffer());assert(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));await fs.writeFile(path.join(output,'fixed-response-report.pdf'),bytes);
  const second=await request(`/api/runs/${run.id}/export?format=pdf`);assert.deepEqual(Buffer.from(await second.arrayBuffer()),bytes);assert.equal(calls.length,2,'PDF downloads must not call the model');assert.deepEqual(errors,[]);
  assert.equal(await page.locator('#review-model').inputValue(),'deepseek-flash');
  await page.locator('#review-model').selectOption('deepseek-v4-pro');await page.locator('#rerun-top').click();
  await page.waitForFunction(()=>document.querySelector('#model-status')?.textContent==='deepseek-v4-pro'&&document.querySelector('.total-score')&&document.querySelector('#run-overlay')?.classList.contains('hidden'),{},{timeout:45000});
  const runs=await (await request('/api/runs')).json();const proSummary=runs.find(r=>r.model==='deepseek-v4-pro');assert(proSummary);
  const pro=await (await request('/api/runs/'+proSummary.id)).json();assert.equal(pro.provider,'deepseek');assert.equal(pro.paper_version_id,run.paper_version_id);assert.equal(pro.parent_run_id,run.id);
  assert.deepEqual(modelRequests.map(r=>r.model),['deepseek-flash','deepseek-flash','deepseek-v4-pro','deepseek-v4-pro']);assert(modelRequests.every(r=>r.authorization==='Bearer fixture-model'));
  await page.goto(base+'/#workspace/'+run.id);await page.waitForFunction(()=>document.querySelector('#review-model').value==='deepseek-flash');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks:['upload form','standard preview','real HTTP parser protocol','two model stages','persisted score','desktop/mobile browser','PDF download idempotence'],model:'fixed local response; no external services',score:run.total_score,browser_errors:errors},null,2));
 }finally{
  if(browser)await browser.close();server.kill();if(server.exitCode===null)await once(server,'exit');await new Promise(resolve=>mock.close(resolve));
  assert(path.dirname(path.resolve(data))===path.resolve(os.tmpdir())&&path.basename(data).startsWith('review-http-v2-'));await fs.rm(data,{recursive:true,force:true});
 }
});
