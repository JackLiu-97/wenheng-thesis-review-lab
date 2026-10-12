import {dimensions,standard,calculateScores} from './standards.mjs';
import {complianceChecks,validateCompliance,applyCompliance} from './compliance.mjs';
const string={type:'string'},strings={type:'array',items:string};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const issue=object({criterion_code:string,title:string,severity:{type:'string',enum:['major','minor','positive']},detail:string,evidence_ids:strings,evidence_status:{type:'string',enum:['located','unlocated']},suggestion:string});
const criterion=object({code:string,score:{type:['integer','null'],minimum:0,maximum:100},reason:string,evidence_ids:strings});
export const detailedSchema=object({dimensions:{type:'array',items:object({dimension:string,summary:string,assessment_status:{type:'string',enum:['assessed','insufficient']},criteria:{type:'array',items:criterion},issues:{type:'array',items:issue}})}});
const complianceItem=object({code:{type:'string',enum:complianceChecks.map(c=>c.code)},status:{type:'string',enum:['pass','concern','fail','insufficient']},finding:string,evidence_ids:strings});
// Tasks created with built-in checks also return a compliance array.
export const detailedSchemaFor=request=>request?.compliance_version?{...detailedSchema,required:['dimensions','compliance'],properties:{...detailedSchema.properties,compliance:{type:'array',items:complianceItem}}}:detailedSchema;
export const synthesisSchema=object({overall_summary:string,strengths:strings,limitations:strings,revision_plan:{type:'array',items:object({title:string,priority:{type:'string',enum:['high','medium','low']},action:string,issue_ids:strings})},recommendation:string,recommendation_reason:string});
const invalid=message=>{throw Object.assign(Error('结果校验失败：'+message),{validation:true});};
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())invalid(label+'不能为空');};
function exactKeys(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))invalid(label+'字段不完整或包含未知字段');}
function ids(value,allowed,label){if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!allowed.has(id)))invalid(label+'包含重复或无效的引用');}
export function validateDetailed(raw,blocks,request,runId){
 exactKeys(raw,request.compliance_version?['dimensions','compliance']:['dimensions'],'顶层');if(!Array.isArray(raw.dimensions)||raw.dimensions.length!==6)invalid('必须恰好包含六个维度');
 if(new Set(raw.dimensions.map(r=>r.dimension)).size!==6)invalid('维度重复');
 const policy=request.standard||standard;const blockMap=new Map(blocks.map(b=>[b.id,b]));
 const reviews=dimensions.map((dimension,i)=>{
  const r=raw.dimensions.find(r=>r.dimension===dimension);if(!r)invalid('缺少维度 '+dimension);
  exactKeys(r,['dimension','summary','assessment_status','criteria','issues'],dimension);text(r.summary,'总结');
  if(!['assessed','insufficient'].includes(r.assessment_status))invalid('维度状态无效');
  const codes=policy.rubric[i].criteria.map(c=>c.code);
  if(!Array.isArray(r.criteria)||r.criteria.length!==3||new Set(r.criteria.map(c=>c.code)).size!==3)invalid('分项必须恰好三项且不重复');
  const criteria=codes.map(code=>{const c=r.criteria.find(c=>c.code===code);exactKeys(c,['code','score','reason','evidence_ids'],'分项');text(c.reason,'评分理由');if(c.score!==null&&(!Number.isInteger(c.score)||c.score<0||c.score>100))invalid('分数必须为 0–100 整数或 null');ids(c.evidence_ids,blockMap,'分项证据');return c;});
  if(criteria.some(c=>c.score===null)!==(r.assessment_status==='insufficient'))invalid('材料不足状态与空分数不一致');
  if(!Array.isArray(r.issues))invalid('意见必须为数组');
  const issues=r.issues.map((v,n)=>{exactKeys(v,['criterion_code','title','severity','detail','evidence_ids','evidence_status','suggestion'],'意见');for(const k of ['title','detail','suggestion'])text(v[k],k);if(!codes.includes(v.criterion_code)||!['major','minor','positive'].includes(v.severity))invalid('意见分项或级别无效');ids(v.evidence_ids,blockMap,'意见证据');if(!['located','unlocated'].includes(v.evidence_status)||(v.evidence_status==='located')!==(v.evidence_ids.length>0))invalid('证据状态与引用不一致');if(v.severity==='positive'&&!v.evidence_ids.length)invalid('优点需要原文证据');return {...v,id:`${runId}-${i+1}-${n+1}`,dimension,dimension_index:i,evidence:v.evidence_ids.map(k=>blockMap.get(k))};});
  return {...r,criteria,issues,score_reason:criteria.map(c=>c.reason).join('\n')};
 });
 const compliance=request.compliance_version?validateCompliance(raw.compliance,blockMap).map(c=>({...c,evidence:c.evidence_ids.map(k=>blockMap.get(k))})):null;
 return applyCompliance(calculateScores(reviews,request.metadata,policy),compliance);
}
export function validateSynthesis(raw,result){
 exactKeys(raw,['overall_summary','strengths','limitations','revision_plan','recommendation','recommendation_reason'],'综合评议');
 for(const k of ['overall_summary','recommendation_reason'])text(raw[k],k);
 for(const k of ['strengths','limitations'])if(!Array.isArray(raw[k])||raw[k].some(v=>typeof v!=='string'||!v.trim()))invalid(k+'格式无效');
 if(raw.recommendation!==result.recommendation)invalid('综合评议改变了固定建议');
 const issues=new Map(result.reviews.flatMap(r=>r.issues).filter(i=>i.severity!=='positive').map(i=>[i.id,i]));const covered=new Set();
 if(!Array.isArray(raw.revision_plan))invalid('修改清单无效');
 for(const p of raw.revision_plan){exactKeys(p,['title','priority','action','issue_ids'],'修改事项');text(p.title,'修改标题');text(p.action,'修改行动');if(!['high','medium','low'].includes(p.priority))invalid('优先级无效');ids(p.issue_ids,issues,'修改清单');if(!p.issue_ids.length)invalid('修改事项必须关联已有问题');p.issue_ids.forEach(id=>covered.add(id));}
 if([...issues.keys()].some(id=>!covered.has(id)))invalid('修改清单遗漏已有问题');
 return {...raw,revision_plan:[...raw.revision_plan].sort((a,b)=>['high','medium','low'].indexOf(a.priority)-['high','medium','low'].indexOf(b.priority))};
}
