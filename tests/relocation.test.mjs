import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixtureRepo,blocks} from './helpers.mjs';
import {relocateDatabase} from '../scripts/relocate-data.mjs';

async function withDestination(fn){
 const destination=await fs.mkdtemp(path.join(os.tmpdir(),'review-portable-'));
 try{await fn(destination);}
 finally{if(path.dirname(destination)!==os.tmpdir()||!path.basename(destination).startsWith('review-portable-'))throw Error('Invalid test cleanup path');await fs.rm(destination,{recursive:true,force:true});}
}
const one=async(repo,sql)=>Object.values(await repo.one(sql))[0];

test('file paths follow a moved data folder, repeated moves are no-ops, missing files are refused',async()=>{
 const f=await fixtureRepo();
 try{await withDestination(async destination=>{
  await f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);await fs.copyFile(f.version.storage_path,path.join(destination,'source.pdf'));
  const result=await relocateDatabase(f.repo,f.dir,destination);assert.equal(result.counts.users,1);assert.equal(result.changed_paths,2);
  assert.equal((await relocateDatabase(f.repo,f.dir,destination)).changed_paths,0);
  assert.equal(await one(f.repo,'SELECT request_snapshot_json FROM review_tasks'),JSON.stringify(f.request));
  assert.equal(await one(f.repo,'SELECT storage_path FROM paper_versions'),path.join(destination,'source.pdf'));
  const moved=path.join(destination,'第二台电脑');await fs.mkdir(moved);await fs.copyFile(path.join(destination,'source.pdf'),path.join(moved,'source.pdf'));
  assert.equal((await relocateDatabase(f.repo,f.dir,moved)).changed_paths,2);
  const incomplete=path.join(destination,'missing');await fs.mkdir(incomplete);
  await assert.rejects(relocateDatabase(f.repo,f.dir,incomplete),/缺少/);
  assert.equal(await f.repo.meta('portable_root'),moved);assert.equal(await one(f.repo,'SELECT storage_path FROM paper_versions'),path.join(moved,'source.pdf'));
 });}finally{await f.cleanup();}
});

test('Windows backup paths relocate to the native platform without changing review snapshots',async()=>{
 const f=await fixtureRepo();
 try{await withDestination(async destination=>{
  await f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);await fs.copyFile(f.version.storage_path,path.join(destination,'source.pdf'));
  const sourceRoot='E:\\迁移资料\\文衡',snapshot=await one(f.repo,'SELECT request_snapshot_json FROM review_tasks');
  await f.repo.q('UPDATE paper_versions SET storage_path=?',[path.win32.join(sourceRoot,'source.pdf')]);await f.repo.q('UPDATE parse_results SET artifact_path=?',[sourceRoot]);
  assert.equal((await relocateDatabase(f.repo,sourceRoot,destination)).changed_paths,2);
  assert.equal(await one(f.repo,'SELECT storage_path FROM paper_versions'),path.join(destination,'source.pdf'));
  assert.equal(await one(f.repo,'SELECT artifact_path FROM parse_results'),destination);
  assert.equal(await one(f.repo,'SELECT request_snapshot_json FROM review_tasks'),snapshot);
  assert.equal((await relocateDatabase(f.repo,sourceRoot,destination)).changed_paths,0);
 });}finally{await f.cleanup();}
});
