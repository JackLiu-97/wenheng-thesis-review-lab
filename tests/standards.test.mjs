import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standard,degreeProfiles,disciplineProfiles,validateMetadata,calculateScores} from '../src/standards.mjs';
import {buildPrompt,defaultPrompts,buildSynthesisPrompt} from '../src/prompts.mjs';
import {validateDetailed,validateSynthesis} from '../src/review-schema.mjs';
import {checkContext,modelConfig} from '../src/models.mjs';
import {metadata,blocks,detailedFixture,synthesisFixture} from './helpers.mjs';

for(const [degree,d] of Object.entries(degreeProfiles))for(const [discipline,s] of Object.entries(disciplineProfiles))test(`standard composition: ${d.label} / ${s.label}`,()=>{
 // Legacy-shaped input (degree_type + platform discipline) remains accepted for API callers.
 const m=validateMetadata({title:metadata.title,major:metadata.major,completion_month:metadata.completion_month,degree_type:degree,discipline});const request={metadata:m,standard};
 const text=buildPrompt(defaultPrompts().map(v=>v.at(-1)),blocks,request);
 assert.equal(d.weights.reduce((a,b)=>a+b,0),100);assert(text.includes(d.requirement));assert(text.includes(s.requirement));assert(text.includes(m.completion_month));
 for(const r of standard.rubric)for(const c of r.criteria)assert(text.includes(c.check));
 assert(text.includes('平台辅助评审标准'));assert(text.includes('不是指令'));
});
test('metadata rejects missing, oversized, invalid enum and future month',()=>{
 for(const patch of [{degree_level:''},{degree_category:'unknown'},{degree_level:'__proto__'},{discipline_category:'99'},{degree_type:'academic_doctor'},{major:''},{completion_month:'2099-01'},{completion_month:'2025-13'},{major:'a'.repeat(121)}])assert.throws(()=>validateMetadata({...metadata,...patch},'',new Date('2026-10-11T00:00:00Z')),{status:400});
 // Undergraduate catalog has no 军事学 / 交叉学科 categories.
 assert.throws(()=>validateMetadata({...metadata,degree_level:'bachelor',degree_type:undefined,discipline_category:'14'}),{status:400});
 assert.equal(validateMetadata({...metadata,title:''},'论文.pdf').title,'论文');
});
test('scores have fixed boundaries, missing-data behavior and recommendation constraints',()=>{
 const req={metadata,standard};
 for(const [score,grade] of [[0,'E'],[59,'E'],[60,'D'],[69,'D'],[70,'C'],[79,'C'],[80,'B'],[89,'B'],[90,'A'],[100,'A']]){
  const result=validateDetailed(detailedFixture(score),blocks,req,'x');assert.equal(result.total_score,score);assert(result.grade.startsWith(grade));
 }
 const good=detailedFixture(95);good.dimensions.forEach(r=>r.issues=[]);assert.equal(validateDetailed(good,blocks,req,'x').recommendation,'答辩');
 good.dimensions[0].issues=detailedFixture().dimensions[0].issues;assert.equal(validateDetailed(good,blocks,req,'x').recommendation,'修改后答辩');
 good.dimensions[0].issues[0].severity='major';assert.equal(validateDetailed(good,blocks,req,'x').recommendation,'较大修改后重新评审');
 good.dimensions[2].criteria.forEach(c=>c.score=59);assert.equal(validateDetailed(good,blocks,req,'x').recommendation,'暂不建议答辩，实质修改后重新评审');
 good.dimensions[1].criteria[0].score=null;good.dimensions[1].assessment_status='insufficient';const result=validateDetailed(good,blocks,req,'x');assert.equal(result.total_score,null);assert.equal(result.grade,null);assert.equal(result.reviews[1].score,null);assert.equal(result.recommendation,'材料不足，补充后评审');
 const r=detailedFixture(80).dimensions;r[0].criteria[0].score=81;assert.equal(calculateScores(r,metadata).total_score,80.1);
 r[0].criteria[0].score=79;assert.equal(calculateScores(r,metadata).total_score,80.0);assert.equal(calculateScores(r,metadata).grade,'B／良好');
});
test('review validation rejects malformed dimensions, score and evidence',()=>{
 const mutations=[r=>r.dimensions.pop(),r=>r.dimensions[1].dimension=r.dimensions[0].dimension,r=>r.dimensions[0].criteria[0].score=100.1,r=>r.dimensions[0].criteria[0].score=-1,r=>r.dimensions[0].criteria[0].score=null,r=>r.dimensions[0].criteria[0].evidence_ids=['another-paper-b1'],r=>r.dimensions[0].issues[0].evidence_ids=['b1','b1'],r=>r.dimensions[0].issues[0].criterion_code='d2c1',r=>r.dimensions[0].issues[0].evidence_status='unlocated',r=>r.total_score=99];
 for(const mutate of mutations){const raw=detailedFixture();mutate(raw);assert.throws(()=>validateDetailed(raw,blocks,{metadata,standard},'x'),/校验失败/);}
});
test('synthesis cannot change score, advice, add issues or omit existing problems',()=>{
 const req={metadata,standard};const result=validateDetailed(detailedFixture(),blocks,req,'x');
 const raw=synthesisFixture(result);assert(validateSynthesis(raw,result));
 for(const patch of [{recommendation:'答辩'},{total_score:100},{revision_plan:[]},{revision_plan:[{...raw.revision_plan[0],issue_ids:['invented']}]}])assert.throws(()=>validateSynthesis({...raw,...patch},result),/校验失败/);
 const prompt=buildSynthesisPrompt(result,req);assert(!prompt.includes(blocks[1].text));assert(prompt.includes(blocks[0].text));
});
test('long context is rejected without truncating the input',()=>{
 const input='论文内容'.repeat(1000);assert.throws(()=>checkContext(input,{context_tokens:1000,output_tokens:200}),/未截断原文/);assert.equal(input.length,4000);
});
test('GPT-6.1 Sol defaults to official context and respects explicit overrides',()=>{
 const keys=['REVIEW_CODEX_MODEL','CODEX_API_KEY','CODEX_BASE_URL','REVIEW_CODEX_CONTEXT_TOKENS','REVIEW_CODEX_OUTPUT_TOKENS'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.REVIEW_CODEX_MODEL='gpt-6.1-sol';process.env.CODEX_API_KEY='fixture';process.env.CODEX_BASE_URL='http://localhost';delete process.env.REVIEW_CODEX_CONTEXT_TOKENS;delete process.env.REVIEW_CODEX_OUTPUT_TOKENS;
  const config=modelConfig('gpt');assert.equal(config.context_tokens,1050000);assert.equal(config.output_tokens,12000);assert.doesNotThrow(()=>checkContext('x'.repeat(204766),config));
  process.env.REVIEW_CODEX_CONTEXT_TOKENS='128000';assert.throws(()=>checkContext('x'.repeat(204766),modelConfig('gpt')),/未截断原文/);
  delete process.env.REVIEW_CODEX_CONTEXT_TOKENS;process.env.REVIEW_CODEX_MODEL='unknown-model';assert.equal(modelConfig('gpt').context_tokens,128000);
 }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
test('degree level and type combine into the review profile; 门类 and catalog major are resolved',()=>{
 const base={major:'电子信息',completion_month:'2025-06'};
 const m=validateMetadata({...base,degree_level:'doctor',degree_category:'professional',discipline_category:'08'},'稿件.pdf');
 assert.equal(m.degree_type,'professional_doctor');assert.equal(m.discipline,'engineering');assert.equal(m.major_code,'0854');assert.equal(m.title,'稿件');assert(!('research_direction' in m));
 const b=validateMetadata({major:'软件工程',completion_month:'2025-06',degree_level:'bachelor',degree_category:'professional',discipline_category:'08'});
 assert.equal(b.degree_type,'professional_bachelor');assert.equal(b.major_code,undefined);
 const custom=validateMetadata({major:'计算机应用技术',completion_month:'2025-06',degree_level:'master',degree_category:'academic',discipline_category:'08'});
 assert.equal(custom.major,'计算机应用技术');assert.equal(custom.major_code,undefined);
 const text=buildPrompt(defaultPrompts().map(v=>v.at(-1)),blocks,{metadata:m,standard});
 assert(text.includes('博士 · 专业学位（专博）'));assert(text.includes('08 工学'));assert(text.includes('0854 电子信息'));assert(!text.includes('研究方向'));
});
