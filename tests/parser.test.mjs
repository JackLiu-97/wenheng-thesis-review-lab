import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMineruBlocks} from '../src/parser.mjs';
test('MinerU normalization preserves table bodies, captions, footnotes and stable IDs',()=>{
 const result=normalizeMineruBlocks([{type:'text',text:'',page_idx:0},{type:'table',table_body:'<table><tr><td>82.0</td></tr></table>',table_caption:['结果'],table_footnote:['三次试验'],page_idx:1,bbox:[100,100,800,500]},{type:'image',image_caption:['系统图'],page_idx:2,bbox:['bad']},{type:'equation',text:'a+b=c',page_idx:2}]);
 assert.deepEqual(result.map(b=>b.id),['b2','b3','b4']);assert(result[0].text.includes('82.0'));assert(result[0].text.includes('三次试验'));assert.equal(result[0].page,2);assert.equal(result[1].bbox,null);assert.equal(result[2].text,'a+b=c');
 assert.throws(()=>normalizeMineruBlocks([[{text:'unsupported'}]]),/结构/);assert.throws(()=>normalizeMineruBlocks([{text:'x',page_idx:-1}]),/页码/);
});
