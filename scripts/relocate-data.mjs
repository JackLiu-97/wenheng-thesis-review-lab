import fs from 'node:fs';
import path from 'node:path';

// Absolute file paths stored in the database are re-anchored when the project folder moves.
const pathColumns={paper_versions:['storage_path'],parse_results:['artifact_path'],review_attempts:['input_path','output_path'],report_files:['storage_path']};
export async function relocateDatabase(repo,originalRoot,targetRoot){
 const sourceRoot=await repo.meta('portable_root')||originalRoot;
 const sourcePath=/^(?:[A-Za-z]:[\\/]|\\\\)/.test(sourceRoot)?path.win32:path.posix;
 const changes=[],missing=[];
 for(const [table,columns] of Object.entries(pathColumns))for(const column of columns){
  for(const row of await repo.q(`SELECT id,${column} value FROM ${table} WHERE ${column} IS NOT NULL`)){
   const relative=sourcePath.relative(sourceRoot,row.value);
   if(relative==='..'||relative.startsWith('..'+sourcePath.sep)||sourcePath.isAbsolute(relative))throw Error(`数据库文件引用位于迁移根目录之外：${table}.${column} / ${row.id}`);
   const next=path.resolve(targetRoot,...relative.split(sourcePath.sep));
   if(!fs.existsSync(next))missing.push({table,column,id:row.id,path:next});
   if(next!==row.value)changes.push({table,column,id:row.id,next});
  }
 }
 if(missing.length)throw Error(`数据目录缺少 ${missing.length} 个关联文件；首项：${missing[0].path}`);
 await repo.transaction(async tx=>{
  for(const {table,column,id,next} of changes)await tx.q(`UPDATE ${table} SET ${column}=? WHERE id=?`,[next,id]);
  await tx.setMeta('portable_root',targetRoot);
 });
 const counts={};for(const table of ['users','papers','paper_versions','review_tasks','review_runs','review_issues','issue_evidence'])counts[table]=await repo.count(table);
 return {changed_paths:changes.length,counts};
}
