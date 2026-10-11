import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dimensions,defaultPrompts,focusText,migratePrompts,appendFocusVersion,buildPrompt,promptTemplateVersion} from '../src/prompts.mjs';
import {fixtureRepo,blocks,detailedFixture,synthesisFixture} from './helpers.mjs';
import {createReviewEngine} from '../src/review-engine.mjs';
import {validateDetailed} from '../src/review-schema.mjs';
import fsp from 'node:fs/promises';
import path from 'node:path';

test('SQLite transactions roll back changes and enforce uniqueness',async()=>{
 const f=await fixtureRepo();try{
  assert.throws(()=>f.repo.transaction(()=>{f.repo.db.prepare('UPDATE papers SET title=? WHERE id=?').run('changed',f.version.paper_id);throw Error('disk failure');}),/disk failure/);
  assert.equal(f.repo.paper(f.version.paper_id,f.user.id).title,f.request.metadata.title);
  assert.throws(()=>f.repo.createUser({...f.user,id:'duplicate'}),{status:409});
 }finally{await f.cleanup();}
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

test('review archives exact input and preserves submitted snapshots across later changes',async()=>{
 const f=await fixtureRepo();try{
  f.repo.appendPrompt(f.user.id,0,{text:'后续修改不应影响旧任务',base_version:1});
  const expected=validateDetailed(detailedFixture(),blocks,f.request,f.task.id);let calls=0;
  const engine=createReviewEngine(f.repo,f.dir,{request:async()=>{}},{parse:async()=>({blocks,pageSizes:[[595,841],[595,841]]}),model:async()=>++calls===1?detailedFixture():synthesisFixture(expected)});
  await engine.enqueue(f.task.id);const result=f.repo.run(f.task.id);
  assert.equal(f.repo.task(f.task.id).status,'succeeded');assert.equal(calls,2);assert.equal(result.snapshots[0].version,1);
  const prompt=await fsp.readFile(path.join(f.dir,'runs',f.task.id,'prompt.txt'),'utf8');assert(!prompt.includes('后续修改不应影响旧任务'));assert(prompt.includes(result.snapshots[0].text));
  assert.equal(f.repo.db.prepare('SELECT count(*) n FROM review_attempts').get().n,2);
 }finally{await f.cleanup();}
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
