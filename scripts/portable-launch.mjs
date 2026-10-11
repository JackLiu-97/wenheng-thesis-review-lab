import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {relocateDatabase} from './portable-runtime.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
try{
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('此便携包需要 Windows x64。');
 if(process.versions.node.split('.')[0]!=='24')throw Error('请使用迁移包内的 Node 24 启动。');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'portable-manifest.json'),'utf8'));
 process.loadEnvFile(path.join(root,'.env'));
 const local={REVIEW_NODE_BIN:'runtime/node/node.exe',REVIEW_CODEX_BIN:'runtime/codex/codex.exe',PDFTOPPM_BIN:'runtime/poppler/Library/bin/pdftoppm.exe'};
 for(const [key,relative] of Object.entries(local)){const absolute=path.join(root,relative);if(!fs.existsSync(absolute))throw Error('迁移包缺少运行组件：'+relative);process.env[key]=absolute;}
 process.env.CODEX_CLI_PATH=process.env.REVIEW_CODEX_BIN;
 process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'runtime/browsers');
 process.env.REVIEW_DATA_DIR=path.join(root,'data');
 process.env.REVIEW_DATABASE_PATH=path.join(root,manifest.database);
 process.env.PATH=[path.dirname(process.env.REVIEW_NODE_BIN),path.dirname(process.env.PDFTOPPM_BIN),process.env.PATH].join(path.delimiter);
 delete process.env.REVIEW_SKIP_ENV;
 if(process.argv.includes('--check'))process.env.REVIEW_PORT='0';
 else{
  const port=Number(process.env.REVIEW_PORT||4173);
  await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error(`端口 ${port} 已被使用，请关闭已有评审服务或修改 .env 中的 REVIEW_PORT。`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 }
 const report=relocateDatabase(process.env.REVIEW_DATABASE_PATH,manifest.original_root,root);
 console.log('数据库与文件路径检查通过：'+JSON.stringify(report));
 if(process.argv.includes('--check')){
  const cli=spawnSync(process.env.REVIEW_CODEX_BIN,['--version'],{encoding:'utf8',windowsHide:true});if(cli.status!==0)throw Error('GPT 调用程序自检失败');
  const poppler=spawnSync(process.env.PDFTOPPM_BIN,['-v'],{encoding:'utf8',windowsHide:true});if(poppler.status!==0)throw Error('PDF 页面渲染程序自检失败');
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});await browser.close();
  console.log('Node、SQLite、GPT CLI、Poppler、Chromium 自检全部通过。');
 }else await import('../src/server.mjs');
}catch(error){console.error('启动失败：'+error.message);process.exitCode=1;}
