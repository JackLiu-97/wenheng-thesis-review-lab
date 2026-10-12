import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureRepo,blocks,detailedFixture,complianceFixture} from './helpers.mjs';
import {validateDetailed,detailedSchemaFor} from '../src/review-schema.mjs';
import {buildPrompt,defaultPrompts,buildSynthesisPrompt} from '../src/prompts.mjs';
import {complianceVersion,complianceChecks} from '../src/compliance.mjs';
import {evidenceHtml,inlineHtml} from '../src/evidence-format.mjs';
import {reportHtml} from '../src/reports.mjs';

const withChecks=request=>({...request,compliance_version:complianceVersion});
const snapshots=defaultPrompts().map(v=>v.at(-1));

test('built-in checks are in the model prompt but hidden from previews',async()=>{
 const f=await fixtureRepo();try{
  const request=withChecks(f.request),full=buildPrompt(snapshots,blocks,request),preview=buildPrompt(snapshots,[],request,{hideCompliance:true});
  for(const c of complianceChecks){assert(full.includes(c.prompt));assert(!preview.includes(c.prompt));assert(preview.includes(c.name));}
  assert(full.includes('compliance'));assert(!buildPrompt(snapshots,blocks,f.request).includes('【专项审查】'));
  assert.deepEqual(detailedSchemaFor(request).required,['dimensions','compliance']);assert.deepEqual(detailedSchemaFor(f.request).required,['dimensions']);
 }finally{await f.cleanup();}
});

test('check results are validated and tighten the recommendation without changing scores',async()=>{
 const f=await fixtureRepo();try{
  const request=withChecks(f.request),run=compliance=>validateDetailed({...detailedFixture(),compliance},blocks,request,f.task.id);
  const passed=run(complianceFixture());assert.equal(passed.recommendation,'修改后答辩');assert.equal(passed.compliance.length,3);
  const concern=run(complianceFixture({topic:'concern'}));assert.equal(concern.recommendation,'较大修改后重新评审');assert.equal(concern.total_score,passed.total_score);
  assert.equal(run(complianceFixture({political:'fail'})).recommendation,'暂不建议答辩，实质修改后重新评审');
  assert.equal(run(complianceFixture({training:'insufficient'})).recommendation,'修改后答辩');
  // A concern or fail must cite the paper; checks are required for tasks created with them.
  assert.throws(()=>run(complianceFixture({political:'concern'}).map(c=>({...c,evidence_ids:[]}))),/必须引用原文证据/);
  assert.throws(()=>run(complianceFixture().slice(1)),/恰好 3 项/);
  assert.throws(()=>validateDetailed(detailedFixture(),blocks,request,f.task.id),/字段不完整/);
  assert(buildSynthesisPrompt(concern,request).includes('专项审查结果'));
  // Saved and read back with evidence attached.
  const parse=f.repo.saveParse(f.version.id,{blocks,pageSizes:[]},f.dir);const saved=f.repo.saveRun(f.task.id,parse.id,{...concern,overall_summary:'总结',strengths:[],limitations:[],revision_plan:[],recommendation_reason:'理由'});
  assert.equal(saved.compliance.find(c=>c.code==='topic').status,'concern');assert.equal(saved.compliance.find(c=>c.code==='topic').evidence[0].id,'b1');
  const html=reportHtml(saved);assert(html.includes('专项审查'));assert(html.includes('文题一致性'));
 }finally{await f.cleanup();}
});

test('evidence renders tables, formulas and citations instead of raw markup',()=>{
 const table=evidenceHtml({type:'table',text:'表2-1 对比<table><tr><td rowspan="2" onclick="x">YOLO</td><td> $\\mathrm {mAP}_{50}$ </td></tr><tr><td>88.6 &amp; <b>x</b></td></tr></table>'});
 assert(table.includes('<table class="ev-table">'));assert(table.includes('rowspan="2"'));assert(!table.includes('onclick'));assert(!table.includes('<b>'));assert(table.includes('class="katex"'));assert(table.includes('<p>表2-1 对比</p>'));assert(table.includes('88.6 &amp; x'));
 const text=inlineHtml('精度 $\\mathrm { m A P 5 0 }$ 为 75%，Redmon 等<sup>[19]</sup> <script>alert(1)</script><sub>open');
 assert(text.includes('mAP50'));assert(text.includes('<sup>[19]</sup>'));assert(text.includes('&lt;script&gt;'));assert(!text.includes('<script>'));assert(text.endsWith('</sub>'));
 assert(evidenceHtml({type:'equation',text:'$$E=mc^2$$'}).includes('katex-display'));
 assert(evidenceHtml({type:'image',text:'图 2-2 网络结构'}).includes('ev-figure'));
});
