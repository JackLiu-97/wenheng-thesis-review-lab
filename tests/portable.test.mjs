import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {fixtureRepo,blocks} from './helpers.mjs';
import {relocateDatabase} from '../scripts/portable-runtime.mjs';

test('portable database relocation preserves records and snapshots, supports repeated moves, rejects missing files',async()=>{
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
