// 按 config/pricing.json 计算一次模型调用的费用。价格表变化不影响已保存的历史费用。
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

let cached=null;
export function pricingTable(){
 cached??=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../config/pricing.json',import.meta.url)),'utf8'));
 return cached;
}
// Rates for a model by id or alias (the selection id is tried first, then the API model id).
export function modelRates(config,table=pricingTable()){
 for(const key of [config?.selection_id,config?.model].filter(Boolean)){
  if(table.models[key])return {key,...table.models[key]};
  const match=Object.entries(table.models).find(([,m])=>m.aliases?.includes(key));
  if(match)return {key:match[0],...match[1]};
 }
 return null;
}
export function priceTier(at,table=pricingTable()){
 const day=at.getUTCDay(),hour=at.getUTCHours()+at.getUTCMinutes()/60;
 const weekday=day>=1&&day<=5;
 return weekday&&table.peak_hours_utc.some(([start,end])=>hour>=start&&hour<end)?'peak':'off_peak';
}
// Normalises a DeepSeek-style usage object into stored token counts.
export function usageCounts(usage){
 if(!usage)return null;
 const input=usage.prompt_tokens??null,hit=usage.prompt_cache_hit_tokens??0;
 return {input_tokens:input,cache_hit_tokens:hit,output_tokens:usage.completion_tokens??null,reasoning_tokens:usage.completion_tokens_details?.reasoning_tokens??null};
}
// Cost in USD, or null when the model has no price entry or the usage lacks token counts.
export function priceUsage(config,usage,at=new Date(),table=pricingTable()){
 const counts=usageCounts(usage),rates=modelRates(config,table);
 if(!counts||counts.input_tokens==null||counts.output_tokens==null)return {...counts,cost_usd:null,price_tier:null};
 if(!rates)return {...counts,cost_usd:null,price_tier:null};
 const tier=priceTier(at,table),r=rates[tier];
 const miss=Math.max(0,counts.input_tokens-counts.cache_hit_tokens);
 const cost=(counts.cache_hit_tokens*r.input_cache_hit+miss*r.input_cache_miss+counts.output_tokens*r.output)/1e6;
 return {...counts,cost_usd:Math.round(cost*1e6)/1e6,price_tier:tier};
}
