import {test} from 'node:test';
import assert from 'node:assert/strict';
import {priceUsage,priceTier,modelRates,pricingTable} from '../src/pricing.mjs';

const usage={prompt_tokens:1_000_000,prompt_cache_hit_tokens:200_000,completion_tokens:500_000,completion_tokens_details:{reasoning_tokens:100_000}};
test('cost splits cached and uncached input and applies peak and off-peak rates',()=>{
 const flash={selection_id:'deepseek-flash',model:'deepseek-flash'},r=pricingTable().models['deepseek-flash'];
 const peak=priceUsage(flash,usage,new Date('2026-10-14T02:00:00Z'));// Wednesday 02:00 UTC
 assert.equal(peak.price_tier,'peak');assert.equal(peak.cost_usd,Math.round((0.2*r.peak.input_cache_hit+0.8*r.peak.input_cache_miss+0.5*r.peak.output)*1e6)/1e6);
 const offPeak=priceUsage(flash,usage,new Date('2026-10-17T02:00:00Z'));// Saturday
 assert.equal(offPeak.price_tier,'off_peak');assert(offPeak.cost_usd<peak.cost_usd);
 assert.equal(peak.input_tokens,1_000_000);assert.equal(peak.cache_hit_tokens,200_000);assert.equal(peak.reasoning_tokens,100_000);
});
test('peak hours follow the configured UTC windows on weekdays only',()=>{
 assert.equal(priceTier(new Date('2026-10-14T05:00:00Z')),'off_peak');assert.equal(priceTier(new Date('2026-10-14T09:59:00Z')),'peak');assert.equal(priceTier(new Date('2026-10-14T10:00:00Z')),'off_peak');
});
test('aliases resolve to their model and unknown models are left unpriced',()=>{
 assert.equal(modelRates({model:'deepseek-v4-flash'}).key,'deepseek-flash');assert.equal(modelRates({selection_id:'deepseek-v4-pro'}).key,'deepseek-v4-pro');
 const unknown=priceUsage({model:'gpt-6.1-sol'},usage);assert.equal(unknown.cost_usd,null);assert.equal(unknown.input_tokens,1_000_000);
 assert.deepEqual(priceUsage({model:'deepseek-flash'},null),{cost_usd:null,price_tier:null});
});
