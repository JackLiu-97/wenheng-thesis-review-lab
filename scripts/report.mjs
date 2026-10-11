import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/database.mjs';
import {createReportService} from '../src/reports.mjs';
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const dbPath=value('--database'),runId=value('--run');if(!dbPath||!runId)throw Error('Usage: npm run reports:generate -- --database <sqlite3> --run <run-id>');
const repo=openDatabase(path.resolve(dbPath));
try{const service=createReportService(repo,path.dirname(path.resolve(dbPath)));const result=await service.request(runId);console.log(JSON.stringify(result,null,2));if(result.status!=='ready')process.exitCode=1;}finally{repo.close();}
