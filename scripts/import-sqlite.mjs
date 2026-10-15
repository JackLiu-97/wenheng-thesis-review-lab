// One-time import of an existing SQLite database (data/review.sqlite3) into the configured MySQL database.
// The target must be empty; the SQLite file is opened read-only and left unchanged.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {openDatabase,databaseConfig} from '../src/database.mjs';
if(!process.env.REVIEW_SKIP_ENV)try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const source=path.resolve(value('--source')||fileURLToPath(new URL('../data/review.sqlite3',import.meta.url)));

// Parents before children; review_tasks.parent_run_id is filled in after review_runs exist.
const tables=['users','sessions','papers','paper_versions','parse_results','document_blocks','standard_versions','prompt_versions','review_tasks','review_attempts','review_runs','dimension_reviews','review_issues','issue_evidence','report_files','task_events'];
const renamed={app_meta:{key:'meta_key',value:'meta_value'}};

const sqlite=new Database(source,{readonly:true,fileMustExist:true});
const repo=await openDatabase(databaseConfig());
try{
 if(await repo.count('users')||await repo.count('review_tasks'))throw Error('目标 MySQL 数据库已有账号或评审任务；为避免覆盖，只能导入到空数据库');
 const sqliteTables=new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 const counts={};
 await repo.transaction(async tx=>{
  const columnsOf=async table=>new Set((await tx.q("SELECT column_name name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND extra NOT LIKE '%GENERATED%' AND extra NOT LIKE '%auto_increment%'",[table])).map(r=>r.name??r.NAME??r.COLUMN_NAME));
  const copy=async(table,transform=row=>row)=>{
   if(!sqliteTables.has(table))return;
   const allowed=await columnsOf(table),rows=sqlite.prepare(`SELECT * FROM ${table}`).all().map(transform).map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[renamed[table]?.[k]||k,v]).filter(([k])=>allowed.has(k))));
   if(table==='task_events')for(const r of rows)delete r.id;
   await tx.q('DELETE FROM '+table);await tx.insertMany(table,rows);counts[table]=rows.length;
  };
  await tx.q('DELETE FROM standard_versions');
  for(const table of tables)await copy(table,table==='review_tasks'?({parent_run_id,...row})=>row:row=>row);
  for(const row of sqlite.prepare('SELECT id,parent_run_id FROM review_tasks WHERE parent_run_id IS NOT NULL').all())await tx.q('UPDATE review_tasks SET parent_run_id=? WHERE id=?',[row.parent_run_id,row.id]);
  if(sqliteTables.has('app_meta'))for(const row of sqlite.prepare('SELECT key,value FROM app_meta').all())await tx.setMeta(row.key,row.value);
  // Every copied table must match its source row count before the import is committed.
  for(const table of Object.keys(counts)){const n=await tx.count(table);if(n!==counts[table])throw Error(`导入数量校验失败：${table}（SQLite ${counts[table]}，MySQL ${n}）`);}
 });
 console.log(JSON.stringify({source,database:databaseConfig().database,counts},null,2));
}finally{sqlite.close();await repo.close();}
