import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {relocateDatabase} from './relocate-data.mjs';
import {openDatabase,databaseConfig} from '../src/database.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
try{
 if(process.platform!=='darwin')throw Error('请在 macOS 上使用此启动器。');
 if(process.versions.node.split('.')[0]!=='24')throw Error('需要 Node.js 24，请设置 REVIEW_NODE_BIN。');
 try{process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const localPoppler=path.join(root,'runtime','macos','poppler','bin','pdftoppm');
 if(fs.existsSync(localPoppler))process.env.PDFTOPPM_BIN=localPoppler;
 const check=process.argv.includes('--check');
 const port=Number(process.env.REVIEW_PORT||4173);
 if(!check)await new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',error=>reject(Error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用；如果文衡已启动，请打开 http://127.0.0.1:${port}/。`:error.message)));
  probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
 });
 // Connect to MySQL first so a stopped server gives a clear hint instead of a stack trace.
 let repo;
 try{repo=await openDatabase(databaseConfig());}
 catch(error){
  if(['ECONNREFUSED','ENOENT'].includes(error.code))throw Error('无法连接 MySQL。请先启动：brew services start mysql（或 mysql.server start），并确认 .env 中的 MYSQL_* 配置。');
  if(error.code==='ER_ACCESS_DENIED_ERROR')throw Error('MySQL 拒绝登录，请检查 .env 中的 MYSQL_USER / MYSQL_PASSWORD。');
  throw error;
 }
 // Re-anchor stored file paths if the project folder was moved (root recorded in app_meta).
 try{console.log('数据库与文件路径检查通过：'+JSON.stringify(await relocateDatabase(repo,root,root)));}finally{await repo.close();}
 if(check){
  const commands=[['PDF 页面渲染',process.env.PDFTOPPM_BIN||'pdftoppm',['-v']],['ZIP 解包','/usr/bin/unzip',['-v']]];
  if(process.env.CODEX_API_KEY&&process.env.CODEX_BASE_URL)commands.push(['GPT CLI',process.env.REVIEW_CODEX_BIN||process.env.CODEX_CLI_PATH||'codex',['--version']]);
  for(const [name,command,args] of commands){
   const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});
   if(result.error||result.status!==0)throw Error(name+' 自检失败，请检查本地程序路径。');
   console.log(name+'：通过');
  }
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});await browser.close();
  console.log('Node 24、MySQL、文件引用、Poppler、unzip、Chromium 自检通过。');
 }else{
  delete process.env.REVIEW_SKIP_ENV;
  await import('../src/server.mjs');
  const url=`http://127.0.0.1:${port}/`;
  for(let attempt=0;attempt<20;attempt++){
   try{const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(1000)});await response.body?.cancel();if(response.ok||response.status===302){spawn('/usr/bin/open',[url],{stdio:'ignore'}).on('error',()=>console.log('请在浏览器打开 '+url));break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
 }
}catch(error){console.error('启动失败：'+error.message);process.exitCode=1;}
