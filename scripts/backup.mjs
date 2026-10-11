import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const source=value('--database'),target=value('--target');if(!source||!target)throw Error('Usage: npm run backup -- --database <sqlite3> --target <new-backup-directory>');
const folder=path.resolve(target);await fs.mkdir(folder,{recursive:false});const db=new Database(path.resolve(source),{readonly:true,fileMustExist:true});
try{
 const database=path.join(folder,'review.sqlite3');await db.backup(database);
 const snapshot=new Database(database,{readonly:true,fileMustExist:true});try{
  // Back up the exact immutable files referenced by the database snapshot.
  const rows=[...snapshot.prepare('SELECT storage_path FROM paper_versions').all(),...snapshot.prepare("SELECT storage_path FROM report_files WHERE status='ready'").all()];
  const files=[];let i=0;for(const original of [...new Set(rows.map(r=>r.storage_path).filter(Boolean))]){
   const relative=path.join('files',String(++i)+path.extname(original));await fs.mkdir(path.join(folder,'files'),{recursive:true});
   try{await fs.copyFile(original,path.join(folder,relative));files.push({original,backup:relative});}catch(error){if(error.code!=='ENOENT')throw error;files.push({original,missing:true});}
  }
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),database:'review.sqlite3',files,note:'Restore with the service stopped; restore files to original paths, or update storage_path using this manifest. Parser attachments and raw prompts remain in the original data directory; copy that directory for a complete archival backup.'},null,2));
  console.log(JSON.stringify({directory:folder,files:files.length,missing:files.filter(f=>f.missing).length}));
 }finally{snapshot.close();}
}finally{db.close();}
