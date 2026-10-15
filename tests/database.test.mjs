import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDetailed} from '../src/review-schema.mjs';
import {openDatabase,dropDatabase} from '../src/database.mjs';
import {fixtureRepo,blocks,detailedFixture,testDatabaseConfig} from './helpers.mjs';

test('schema migrations apply once and a changed migration is refused',async()=>{
 const config=testDatabaseConfig();
 try{
  const first=await openDatabase(config);const applied=await first.q('SELECT version FROM schema_migrations');await first.close();
  const second=await openDatabase(config);assert.deepEqual(await second.q('SELECT version FROM schema_migrations'),applied);
  await second.q("UPDATE schema_migrations SET checksum='changed' WHERE version=1");await second.close();
  await assert.rejects(openDatabase(config),/迁移校验不一致/);
 }finally{await dropDatabase(config);}
});

test('runs keep evidence on their own parse and revisions add versions without replacing files',async()=>{
 const f=await fixtureRepo();try{
  const a=await f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);await f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);
  const run=await f.repo.saveRun(f.task.id,a.id,validateDetailed(detailedFixture(),blocks,f.request,f.task.id));
  const stored=await f.repo.q('SELECT DISTINCT b.parse_result_id FROM issue_evidence e JOIN document_blocks b ON b.id=e.block_id JOIN review_issues i ON i.id=e.issue_id JOIN dimension_reviews d ON d.id=i.dimension_review_id WHERE d.run_id=?',[run.id]);
  assert.deepEqual(stored.map(r=>r.parse_result_id),[a.id]);assert.equal(run.reviews[0].issues[0].evidence[0].text,blocks[0].text);
  // Evidence must point at an existing block (foreign key).
  await assert.rejects(f.repo.insert('issue_evidence',{issue_id:run.reviews[0].issues[0].id,block_id:'missing:b9',sequence_no:9}),/foreign key/i);
  const revision=await f.repo.createVersion({owner:f.user.id,paperId:f.version.paper_id,filename:'revised.pdf',storagePath:f.version.storage_path,metadata:f.request.metadata});
  assert.equal(revision.version_no,2);assert.equal(revision.paper_id,f.version.paper_id);assert.equal((await f.repo.version(f.version.id)).version_no,1);
  await assert.rejects(f.repo.createVersion({owner:'stranger',paperId:f.version.paper_id}),{status:404});
  assert.equal(await f.repo.run(run.id,'stranger'),null);
 }finally{await f.cleanup();}
});

test('a failed transaction leaves no partial rows',async()=>{
 const f=await fixtureRepo();try{
  const before=await f.repo.count('papers');
  await assert.rejects(f.repo.transaction(async tx=>{await tx.createVersion({owner:f.user.id,filename:'x.pdf',storagePath:'/tmp/x.pdf',metadata:f.request.metadata});throw Error('boom');}),/boom/);
  assert.equal(await f.repo.count('papers'),before);
 }finally{await f.cleanup();}
});

test('task log records stage messages and attempts; failed tasks can be dismissed from the list',async()=>{
 const f=await fixtureRepo();try{
  await f.repo.updateTask(f.task.id,{status:'running',stage:'reviewing',message:'模型正在进行六维度详细评审'});
  const attempt=await f.repo.attempt(f.task.id,'reviewing','prompt.txt');await f.repo.finishAttempt(attempt.id,'failed',null,'DeepSeek 输出不完整');
  await f.repo.updateTask(f.task.id,{progress:50});
  await f.repo.updateTask(f.task.id,{status:'failed',message:'评审未完成，可从已完成阶段重试',error:'DeepSeek 输出不完整'});
  const log=await f.repo.taskLog(f.task.id);
  assert.deepEqual(log.map(e=>e.level),['info','info','info','warning','error']);
  assert(log[3].message.includes('第 1 次模型调用失败'));assert.equal(log.at(-1).message,'DeepSeek 输出不完整');
  await assert.rejects(f.repo.dismissTask('missing',f.user.id),/不存在/);
  await f.repo.dismissTask(f.task.id,f.user.id);assert.equal((await f.repo.tasks(f.user.id)).length,0);assert(await f.repo.task(f.task.id));
 }finally{await f.cleanup();}
});

test('legacy one-line default prompts upgrade once; edited prompts are kept',async()=>{
 const {legacyDefaultFocus,defaultFocus}=await import('../src/prompts.mjs');
 const f=await fixtureRepo();try{
  // Simulate an account created before the upgrade: latest prompt is the old default, except one edited dimension.
  await f.repo.q('UPDATE prompt_versions SET text=? WHERE owner_id=? AND dimension_code=?',['自定义提示词',f.user.id,'d2']);
  for(const [i,text] of legacyDefaultFocus.entries())if(i!==1)await f.repo.q('UPDATE prompt_versions SET text=? WHERE owner_id=? AND dimension_code=?',[text,f.user.id,`d${i+1}`]);
  assert.equal(await f.repo.upgradeDefaultPrompts(),5);assert.equal(await f.repo.upgradeDefaultPrompts(),0);
  const prompts=await f.repo.prompts(f.user.id);
  assert.equal(prompts[0].at(-1).text,defaultFocus()[0]);assert.equal(prompts[0].at(-1).version,2);
  assert.equal(prompts[1].at(-1).text,'自定义提示词');assert.equal(prompts[1].length,1);
 }finally{await f.cleanup();}
});

test('concurrent prompt saves on the same base produce exactly one new version',async()=>{
 const f=await fixtureRepo();try{
  const base=(await f.repo.prompts(f.user.id))[0].at(-1).version;
  const results=await Promise.allSettled([1,2,3].map(n=>f.repo.appendPrompt(f.user.id,0,{text:'并发 '+n,base_version:base})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===409||/Deadlock/i.test(r.reason.message)));
  assert.equal((await f.repo.prompts(f.user.id))[0].length,base+1);
 }finally{await f.cleanup();}
});
