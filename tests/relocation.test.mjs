import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {fixtureRepo,blocks} from './helpers.mjs';
import {relocateDatabase} from '../scripts/relocate-data.mjs';

test('database relocation preserves records and snapshots, supports repeated moves, rejects missing files',async()=>{
 const f=await fixtureRepo();const destination=await fs.mkdtemp(path.join(os.tmpdir(),'review-portable-'));
 try{
  f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);
  const copy=path.join(destination,'review.sqlite3');await f.repo.db.backup(copy);await fs.copyFile(f.version.storage_path,path.join(destination,'source.pdf'));
  const result=relocateDatabase(copy,f.dir,destination);assert.equal(result.integrity,'ok');assert.equal(result.counts.users,1);assert.equal(result.changed_paths,2);
  assert.equal(relocateDatabase(copy,f.dir,destination).changed_paths,0);
  let db=new Database(copy);assert.equal(db.prepare('SELECT request_snapshot_json FROM review_tasks').get().request_snapshot_json,JSON.stringify(f.request));assert.equal(db.prepare('SELECT storage_path FROM paper_versions').get().storage_path,path.join(destination,'source.pdf'));db.close();
  const moved=path.join(destination,'第二台电脑');await fs.mkdir(moved);await fs.copyFile(copy,path.join(moved,'review.sqlite3'));await fs.copyFile(path.join(destination,'source.pdf'),path.join(moved,'source.pdf'));
  assert.equal(relocateDatabase(path.join(moved,'review.sqlite3'),f.dir,moved).changed_paths,2);
  const incomplete=path.join(destination,'missing');await fs.mkdir(incomplete);await fs.copyFile(copy,path.join(incomplete,'review.sqlite3'));assert.throws(()=>relocateDatabase(path.join(incomplete,'review.sqlite3'),f.dir,incomplete),/缺少/);
  db=new Database(path.join(incomplete,'review.sqlite3'));assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='portable_root'").get().value,destination);db.close();
 }finally{
  await f.cleanup();if(path.dirname(destination)!==os.tmpdir()||!path.basename(destination).startsWith('review-portable-'))throw Error('Invalid test cleanup path');await fs.rm(destination,{recursive:true,force:true});
 }
});

test('Windows backup paths relocate to the native platform without changing review snapshots',async()=>{
 const f=await fixtureRepo();const destination=await fs.mkdtemp(path.join(os.tmpdir(),'review-portable-'));
 try{
  f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);
  const copy=path.join(destination,'review.sqlite3');await f.repo.db.backup(copy);await fs.copyFile(f.version.storage_path,path.join(destination,'source.pdf'));
  const sourceRoot='E:\\迁移资料\\文衡';
  const db=new Database(copy);
  const snapshot=db.prepare('SELECT request_snapshot_json FROM review_tasks').get().request_snapshot_json;
  db.prepare('UPDATE paper_versions SET storage_path=?').run(path.win32.join(sourceRoot,'source.pdf'));
  db.prepare('UPDATE parse_results SET artifact_path=?').run(sourceRoot);db.close();
  const result=relocateDatabase(copy,sourceRoot,destination);assert.equal(result.changed_paths,2);assert.equal(result.integrity,'ok');
  const relocated=new Database(copy);
  try{
   assert.equal(relocated.prepare('SELECT storage_path FROM paper_versions').get().storage_path,path.join(destination,'source.pdf'));
   assert.equal(relocated.prepare('SELECT artifact_path FROM parse_results').get().artifact_path,destination);
   assert.equal(relocated.prepare('SELECT request_snapshot_json FROM review_tasks').get().request_snapshot_json,snapshot);
  }finally{relocated.close();}
  assert.equal(relocateDatabase(copy,sourceRoot,destination).changed_paths,0);
 }finally{
  await f.cleanup();if(path.dirname(destination)!==os.tmpdir()||!path.basename(destination).startsWith('review-portable-'))throw Error('Invalid test cleanup path');await fs.rm(destination,{recursive:true,force:true});
 }
});
