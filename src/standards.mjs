export const dimensions=['选题质量','文献综述','逻辑严谨性','工作量','创新性及论文价值','论文规范性'];
import {categories,degreeLevels,degreeCategories,availableCategories,findMajor,catalogPayload} from './catalog.mjs';
export const degreeProfiles={
 academic_bachelor:{label:'学术学士',level:'bachelor',category:'academic',weights:[15,15,25,20,10,15],requirement:'本科毕业论文（设计）重点考察综合运用基础理论、专业知识和基本技能分析解决问题的能力；研究过程完整、论证清楚、表达规范即可合格，不以研究生层次的创新深度作为合格的必要条件。'},
 professional_bachelor:{label:'专业学士',level:'bachelor',category:'professional',weights:[15,10,25,25,10,15],requirement:'面向真实专业实践问题，重点考察职业能力训练：问题来源真实、方案或设计合理、实践过程完整且结果可检验；不要求学术原创，但结论必须有依据，不能以完成工作量代替验证。'},
 academic_master:{label:'学硕',level:'master',category:'academic',weights:[15,15,25,15,20,10],requirement:'研究问题明确，研究训练和过程完整；贡献可以有限，但必须清晰并得到论证。不得以博士原创突破作为硕士合格的必要条件。'},
 professional_master:{label:'专硕',level:'master',category:'professional',weights:[15,10,25,20,20,10],requirement:'专业问题真实，方法选择合理，实践过程完整，应用效果有可靠验证。可复用方法的有效专业应用可以构成贡献，但不能以应用名义降低证据严谨性。'},
 academic_doctor:{label:'学博',level:'doctor',category:'academic',weights:[10,15,25,15,25,10],requirement:'原创学术贡献清晰，研究具有充分深度、系统性和独立性；常规方法叠加或小幅指标提升本身不足以证明博士贡献。应验证贡献及成立边界。'},
 professional_doctor:{label:'专博',level:'doctor',category:'professional',weights:[15,10,25,20,20,10],requirement:'针对复杂专业实践问题提出有创新性的解决方案，验证实施效果和适用边界，体现系统深度、专业判断及可迁移的实践贡献。不得只以工程规模代替创新。'}
};
export const disciplineProfiles={
 science:{label:'理学',requirement:'依据研究类型检查理论假设、推导、证明完整性、实验控制和复现条件。纯理论工作无需强制设置实验基线。'},
 engineering:{label:'工学',requirement:'检查问题约束、方法设计、合理基线、实验控制、复现条件、工程资源与部署约束；应用效果必须对应需求。'},
 medicine:{label:'医学与健康',requirement:'检查研究设计、样本来源与代表性、偏倚、终点、统计分析及适用的伦理披露。区分关联与因果，不把未披露等同于已确认违规。'},
 agriculture:{label:'农学',requirement:'检查试验条件、环境因素、重复和对照设计、测量方法、季节与地域适用边界。'},
 business:{label:'经管',requirement:'检查数据来源、变量构造、识别假设、内生性、稳健性；案例或质性研究按其方法评价，不能强制要求计量模型。'},
 humanities:{label:'人文社科',requirement:'检查材料来源、概念界定、理论使用、文本或田野分析、反例与解释边界。质性研究不能以样本量或量化指标机械评价。'},
 education:{label:'教育',requirement:'检查对象与教学情境、测量工具、研究或干预设计、效果证据、混杂因素及推广边界。'},
 arts:{label:'艺术',requirement:'检查研究或创作问题、方法与过程记录、作品分析、表达选择与贡献论证。创作成果按其专业目标评价，不强制套用实验论文结构。'},
 other:{label:'跨学科／其他',requirement:'按实际采用的研究方法评价，明确专门标准覆盖不足的部分；跨学科术语和证据应相互衔接。'}
};
const names=[['问题与研究范围','选题依据与价值','目标、任务与可行性'],['覆盖与时间适切性','比较分析与组织','研究空白与本文关联'],['问题与方法匹配','设计、分析与证据有效性','结论边界和局限性'],['核心工作的完整性','材料与实施的充分性','验证深度与补充分析'],['贡献界定','创新或实践改进的实质性','价值验证与适用边界'],['结构与表达','术语、图表、公式及编号','引用与必要披露']];
const checks=[
 ['定位核心问题、对象和边界，核对题目、摘要和正文是否一致。','评价选题依据是否有材料支撑，区分现实需求、学术价值与空泛背景。','逐项核对目标、研究任务、方法和实际完成内容；不能仅因目标宏大而肯定。'],
 ['按完成年月检查与问题相关的基础及当时研究；没有外部检索时不凭记忆断言遗漏具体论文。','检查是否比较方法、条件、证据和局限，而非逐篇罗列。','核对研究空白是否由综述推出，本文是否回应该空白；不能把无人使用的组合直接视为必要空白。'],
 ['检查方法假设和适用条件是否匹配问题，对替代解释和潜在混杂做具体分析。','按研究类型检查证明、对照、数据划分、测量、统计或材料解释；识别数据泄漏与不充分验证。','逐项核对主张与证据范围，区分相关与因果、局部与普遍，指出超出证据的结论。'],
 ['梳理实际完成的研究环节和作者贡献，核对承诺的工作是否闭合。','按任务复杂度判断数据、材料、实现、访谈、案例或推导的充分性；不按页数或实验数量扣分。','只要求能够消除具体不确定性的补充验证，说明为何必要；避免不切实际地建议重做整个课题。'],
 ['将作者声称的贡献拆为可核验主张，区分已有方法、组合改进及独立贡献。','按照学位要求评价创新深度或复杂实践改进，避免把使用热门工具等同于创新。','核对学术或应用价值是否得到直接证据支持；没有检索不得声称国际首次或全网无新颖性。'],
 ['检查章节组织、摘要与结论一致性、表达清晰度及关键定义。','检查术语、符号、单位、编号、图表标题和正文引用，定位具体不一致。','检查引文与参考文献对应和研究适用的披露；解析未保留版式时不得臆测字体、页边距或排版错误。']
];
export const rubric=dimensions.map((name,i)=>({code:`d${i+1}`,name,criteria:names[i].map((name,j)=>({code:`d${i+1}c${j+1}`,name,check:checks[i][j]}))}));
export const standard={id:'platform-v2',key:'platform',version:2,name:'平台默认评审标准 v2',rubric,degree_profiles:degreeProfiles,discipline_profiles:disciplineProfiles,scoring_rules:{bands:[90,80,70,60],anchors:'90–100：要求充分满足，证据与贡献突出；80–89：主要要求满足，局部可完善；70–79：基本满足但有明显不足；60–69：实质要求不足；0–59：核心要求未满足。锚点必须结合所选学位与研究类型，分数理由须解释符合哪档、为何不能更高。'}};
const fail=message=>Object.assign(Error(message),{status:400});
const currentMonth=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(now);
// 新提交使用「学位层次 + 学位类型 + 学科门类 + 专业」；仍兼容只带 degree_type / discipline 的旧调用与历史记录。
export function validateMetadata(input,filename='',now=new Date()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('请填写论文背景参数');
 const read=(key,max,required=false)=>{const v=input[key]??'';if(typeof v!=='string'||v.length>max||required&&!v.trim())throw fail(`无效或缺少参数：${key}`);return v.trim();};
 let level=read('degree_level',20),category=read('degree_category',20);const legacyType=read('degree_type',50);
 if(!level&&!category&&legacyType){if(!Object.hasOwn(degreeProfiles,legacyType))throw fail('无效的学位类型');({level,category}=degreeProfiles[legacyType]);}
 if(!Object.hasOwn(degreeLevels,level))throw fail('请选择学位（学士、硕士或博士）');
 if(!Object.hasOwn(degreeCategories,category))throw fail('请选择学位类型（学术学位或专业学位）');
 const degree_type=`${category}_${level}`;
 if(legacyType&&legacyType!==degree_type)throw fail('学位与学位类型不一致');
 const categoryCode=read('discipline_category',4);let discipline=read('discipline',50);
 if(categoryCode){
  const found=availableCategories(level,category).find(c=>c.code===categoryCode);
  if(!found)throw fail('所选学科门类不适用于该学位类型');
  discipline=found.profile;
 }else if(!Object.hasOwn(disciplineProfiles,discipline))throw fail('请选择学科门类');
 const major=read('major',120,true),catalogMajor=categoryCode?findMajor(level,category,categoryCode,major):null;
 const result={title:read('title',300)||filename.replace(/\.pdf$/i,''),degree_level:level,degree_category:category,degree_type,...(categoryCode?{discipline_category:categoryCode}:{}),discipline,major,...(catalogMajor?.code?{major_code:catalogMajor.code}:{}),completion_month:read('completion_month',7,true)};
 if(!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(result.completion_month)||result.completion_month>currentMonth(now))throw fail('完成年月无效或晚于当前月份');
 return result;
}
// 供提示词与报告使用的可读背景说明。
export function describeMetadata(meta={}){
 const profile=degreeProfiles[meta.degree_type],category=categories.find(c=>c.code===meta.discipline_category);
 return {
  degree:profile?`${degreeLevels[profile.level].label} · ${degreeCategories[profile.category].label}（${profile.label}）`:'',
  discipline:category?`${category.code} ${category.name}`:disciplineProfiles[meta.discipline]?.label||'',
  major:meta.major?`${meta.major_code?meta.major_code+' ':''}${meta.major}`:''
 };
}
export function reviewOptions(){return {degrees:degreeProfiles,disciplines:disciplineProfiles,standard,catalog:catalogPayload()};}
export function calculateScores(reviews,metadata,policy=standard){
 const weights=policy.degree_profiles[metadata.degree_type].weights;
 const scored=reviews.map((r,i)=>({...r,weight:weights[i],score:r.assessment_status==='insufficient'?null:r.criteria.reduce((n,c)=>n+c.score,0)/3}));
 if(scored.some(r=>r.score===null))return {reviews:scored,total_score:null,grade:null,assessment_status:'insufficient',recommendation:'材料不足，补充后评审'};
 // Integer sub-scores and integer percent weights avoid floating-point drift at x.x5 boundaries.
 const numerator=scored.reduce((n,r)=>n+r.criteria.reduce((s,c)=>s+c.score,0)*r.weight,0);
 const total=Math.round(numerator/30)/10;
 const grade=total>=90?'A／优秀':total>=80?'B／良好':total>=70?'C／合格':total>=60?'D／需较大修改':'E／未达到要求';
 const issues=scored.flatMap(r=>r.issues);
 const recommendation=total<60||scored[2].score<60||scored[4].score<60?'暂不建议答辩，实质修改后重新评审':total<70||issues.some(i=>i.severity==='major')?'较大修改后重新评审':issues.some(i=>i.severity==='minor')?'修改后答辩':'答辩';
 return {reviews:scored,total_score:total,grade,recommendation,assessment_status:'assessed'};
}
