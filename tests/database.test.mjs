import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {migrateLegacy} from '../src/migration.mjs';
import {openDatabase} from '../src/database.mjs';
import {defaultPrompts} from '../src/prompts.mjs';
import {validateDetailed} from '../src/review-schema.mjs';
import {fixtureRepo,blocks,detailedFixture} from './helpers.mjs';
test('dry-run and migration preserve old records, files, prompts, ownership and null scores',async()=>{
 const f=await fixtureRepo();try{
  const source=path.join(f.dir,'store.json'),target=path.join(f.dir,'migrated.sqlite3');
  const original={prompts:defaultPrompts(),users:[{...f.user,prompts:defaultPrompts()}],sessions:[],tasks:[{task_id:'failed-task',owner_id:f.user.id,provider:'gpt',status:'failed',created_at:'2025-01-01'}],runs:[{id:'legacy-one',owner_id:f.user.id,filename:'missing.pdf',created_at:'2025-01-01',snapshots:defaultPrompts().map(v=>v.at(-1)),reviews:detailedFixture().dimensions,blocks}]};
  await fs.writeFile(source,JSON.stringify(original));
  const preview=migrateLegacy({source,target,dataDir:f.dir,dryRun:true});assert.equal(preview.counts.missing_files.length,1);await assert.rejects(fs.access(target));
  const done=migrateLegacy({source,target,dataDir:f.dir});assert.equal(done.mode,'migrated');assert.equal(migrateLegacy({source,target,dataDir:f.dir}).mode,'already-migrated');
  const db=openDatabase(target);try{const run=db.run('legacy-one',f.user.id);assert.equal(run.total_score,null);assert.equal(run.metadata,null);assert.equal(run.assessment_status,'legacy');assert.deepEqual(run.snapshots,original.runs[0].snapshots);assert.equal(run.reviews[0].issues[0].evidence[0].text,blocks[0].text);assert.equal(db.run('legacy-one','stranger'),null);assert.equal(db.tasks(f.user.id).length,2);assert.equal(db.db.pragma('foreign_key_check').length,0);}finally{db.close();}
  assert.deepEqual(JSON.parse(await fs.readFile(source,'utf8')),original);assert.deepEqual(JSON.parse(await fs.readFile(done.backup,'utf8')),original);
 }finally{await f.cleanup();}
});
test('failed migration cannot activate a partial database',async()=>{
 const f=await fixtureRepo();try{
  const source=path.join(f.dir,'bad.json'),target=path.join(f.dir,'bad.sqlite3');const review=detailedFixture().dimensions;review[0].issues[0].evidence_ids=['nonexistent'];
  await fs.writeFile(source,JSON.stringify({prompts:defaultPrompts(),runs:[{id:'bad',filename:'missing.pdf',created_at:'2025-01-01',reviews:review,blocks}]}));
  assert.throws(()=>migrateLegacy({source,target,dataDir:f.dir}),/证据引用|迁移失败/);await assert.rejects(fs.access(target));assert(await fs.readFile(source));
 }finally{await f.cleanup();}
});
test('database prevents cross-paper evidence and supports revisions without replacing files',async()=>{
 const f=await fixtureRepo();try{
  const a=f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir),b=f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);
  const run=f.repo.saveRun(f.task.id,a.id,validateDetailed(detailedFixture(),blocks,f.request,f.task.id));
  assert.throws(()=>f.repo.insert('issue_evidence',{issue_id:run.reviews[0].issues[0].id,block_id:b.id+':b2',sequence_no:1}),/another document/);
  const revision=f.repo.createVersion({owner:f.user.id,paperId:f.version.paper_id,filename:'revised.pdf',storagePath:f.version.storage_path,metadata:f.request.metadata});assert.equal(revision.version_no,2);assert.equal(revision.paper_id,f.version.paper_id);assert.equal(f.repo.version(f.version.id).version_no,1);
  assert.throws(()=>f.repo.createVersion({owner:'stranger',paperId:f.version.paper_id}),{status:404});
  assert.throws(()=>f.repo.db.prepare('UPDATE review_tasks SET request_snapshot_json=? WHERE id=?').run('{}',f.task.id),/immutable/);
  assert.throws(()=>f.repo.createVersion({owner:f.user.id,paperId:f.version.paper_id,filename:'bad.pdf',storagePath:f.version.storage_path,metadata:{degree_type:'not-a-degree'}}),/degree_type/);
 }finally{await f.cleanup();}
});
test('task log records stage messages and attempts; failed tasks can be dismissed from the list',async()=>{
 const f=await fixtureRepo();try{
  f.repo.updateTask(f.task.id,{status:'running',stage:'reviewing',message:'模型正在进行六维度详细评审'});
  const attempt=f.repo.attempt(f.task.id,'reviewing','prompt.txt');f.repo.finishAttempt(attempt.id,'failed',null,'DeepSeek 输出不完整');
  f.repo.updateTask(f.task.id,{progress:50});
  f.repo.updateTask(f.task.id,{status:'failed',message:'评审未完成，可从已完成阶段重试',error:'DeepSeek 输出不完整'});
  const log=f.repo.taskLog(f.task.id);
  assert.deepEqual(log.map(e=>e.level),['info','info','info','warning','error']);
  assert(log[3].message.includes('第 1 次模型调用失败'));assert.equal(log.at(-1).message,'DeepSeek 输出不完整');
  assert.throws(()=>f.repo.dismissTask('missing',f.user.id),/不存在/);
  f.repo.dismissTask(f.task.id,f.user.id);assert.equal(f.repo.tasks(f.user.id).length,0);assert(f.repo.task(f.task.id));
 }finally{await f.cleanup();}
});
test('legacy one-line default prompts upgrade once; edited prompts are kept',async()=>{
 const {legacyDefaultFocus,defaultFocus}=await import('../src/prompts.mjs');
 const f=await fixtureRepo();try{
  // Simulate an account created before the upgrade: latest prompt is the old default, except one edited dimension.
  f.repo.db.prepare('UPDATE prompt_versions SET text=? WHERE owner_id=? AND dimension_code=?').run('自定义提示词',f.user.id,'d2');
  legacyDefaultFocus.forEach((text,i)=>{if(i!==1)f.repo.db.prepare('UPDATE prompt_versions SET text=? WHERE owner_id=? AND dimension_code=?').run(text,f.user.id,`d${i+1}`);});
  assert.equal(f.repo.upgradeDefaultPrompts(),5);assert.equal(f.repo.upgradeDefaultPrompts(),0);
  const prompts=f.repo.prompts(f.user.id);
  assert.equal(prompts[0].at(-1).text,defaultFocus()[0]);assert.equal(prompts[0].at(-1).version,2);
  assert.equal(prompts[1].at(-1).text,'自定义提示词');assert.equal(prompts[1].length,1);
 }finally{await f.cleanup();}
});
