import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,databaseConfig} from '../src/database.mjs';
import {createReportService} from '../src/reports.mjs';
if(!process.env.REVIEW_SKIP_ENV)try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const runId=value('--run');if(!runId)throw Error('Usage: npm run reports:generate -- --run <run-id>');
const dataDir=path.resolve(process.env.REVIEW_DATA_DIR||fileURLToPath(new URL('../data',import.meta.url)));
const repo=await openDatabase(databaseConfig());
try{const result=await createReportService(repo,dataDir).request(runId);console.log(JSON.stringify(result,null,2));if(result.status!=='ready')process.exitCode=1;}finally{await repo.close();}
