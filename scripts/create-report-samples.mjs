import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {standard,degreeProfiles} from '../src/standards.mjs';
import {defaultPrompts,promptTemplateVersion,buildPrompt} from '../src/prompts.mjs';
import {validateDetailed,validateSynthesis} from '../src/review-schema.mjs';
import {generatePdf,reportHtml} from '../src/reports.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'data','report-samples');await fs.mkdir(output,{recursive:true});
const blocks=[{id:'b1',page:1,text:'本文件为虚构论文样例。研究提出辅助评审流程，并通过小规模实验说明可行性。',bbox:[100,100,800,160]},{id:'b2',page:2,text:'实验仅覆盖一个专业，没有报告重复运行结果，实际应用效果尚未充分验证。',bbox:[100,200,800,260]},{id:'b3',page:3,text:'作者声明该研究尚存在样本量不足和外推性限制，后续需要补充多学科验证。',bbox:[100,300,800,360]}];
const scores=[84,78,66,88,81,73];let index=0;
for(const [degree,profile] of Object.entries(degreeProfiles)){
 const id='synthetic-'+degree;
 const metadata={title:`${profile.label} · 学位论文辅助评审系统研究（虚构评分样例）`,degree_type:degree,discipline:'engineering',major:'计算机科学与技术',completion_month:'2025-06'};
 const request={metadata,standard,snapshots:defaultPrompts().map(v=>v.at(-1))};
 const raw={dimensions:standard.rubric.map((d,i)=>({dimension:d.name,summary:`本维度按${profile.label}标准评价。虚构材料表明研究具有基本完整性，但验证范围和专业贡献仍需进一步论证。`,assessment_status:'assessed',criteria:d.criteria.map((c,j)=>({code:c.code,score:Math.max(0,scores[index]-i+j),reason:`对“${c.name}”的评价依据：${c.check} 虚构材料仅支持局部场景中的可行性；评分用于展示模板，不代表真实研究质量。`,evidence_ids:[j===2?'b3':'b1']})),issues:[{criterion_code:d.criteria[1].code,title:i===2?'主要结论超出已有证据范围':'需要补充具体研究依据与验证',severity:index===2&&i===2?'major':'minor',detail:'现有材料仅覆盖单一专业，无法证明跨领域适用性。应明确实验对象、对照条件和结果不确定性。'+(index===3&&i===3?'为验证长段落分页，下面重复一段明确标注的排版测试文字。'+('这是虚构排版测试内容，用于检查中文长段落换页、行距及页面底部是否截断，不代表额外评审结论。'.repeat(18)):''),evidence_ids:['b2','b3'],evidence_status:'located',suggestion:'补充与主张直接对应的对照和重复验证，报告波动范围，并收敛结论适用边界。'}]}))};
 const result=validateDetailed(raw,blocks,request,id);
 const synthesis=validateSynthesis({overall_summary:'本报告是使用固定虚构输入生成的可复现版式与评分样例，没有调用模型进行真实研究评价。研究流程具有基本完整性，但证据覆盖、贡献说明和结论边界需要完善。',strengths:['研究问题、方法和证据追溯流程相互衔接。'],limitations:['示例仅有三页，不能替代完整学位论文评价。'],revision_plan:[{title:'补充验证并明确结论边界',priority:index===2?'high':'medium',action:'逐一回应六维度中的问题，说明哪些结果已经获得验证，哪些仍属于后续研究；补充证据后再评估贡献。',issue_ids:result.reviews.flatMap(r=>r.issues.map(i=>i.id))}],recommendation:result.recommendation,recommendation_reason:'按平台默认规则计算。总分等级与关键问题共同决定建议；本例为虚构评分演示。'},result);
 const run={...result,...synthesis,id,metadata,filename:id+'.pdf',created_at:'2026-10-11T00:00:00.000Z',version_no:1,page_count:3,model:'固定虚构响应（未调用模型）',standard_snapshot:standard,snapshots:request.snapshots,prompt_template_version:promptTemplateVersion,blocks};
 await fs.writeFile(path.join(output,id+'.json'),JSON.stringify(run,null,2));await fs.writeFile(path.join(output,id+'.html'),reportHtml(run));await fs.writeFile(path.join(output,id+'.prompt.txt'),buildPrompt(request.snapshots,blocks,request));
 const pdf=path.join(output,id+'.pdf');await generatePdf(run,pdf);console.log(JSON.stringify({degree:profile.label,pdf,score:run.total_score,grade:run.grade,recommendation:run.recommendation}));index++;
}
await fs.writeFile(path.join(output,'README.md'),'# 虚构评审报告样例\n\n六类学位报告均由固定虚构分项结果生成，用于验证评分、中文字体和分页，不是模型评价或真实实验。\n\n重新生成：`npm run reports:samples`。每份报告包含 JSON 数据、HTML、实际提示词和 PDF。\n');
