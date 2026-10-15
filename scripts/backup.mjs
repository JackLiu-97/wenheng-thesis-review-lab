// Backs up the MySQL database (mysqldump) and the files it references into a new directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openDatabase,databaseConfig} from '../src/database.mjs';
if(!process.env.REVIEW_SKIP_ENV)try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const target=value('--target');if(!target)throw Error('Usage: npm run backup -- --target <new-backup-directory>');
const config=databaseConfig(),folder=path.resolve(target);await fs.mkdir(folder,{recursive:false});
// The password goes through the environment, never the command line.
await new Promise((resolve,reject)=>{
 const out=fs.open(path.join(folder,'database.sql'),'wx');
 out.then(handle=>{const dump=spawn(process.env.MYSQLDUMP_BIN||'mysqldump',['--single-transaction','--routines','--default-character-set=utf8mb4','-h',config.host,'-P',String(config.port),'-u',config.user,config.database],{env:{...process.env,MYSQL_PWD:config.password},stdio:['ignore',handle.fd,'inherit']});
  dump.on('error',reject);dump.on('exit',code=>{handle.close();code===0?resolve():reject(Error('mysqldump 退出码 '+code));});},reject);
});
const repo=await openDatabase(config);
try{
 const rows=[...await repo.q('SELECT storage_path FROM paper_versions'),...await repo.q("SELECT storage_path FROM report_files WHERE status='ready'")];
 const files=[];let i=0;
 for(const original of [...new Set(rows.map(r=>r.storage_path).filter(Boolean))]){
  const relative=path.join('files',String(++i)+path.extname(original));await fs.mkdir(path.join(folder,'files'),{recursive:true});
  try{await fs.copyFile(original,path.join(folder,relative));files.push({original,backup:relative});}catch(error){if(error.code!=='ENOENT')throw error;files.push({original,missing:true});}
 }
 await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),database:'database.sql',files,note:'Restore with the service stopped: load database.sql with the mysql client, then restore files to their original paths.'},null,2));
 console.log(JSON.stringify({directory:folder,files:files.length,missing:files.filter(f=>f.missing).length}));
}finally{await repo.close();}
