import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrateLegacy} from '../src/migration.mjs';
if(!process.env.REVIEW_SKIP_ENV)try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const root=fileURLToPath(new URL('..',import.meta.url));
const dataDir=path.resolve(process.env.REVIEW_DATA_DIR||path.join(root,'data'));
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const source=path.resolve(value('--source')||path.join(dataDir,'store.json'));
const target=path.resolve(value('--target')||process.env.REVIEW_DATABASE_PATH||path.join(dataDir,'review.sqlite3'));
console.log(JSON.stringify(migrateLegacy({source,target,dataDir,dryRun:process.argv.includes('--dry-run')}),null,2));
