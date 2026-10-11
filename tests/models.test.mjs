import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelOptions,modelConfig,callModel} from '../src/models.mjs';

function environment(t,values={}){
 const keys=['CODEX_API_KEY','CODEX_BASE_URL','REVIEW_CODEX_MODEL','REVIEW_CODEX_CONTEXT_TOKENS','REVIEW_CODEX_OUTPUT_TOKENS','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL','DEEPSEEK_FLASH_MODEL','DEEPSEEK_PRO_MODEL','DEEPSEEK_CONTEXT_TOKENS','DEEPSEEK_OUTPUT_TOKENS'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];Object.assign(process.env,values);
 t.after(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
}
test('seven named models share provider credentials and retain distinct model snapshots',t=>{
 environment(t,{CODEX_API_KEY:'fixture-gpt-key',CODEX_BASE_URL:'https://gpt.example/v1',DEEPSEEK_API_KEY:'fixture-deepseek-key',DEEPSEEK_BASE_URL:'https://deepseek.example/v1'});
 const options=modelOptions();assert.equal(options.length,7);assert(options.every(m=>m.configured));assert.equal(options.filter(m=>m.is_default).length,1);
 for(const option of options){const c=modelConfig(option.id);assert.equal(c.selection_id,option.id);assert.equal(c.model,option.id);assert.equal(c.provider,option.provider);assert.equal(c.context_tokens,option.provider==='gpt'?1050000:1000000);assert.equal(c.base_url,option.provider==='gpt'?'https://gpt.example/v1':'https://deepseek.example/v1');assert(!JSON.stringify(c).includes('fixture-'));}
 assert.equal(modelConfig('gpt').model,'gpt-6.1-sol');assert.equal(modelConfig('deepseek').model,'deepseek-flash');
 assert.throws(()=>modelConfig('arbitrary-model'),{status:400});
 delete process.env.DEEPSEEK_API_KEY;assert(modelOptions().filter(m=>m.provider==='deepseek').every(m=>!m.configured));assert.throws(()=>modelConfig('deepseek-v4-pro'),{status:400});assert(modelConfig('gpt-6-astra'));
});
test('model aliases and legacy custom defaults stay compatible',t=>{
 environment(t,{CODEX_API_KEY:'fixture-gpt-key',CODEX_BASE_URL:'https://gpt.example/v1',REVIEW_CODEX_MODEL:'custom-gpt',DEEPSEEK_API_KEY:'fixture-deepseek-key',DEEPSEEK_MODEL:'legacy-deepseek',DEEPSEEK_PRO_MODEL:'proxy-pro',DEEPSEEK_CONTEXT_TOKENS:'900000'});
 assert.equal(modelConfig('gpt').model,'custom-gpt');assert.equal(modelConfig('deepseek').model,'legacy-deepseek');
 const pro=modelConfig('deepseek-v4-pro');assert.equal(pro.model,'proxy-pro');assert.equal(pro.context_tokens,900000);assert.equal(modelConfig('gpt-6-sol').model,'gpt-6-sol');
});
test('Flash and Pro requests use only the shared DeepSeek key and the selected model',async t=>{
 environment(t,{CODEX_API_KEY:'fixture-gpt-key',CODEX_BASE_URL:'https://gpt.example/v1',DEEPSEEK_API_KEY:'fixture-deepseek-key',DEEPSEEK_BASE_URL:'https://deepseek.example/v1'});
 const requests=[];t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));});
 for(const id of ['deepseek-flash','deepseek-v4-pro'])assert.equal(await callModel('Return JSON','.',modelConfig(id),{}),'{"ok":true}');
 assert.equal(requests.length,2);
 for(const [i,r] of requests.entries()){assert.equal(r.url,'https://deepseek.example/v1/chat/completions');assert.equal(r.options.headers.Authorization,'Bearer fixture-deepseek-key');assert.equal(JSON.parse(r.options.body).model,['deepseek-flash','deepseek-v4-pro'][i]);assert(!JSON.stringify(r).includes('fixture-gpt-key'));}
});
