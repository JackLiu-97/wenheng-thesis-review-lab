import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixtureRepo,blocks,detailedFixture,synthesisFixture} from './helpers.mjs';
import {validateDetailed} from '../src/review-schema.mjs';
import {createReviewEngine} from '../src/review-engine.mjs';
import {createReportService} from '../src/reports.mjs';

test('context preflight retry preserves old snapshot and reuses parse with corrected budget',async()=>{
 const f=await fixtureRepo();let parses=0,calls=0;try{
  const largeBlocks=[blocks[0],{...blocks[1],text:'论文内容'.repeat(17000)}];
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{currentConfig:()=>({...f.request.model_config,context_tokens:1050000}),parse:async()=>{parses++;return {blocks:largeBlocks,pageSizes:[]};},model:async(_p,dir,config,schema)=>{
   calls++;assert.equal(config.context_tokens,1050000);
   return schema.properties.dimensions?detailedFixture():synthesisFixture(validateDetailed(detailedFixture(),largeBlocks,f.request,path.basename(dir)));
  }});
  await engine.enqueue(f.task.id);assert.equal(f.repo.task(f.task.id).status,'failed');assert.equal(calls,0);
  const id=engine.retry(f.task.id,f.user.id);assert.notEqual(id,f.task.id);
  const task=f.repo.task(id);assert.equal(task.request.retry_of_task_id,f.task.id);assert.deepEqual(task.request.snapshots,f.request.snapshots);assert.equal(task.paper_version_id,f.version.id);
  assert.equal(f.repo.task(f.task.id).request.model_config.context_tokens,128000);
  await engine.enqueue(id);assert.equal(f.repo.task(id).status,'succeeded');assert.equal(parses,1);assert.equal(calls,2);
 }finally{await f.cleanup();}
});
test('failed synthesis resumes without repeating parse or detailed model call',async()=>{
 const f=await fixtureRepo();let parses=0,details=0,syntheses=0;try{
  const result=validateDetailed(detailedFixture(),blocks,f.request,f.task.id);let fail=true;
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{parse:async()=>{parses++;return {blocks,pageSizes:[]};},model:async(_p,_d,_c,schema)=>{if(schema.properties.dimensions){details++;return detailedFixture();}syntheses++;if(fail)throw Error('configuration error');return synthesisFixture(result);}});
  await engine.enqueue(f.task.id);assert.equal(f.repo.task(f.task.id).stage,'synthesizing');assert.equal(f.repo.task(f.task.id).status,'failed');assert(f.repo.task(f.task.id).checkpoint);
  fail=false;engine.retry(f.task.id,f.user.id);await engine.enqueue(f.task.id);assert.equal(f.repo.task(f.task.id).status,'succeeded');assert.equal(parses,1);assert.equal(details,1);assert.equal(syntheses,2);
 }finally{await f.cleanup();}
});
test('retry after an output budget change uses current config and keeps completed stages',async()=>{
 const f=await fixtureRepo();let parses=0,details=0,budgets=[];try{
  let output=f.request.model_config.output_tokens;
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{currentConfig:()=>({...f.request.model_config,output_tokens:output}),parse:async()=>{parses++;return {blocks,pageSizes:[]};},model:async(_p,_d,config,schema)=>{
   if(schema.properties.dimensions){details++;return detailedFixture();}
   budgets.push(config.output_tokens);if(config.output_tokens<64000)throw Error('truncated');return synthesisFixture(validateDetailed(detailedFixture(),blocks,f.request,f.task.id));
  }});
  await engine.enqueue(f.task.id);assert.equal(f.repo.task(f.task.id).status,'failed');
  output=64000;const id=engine.retry(f.task.id,f.user.id);assert.notEqual(id,f.task.id);
  assert.equal(f.repo.task(id).request.model_config.output_tokens,64000);assert.equal(f.repo.task(f.task.id).request.model_config.output_tokens,f.request.model_config.output_tokens);
  await engine.enqueue(id);assert.equal(f.repo.task(id).status,'succeeded');assert.equal(parses,1);assert.equal(details,1);assert.deepEqual(budgets,[f.request.model_config.output_tokens,64000]);
 }finally{await f.cleanup();}
});
test('429 retries twice, malformed output corrects once, authentication failures do not loop',async()=>{
 const f=await fixtureRepo();let calls=0;try{
  const result=validateDetailed(detailedFixture(),blocks,f.request,f.task.id);
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{sleep:async()=>{},parse:async()=>({blocks,pageSizes:[]}),model:async(_p,_d,_c,schema)=>{calls++;if(calls<=2)throw Object.assign(Error('429'),{httpStatus:429});if(calls===3)return '{}';return schema.properties.dimensions?detailedFixture():synthesisFixture(result);}});
  await engine.enqueue(f.task.id);assert.equal(calls,5);assert.equal(f.repo.task(f.task.id).status,'succeeded');
  const task=f.repo.createTask({...f.task,id:'auth-failure',request:f.request});let failed=0;
  const failing=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{model:async()=>{failed++;throw Object.assign(Error('401'),{httpStatus:401});}});await failing.enqueue(task.id);assert.equal(failed,1);assert.equal(f.repo.task(task.id).status,'failed');
 }finally{await f.cleanup();}
});
test('invalid output after correction remains failed and stores actual attempts',async()=>{
 const f=await fixtureRepo();try{let calls=0;const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{parse:async()=>({blocks,pageSizes:[]}),model:async()=>{calls++;return '{}';}});await engine.enqueue(f.task.id);assert.equal(calls,2);assert.equal(f.repo.task(f.task.id).status,'failed');const rows=f.repo.db.prepare('SELECT * FROM review_attempts').all();assert.equal(rows.length,2);assert(rows.every(r=>r.output_path&&r.error));}finally{await f.cleanup();}
});
test('restart preserves queued tasks and interrupts in-flight calls and reports',async()=>{
 const f=await fixtureRepo();try{
  f.repo.createTask({...f.task,id:'running-task',request:f.request});f.repo.updateTask('running-task',{status:'running',stage:'reviewing'});f.repo.attempt('running-task','reviewing','input.txt');
  const queued=f.repo.recover();assert.deepEqual(queued,[f.task.id]);assert.equal(f.repo.task('running-task').status,'interrupted');assert.equal(f.repo.db.prepare('SELECT status FROM review_attempts').get().status,'interrupted');
 }finally{await f.cleanup();}
});
test('report failure is isolated; generating and ready report requests are idempotent',async()=>{
 const f=await fixtureRepo();try{
  const parse=f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);f.repo.saveRun(f.task.id,parse.id,validateDetailed(detailedFixture(),blocks,f.request,f.task.id));let count=0,fail=true;
  const reports=createReportService(f.repo,f.dir,{generate:async()=>{count++;if(fail)throw Error('renderer unavailable');const file=path.join(f.dir,'result.pdf');await fs.writeFile(file,'%PDF-1.4 test');return {path:file,sha256:'x',generated_at:new Date().toISOString()};}});
  const p=reports.request(f.task.id);assert.equal(p,reports.request(f.task.id));await p;assert.equal(f.repo.report(f.task.id).status,'failed');assert(f.repo.run(f.task.id));
  fail=false;await reports.request(f.task.id);await reports.request(f.task.id);assert.equal(count,2);assert.equal(f.repo.report(f.task.id).status,'ready');
  await fs.unlink(path.join(f.dir,'result.pdf'));await reports.request(f.task.id);assert.equal(count,3,'Missing file should regenerate without model calls');
 }finally{await f.cleanup();}
});
test('a byte-identical PDF reuses the earlier parse instead of calling the parser again',async()=>{
 const f=await fixtureRepo();let parses=0;try{
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{parse:async()=>{parses++;return {blocks,pageSizes:[]};},model:async(_p,dir,_c,schema)=>schema.properties.dimensions?detailedFixture():synthesisFixture(validateDetailed(detailedFixture(),blocks,f.request,path.basename(dir)))});
  await engine.enqueue(f.task.id);assert.equal(f.repo.task(f.task.id).status,'succeeded');
  // Same bytes uploaded again as a new paper, and a different file.
  const same=f.repo.createVersion({owner:f.user.id,filename:'copy.pdf',storagePath:f.version.storage_path,metadata:f.request.metadata,bytes:Buffer.from('%PDF-1.4 fake')});
  const other=f.repo.createVersion({owner:f.user.id,filename:'other.pdf',storagePath:f.version.storage_path,metadata:f.request.metadata,bytes:Buffer.from('%PDF-1.4 different')});
  const again=f.repo.createTask({id:'same-file',owner_id:f.user.id,paper_version_id:same.id,provider:'gpt',model:'fixture-model',request:f.request});
  await engine.enqueue(again.id);assert.equal(f.repo.task(again.id).status,'succeeded');assert.equal(parses,1);
  const run=f.repo.run(f.repo.task(again.id).run_id);assert.equal(run.paper_version_id,same.id);assert.equal(run.blocks.length,blocks.length);
  assert(f.repo.taskLog(again.id).some(e=>e.message.includes('已复用此前的解析结果')));
  assert.notEqual(f.repo.latestParse(same.id).id,f.repo.latestParse(f.version.id).id);
  const different=f.repo.createTask({id:'other-file',owner_id:f.user.id,paper_version_id:other.id,provider:'gpt',model:'fixture-model',request:f.request});
  await engine.enqueue(different.id);assert.equal(parses,2);
 }finally{await f.cleanup();}
});
