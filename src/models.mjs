import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

function positiveInt(value,fallback){const n=Number(value||fallback);if(!Number.isSafeInteger(n)||n<=0)throw Error('模型上下文与输出预算必须是正整数');return n;}
const catalog=[
 {id:'gpt-6.1-sol',label:'GPT 6.1 Sol',provider:'gpt',context_tokens:1050000},
 {id:'gpt-6-astra',label:'GPT 6 Astra',provider:'gpt',context_tokens:1050000},
 {id:'gpt-6-sol',label:'GPT 6 Sol',provider:'gpt',context_tokens:1050000},
 {id:'gpt-6-luna',label:'GPT 6 Luna',provider:'gpt',context_tokens:1050000},
 {id:'gpt-5.6-sol',label:'GPT 5.6 Sol',provider:'gpt',context_tokens:1050000},
 {id:'deepseek-flash',label:'DeepSeek Flash',provider:'deepseek',context_tokens:1000000,model_env:'DEEPSEEK_FLASH_MODEL'},
 {id:'deepseek-v4-pro',label:'DeepSeek Pro',provider:'deepseek',context_tokens:1000000,model_env:'DEEPSEEK_PRO_MODEL'}
];
function configured(provider){return provider==='gpt'?Boolean(process.env.CODEX_API_KEY&&process.env.CODEX_BASE_URL):Boolean(process.env.DEEPSEEK_API_KEY);}
function defaultModel(provider){return provider==='gpt'?(process.env.REVIEW_CODEX_MODEL||'gpt-6.1-sol'):(process.env.DEEPSEEK_MODEL||process.env.DEEPSEEK_FLASH_MODEL||'deepseek-flash');}
export function modelOptions(){
 const options=catalog.map(({model_env,...entry})=>({...entry,model:(model_env&&process.env[model_env])||entry.id,configured:configured(entry.provider)}));
 // Preserve custom models and legacy clients that submit just a provider name.
 for(const provider of ['gpt','deepseek']){const model=defaultModel(provider);if(!options.some(o=>o.provider===provider&&o.model===model))options.push({id:provider,label:`${provider==='gpt'?'GPT':'DeepSeek'} · ${model}`,provider,model,context_tokens:128000,configured:configured(provider)});}
 return options.map(o=>({...o,is_default:o.provider==='gpt'&&o.model===defaultModel('gpt')}));
}
export function modelConfig(selection){
 const options=modelOptions();const option=['gpt','deepseek'].includes(selection)?options.find(o=>o.provider===selection&&o.model===defaultModel(selection)):options.find(o=>o.id===selection);
 if(!option)throw Object.assign(Error('不支持的评审模型'),{status:400});
 if(!option.configured)throw Object.assign(Error(option.label+' 尚未配置 API Key 或服务地址'),{status:400});
 const provider=option.provider,prefix=provider==='gpt'?'REVIEW_CODEX':'DEEPSEEK';
 return {provider,selection_id:option.id,model:option.model,base_url:provider==='gpt'?process.env.CODEX_BASE_URL:(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com'),context_tokens:positiveInt(process.env[prefix+'_CONTEXT_TOKENS'],option.context_tokens),output_tokens:positiveInt(process.env[prefix+'_OUTPUT_TOKENS'],12000)};
}
export function checkContext(prompt,config){
 // UTF-8 bytes are a conservative upper bound, not a fabricated model tokenizer count.
 const upperBound=Buffer.byteLength(prompt,'utf8')+1024;
 if(upperBound+config.output_tokens>config.context_tokens)throw Object.assign(Error(`完整论文输入超出配置的上下文预算（保守上界 ${upperBound}，输出预留 ${config.output_tokens}，窗口 ${config.context_tokens}）。未截断原文；请配置更大窗口的模型后重新评审。`),{contextLimit:true});
 return upperBound;
}
export function safeError(error){
 let message=String(error?.message||error||'未知错误');
 for(const key of ['CODEX_API_KEY','DEEPSEEK_API_KEY','MINERU_TOKEN'])if(process.env[key])message=message.split(process.env[key]).join('[redacted]');
 return message.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,1200);
}
export function transient(error){return [408,429,500,502,503,504].includes(error.httpStatus)||['ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENOTFOUND','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.code||error.cause?.code)||error.name==='TimeoutError'||error.name==='AbortError'||/HTTP (429|50[0234])|rate.limit|temporar|fetch failed/i.test(error.message);}
// onUsage receives the provider's token usage for every answered call, including truncated ones (they are billed too).
export async function callModel(prompt,dir,config,schema,{onUsage}={}){
 checkContext(prompt,config);
 if(config.provider==='gpt')return codexReview(prompt,dir,config,schema);
 if(!process.env.DEEPSEEK_API_KEY)throw Error('DeepSeek 凭据未配置');
 const res=await fetch(config.base_url.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`},body:JSON.stringify({model:config.model,messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},max_tokens:config.output_tokens,stream:false}),signal:AbortSignal.timeout(1800000)});
 if(!res.ok)throw Object.assign(Error(`DeepSeek 请求失败：HTTP ${res.status}`),{httpStatus:res.status});
 const data=await res.json(),choice=data.choices?.[0];
 if(data.usage)onUsage?.(data.usage);
 if(choice?.finish_reason!=='stop')throw Object.assign(Error(`DeepSeek 输出不完整（finish_reason=${choice?.finish_reason??'无'}，输出 ${data.usage?.completion_tokens??'未知'} tokens，上限 ${config.output_tokens}），请检查输出预算`),{validation:true});
 return choice.message.content;
}
async function codexReview(prompt,dir,config,schema){
 if(!process.env.CODEX_API_KEY)throw Error('GPT 凭据未配置');
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'review-codex-'));
 // JSON string escaping is also valid for the basic TOML strings used here.
 const cfg=`model_provider = "review_provider"\nmodel = ${JSON.stringify(config.model)}\n[model_providers.review_provider]\nname = "Review Provider"\nbase_url = ${JSON.stringify(config.base_url)}\nenv_key = "CODEX_API_KEY"\nwire_api = "responses"\n`;
 try{
  await fs.writeFile(path.join(home,'config.toml'),cfg);const schemaPath=path.join(home,'schema.json'),out=path.join(home,'result.json');await fs.writeFile(schemaPath,JSON.stringify(schema));
  const cli=process.env.REVIEW_CODEX_BIN||process.env.CODEX_CLI_PATH||'codex';
  await new Promise((resolve,reject)=>{
   const p=spawn(cli,['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never','--output-schema',schemaPath,'--output-last-message',out,'-m',config.model,'-'],{cwd:dir,env:{...process.env,CODEX_HOME:home}});
   let err='';const timeout=setTimeout(()=>{p.kill();reject(Object.assign(Error('GPT 调用超时'),{name:'TimeoutError'}));},1800000);
   p.stderr.on('data',d=>{err=(err+d.toString()).slice(-3000);});p.stdout.resume();p.stdin.on('error',()=>{});
   p.on('error',error=>{clearTimeout(timeout);reject(Object.assign(Error('GPT CLI 无法启动，请检查 REVIEW_CODEX_BIN'),{code:error.code}));});
   p.on('close',code=>{clearTimeout(timeout);if(code)reject(Error('GPT CLI 未完成：'+safeError(err)));else resolve();});p.stdin.end(prompt);
  });return await fs.readFile(out,'utf8');
 }finally{
  // Only the just-created private temporary directory can be removed.
  if(path.dirname(path.resolve(home))===path.resolve(os.tmpdir())&&path.basename(home).startsWith('review-codex-'))await fs.rm(home,{recursive:true,force:true}).catch(()=>{});
 }
}
