import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dimensions,defaultPrompts,focusText,migratePrompts,appendFocusVersion,buildPrompt,promptTemplateVersion} from '../src/prompts.mjs';

test('atomic store replacement retries temporary Windows locks and propagates other failures',async()=>{
 const source=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const writeStore='),source.indexOf('let storeQueue='));
 let writes=0,renames=0;
 const context=vm.createContext({storePath:'test-store.json',setTimeout:fn=>{fn();},fsp:{writeFile:async()=>{writes++;},rename:async()=>{if(++renames<4)throw Object.assign(Error('locked'),{code:'EPERM'});}}});
 vm.runInContext(code+';globalThis.write=writeStore;',context);
 await context.write({runs:[]});assert.equal(writes,1);assert.equal(renames,4);
 context.fsp.rename=async()=>{throw Object.assign(Error('disk failure'),{code:'EIO'});};
 await assert.rejects(context.write({runs:[]}),{code:'EIO'});
});

test('legacy migration preserves history and runs, is idempotent, and keeps custom text',()=>{
 const legacy=`你是一名严谨的学术论文评审专家，请从“选题质量”维度评审论文。\n\n评审重点：自定义重点\n第二行\n\n请严格输出 JSON，不要输出 Markdown。每条意见必须包含 title、severity（major/minor/positive）、detail、evidence_ids（来自给定文本块 ID 的数组）和 suggestion。只根据论文内容判断，证据不足时明确说明，不能编造证据或坐标。`;
 const store={prompts:defaultPrompts(),runs:[{snapshots:[{text:legacy}]}]};
 store.prompts[0]=[{version:3,text:legacy}];
 store.prompts[1]=[{version:1,text:'用户自定义内容，不应删除'}];
 const oldRuns=JSON.stringify(store.runs);
 assert(migratePrompts(store));
 assert.equal(store.prompts[0][0].text,legacy);
 assert.equal(store.prompts[0].at(-1).text,'自定义重点\n第二行');
 assert.equal(store.prompts[0].at(-1).version,4);
 assert.equal(store.prompts[1].at(-1).text,'用户自定义内容，不应删除');
 assert.equal(JSON.stringify(store.runs),oldRuns);
 assert.equal(migratePrompts(store),false);
 assert.equal(focusText({kind:'focus',text:legacy},0),legacy);
});

test('each dimension saves independently, validates and rejects stale writes',()=>{
 const store={prompts:defaultPrompts(),runs:[]};
 const other=JSON.stringify(store.prompts.slice(1));
 const snapshot=structuredClone(store.prompts[0][0]);
 appendFocusVersion(store,0,{text:'新重点',base_version:1});
 assert.equal(store.prompts[0].at(-1).version,2);
 assert.equal(JSON.stringify(store.prompts.slice(1)),other);
 assert.equal(snapshot.version,1);
 assert.throws(()=>appendFocusVersion(store,0,{text:'冲突',base_version:1}),{status:409});
 assert.throws(()=>appendFocusVersion(store,0,{text:' ',base_version:2}),{status:400});
 assert.throws(()=>appendFocusVersion(store,6,{text:'无效',base_version:1}),{status:400});
});

test('assembled input has one common opening/output section and all six variables',()=>{
 const snapshots=defaultPrompts().map((v,i)=>({...v[0],text:'独立变量'+i}));
 const text=buildPrompt(snapshots,[{id:'b9',page:4,text:'原文证据'}]);
 assert.equal(text.split('你是一名严谨的学术论文评审专家').length-1,1);
 assert.equal(text.split('严格输出 JSON').length-1,1);
 dimensions.forEach((d,i)=>assert(text.includes(`【${d}】\n独立变量${i}`)));
 assert(text.endsWith('[b9] page=4 原文证据'));
});

test('review uses latest saved variables, archives exact input and preserves run snapshots',async()=>{
 const source=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function reviewPaper('),source.indexOf('const types='));
 const store={prompts:defaultPrompts(),runs:[]},files=new Map();
 appendFocusVersion(store,2,{text:'核对因果推断与对照实验',base_version:1});
 let captured;
 const context=vm.createContext({crypto:{randomUUID:()=> 'test-run'},path:{join:(...x)=>x.join('/')},runDir:'test',safeName:x=>x,structuredClone,
  fsp:{mkdir:async()=>{},writeFile:async(p,t)=>files.set(p,t)},readStore:async()=>structuredClone(store),updateStore:async fn=>fn(store),
  buildPrompt,promptTemplateVersion,dimensions,modelOptions:()=>[{id:'gpt',model:'test-model'}],
  selectedReview:async prompt=>{captured=prompt;return {dimensions:dimensions.map(d=>({dimension:d,summary:'总结',issues:[]}))};}
 });
 vm.runInContext(code+';globalThis.review=reviewPaper;',context);
 const result=await context.review(new Uint8Array(),'paper.pdf','gpt',{blocks:[{id:'b1',page:1,text:'正文'}],page_sizes:[[595,841]]});
 assert(captured.includes('核对因果推断与对照实验'));
 assert.equal(files.get('test/test-run/prompt.txt'),captured);
 assert.equal(result.snapshots[2].version,2);
 appendFocusVersion(store,2,{text:'后续修改',base_version:2});
 assert.equal(result.snapshots[2].text,'核对因果推断与对照实验');
 assert.equal(store.runs[0].snapshots[2].version,2);
});

test('editor preserves per-dimension drafts and saves only the selected focus',async()=>{
 const source=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('let promptVersions='),source.indexOf('function tab('));
 const elements=new Map(),get=id=>{
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',classList:{contains:()=>false},addEventListener(){}});
  return elements.get(id);
 };
 const store={prompts:defaultPrompts(),runs:[]};let saved;
 const context=vm.createContext({$:get,dimensions,promptDim:0,esc:x=>x,current:()=>({snapshots:[{version:1}]}),toast(){},
  fetch:async(url,options)=>{
   if(!options)return {ok:true,json:async()=>structuredClone(store.prompts)};
   const index=Number(url.split('/').at(-1));saved=JSON.parse(options.body);
   const version=appendFocusVersion(store,index,saved);return {ok:true,json:async()=>version};
  }
 });
 vm.runInContext(code,context);
 await vm.runInContext('loadPromptVersions()',context);
 assert.equal(get('prompt-text').readOnly,false);
 get('prompt-text').value='未保存的选题重点';vm.runInContext('capturePromptDraft();promptDim=1;renderPromptView();',context);
 get('prompt-text').value='修改文献重点';vm.runInContext('capturePromptDraft()',context);
 await vm.runInContext('savePrompt()',context);
 assert.equal(saved.text,'修改文献重点');assert.equal(saved.base_version,1);
 vm.runInContext('promptDim=0;renderPromptView()',context);
 assert.equal(get('prompt-text').value,'未保存的选题重点');
 assert.equal(vm.runInContext('hasPromptDrafts()',context),true);
 assert.equal(store.prompts[0].length,1);
 assert.equal(store.prompts[1].length,2);
});
