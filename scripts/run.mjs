// Project-local Node 24 selection; never changes the system installation or user PATH.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const candidates=[process.env.REVIEW_NODE_BIN,process.execPath,path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','bin','node')].filter(Boolean);
const runtime=candidates.find(p=>fs.existsSync(p)&&spawnSync(p,['-p','process.versions.node.split(".")[0]'],{encoding:'utf8'}).stdout?.trim()==='24');
if(!runtime)throw Error('需要 Node.js 24；请设置 REVIEW_NODE_BIN 指向 Node 24 可执行文件。');
const [command='start',...rest]=process.argv.slice(2);
const files=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).filter(x=>x.isFile()&&/\.(mjs|js)$/.test(x.name)).map(x=>path.join(dir,x.name));
if(command==='check'){
 for(const file of [...files('src'),...files('scripts'),...files('public/js'),...files('tests')]){const p=spawnSync(runtime,['--check',file],{cwd:root,stdio:'inherit'});if(p.status)process.exit(p.status);}
 console.log('JavaScript syntax checks passed');
}else{
 const entry={start:['src/server.mjs'],test:['--test',...files('tests').filter(f=>f.endsWith('.test.mjs'))],migrate:['scripts/migrate-store.mjs'],'audit:live':['scripts/audit-live.mjs'],'reports:samples':['scripts/create-report-samples.mjs'],'reports:generate':['scripts/report.mjs'],backup:['scripts/backup.mjs']}[command];
 if(!entry)throw Error('未知项目命令：'+command);
 const child=spawn(runtime,[...entry,...rest],{cwd:root,stdio:'inherit',env:{...process.env,PATH:path.dirname(runtime)+path.delimiter+process.env.PATH}});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
}
