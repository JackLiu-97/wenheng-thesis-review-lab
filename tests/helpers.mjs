import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {openDatabase} from '../src/database.mjs';
import {standard,dimensions} from '../src/standards.mjs';
import {defaultPrompts,promptTemplateVersion} from '../src/prompts.mjs';
export const metadata={title:'虚构评审系统研究',degree_level:'master',degree_category:'academic',degree_type:'academic_master',discipline_category:'08',discipline:'engineering',major:'计算机科学与技术',major_code:'0812',completion_month:'2025-06'};
export const blocks=[{id:'b1',type:'text',page:1,text:'虚构研究使用三个数据集比较方法，没有报告重复试验及不确定性。',bbox:[100,100,800,160]},{id:'b2',type:'text',page:2,text:'本研究仅用于验证平台，不代表真实实验；作者指出小规模样本限制。',bbox:[100,200,800,260]}];
export function detailedFixture(score=82){return {dimensions:dimensions.map((dimension,i)=>({dimension,summary:'研究有明确的问题与证据，但需要完善论证边界。',assessment_status:'assessed',criteria:standard.rubric[i].criteria.map(c=>({code:c.code,score,reason:'基本论证完整，有对应材料支持，仍需补充边界分析，属于良好档。',evidence_ids:['b1']})),issues:[{criterion_code:`d${i+1}c1`,title:'补充验证与边界',severity:'minor',detail:'现有验证未报告不确定性，影响结果稳定性的解释。',evidence_ids:['b1'],evidence_status:'located',suggestion:'报告重复实验的分布及适用边界。'}]}))};}
// Built-in checks as returned by the model; pass `overrides` to set a status per code.
export function complianceFixture(overrides={}){return ['training','topic','political'].map(code=>({code,status:overrides[code]||'pass',finding:overrides[code]&&overrides[code]!=='pass'?'该项存在需要核实的问题。':'未发现问题。',evidence_ids:overrides[code]&&overrides[code]!=='pass'?['b1']:[]}));}
export function synthesisFixture(result){return {overall_summary:'这是一份虚构论文的评审样例，研究问题清晰，但验证与论证边界需要完善。',strengths:['研究问题与方法之间存在明确联系。'],limitations:['当前材料只能支持有限场景下的结论。'],revision_plan:[{title:'补充验证并收敛结论',priority:'medium',action:'针对已有问题补充验证，明确局限，避免超出样本范围。',issue_ids:result.reviews.flatMap(r=>r.issues).filter(i=>i.severity!=='positive').map(i=>i.id)}].filter(p=>p.issue_ids.length),recommendation:result.recommendation,recommendation_reason:'综合建议由分数、关键维度与意见级别共同确定。'};}
export async function fixtureRepo(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-v2-test-'));const repo=openDatabase(path.join(dir,'review.sqlite3'));repo.seedStandard();
 const user={id:crypto.randomUUID(),username:'fixture_user',phone:'',credentials:{hash:'00',salt:'00'},created_at:new Date().toISOString()};repo.createUser(user);
 const storagePath=path.join(dir,'source.pdf');await fs.writeFile(storagePath,'%PDF-1.4 fake');
 const version=repo.createVersion({owner:user.id,filename:'fixture.pdf',storagePath,metadata,bytes:Buffer.from('%PDF-1.4 fake')});
 const request={metadata:structuredClone(metadata),standard:structuredClone(standard),snapshots:defaultPrompts().map(v=>v.at(-1)),prompt_template_version:promptTemplateVersion,model_config:{provider:'gpt',model:'fixture-model',context_tokens:128000,output_tokens:12000}};
 const task=repo.createTask({id:crypto.randomUUID(),owner_id:user.id,paper_version_id:version.id,provider:'gpt',model:'fixture-model',request});
 return {dir,repo,user,version,task,request,async cleanup(){repo.close();if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('review-v2-test-'))throw Error('Invalid test cleanup path');await fs.rm(dir,{recursive:true,force:true});}};
}
