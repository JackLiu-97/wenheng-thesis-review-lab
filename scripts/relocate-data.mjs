import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const pathColumns={paper_versions:['storage_path'],parse_results:['artifact_path'],review_attempts:['input_path','output_path'],report_files:['storage_path']};
export function relocateDatabase(filename,originalRoot,targetRoot){
 const db=new Database(filename,{fileMustExist:true});
 try{
  db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
  const hasMeta=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_meta'").get();
  if(!hasMeta)throw Error('数据库缺少版本元数据');
  const sourceRoot=db.prepare("SELECT value FROM app_meta WHERE key='portable_root'").get()?.value||originalRoot;
  const sourcePath=/^(?:[A-Za-z]:[\\/]|\\\\)/.test(sourceRoot)?path.win32:path.posix;
  const changes=[];const missing=[];
  for(const [table,columns] of Object.entries(pathColumns))for(const column of columns){
   for(const row of db.prepare(`SELECT id,${column} value FROM ${table} WHERE ${column} IS NOT NULL`).all()){
    const relative=sourcePath.relative(sourceRoot,row.value);
    if(relative==='..'||relative.startsWith('..'+sourcePath.sep)||sourcePath.isAbsolute(relative))throw Error(`数据库文件引用位于迁移根目录之外：${table}.${column} / ${row.id}`);
    const next=path.resolve(targetRoot,...relative.split(sourcePath.sep));
    if(!fs.existsSync(next))missing.push({table,column,id:row.id,path:next});
    if(next!==row.value)changes.push({table,column,id:row.id,next});
   }
  }
  if(missing.length)throw Error(`数据目录缺少 ${missing.length} 个关联文件；首项：${missing[0].path}`);
  db.transaction(()=>{
   for(const {table,column,id,next} of changes)db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(next,id);
   db.prepare("INSERT INTO app_meta(key,value) VALUES('portable_root',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(targetRoot);
   if(db.pragma('foreign_key_check').length)throw Error('迁移后外键校验失败');
  })();
  const integrity=db.pragma('integrity_check',{simple:true});if(integrity!=='ok')throw Error('数据库完整性检查失败');
  const counts=Object.fromEntries(['users','papers','paper_versions','review_tasks','review_runs','review_issues','issue_evidence'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
  return {changed_paths:changes.length,integrity,counts};
 }finally{db.close();}
}
