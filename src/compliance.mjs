// 平台内置专项审查：审查要求只在后端拼入提示词，不出现在提示词配置、预览或运行快照中；结果单独输出。
export const complianceVersion='compliance-v1';
export const complianceStatus={pass:'符合',concern:'存疑',fail:'不符合',insufficient:'材料不足'};
export const complianceChecks=[
 {code:'training',name:'专业培养要求符合性',prompt:`对照论文背景中的学位层次、学位类型与专业，判断论文是否符合该专业的培养要求：
1. 选题是否属于本专业（或专业学位领域）的研究范围，研究对象与方法是否以本专业的基础理论和专门知识为主体。
2. 学术学位侧重理论或方法的研究训练，专业学位侧重解决实际问题与实践应用；论文类型是否与学位类型相称。
3. 论文体现的文献掌握、方法运用与独立分析能力，是否达到该学位层次的基本要求。
跨学科选题只要以本专业知识为主体即判为 pass；不能因为研究成果应用于其他领域就判为不符合。
pass：明显属于本专业且与学位类型相称；concern：专业相关性较弱，或学位类型特征不明显；fail：论文主体明显属于其他专业，或明显达不到该学位层次的基本要求。`},
 {code:'topic',name:'文题一致性',prompt:`核对题目与正文是否相符，是否存在文不对题：
1. 题目中的核心概念、研究对象、方法与范围，是否在正文中得到实质研究。
2. 正文主体是否围绕题目展开，有无大量与题目无关的内容。
3. 题目是否明显大于或偏离实际研究内容（例如题目为“系统设计与实现”，正文却只有理论分析）。
4. 摘要、关键词、结论与题目是否一致。
pass：题目准确概括正文；concern：题目范围偏大、措辞不准确或部分内容偏离，可通过修改题目或补充内容解决；fail：题目与正文主体内容明显不符。`},
 {code:'political',name:'政治方向',prompt:`检查论文是否存在政治方向与意识形态方面的问题。只依据论文中明确出现的表述判断，不做推测和过度解读：
1. 是否有违反宪法和法律法规、反对中国共产党领导和社会主义制度的表述。
2. 是否有损害国家主权、统一和领土完整的表述，例如把台湾、香港、澳门与国家并列，或文字说明中出现错误的国界、领土表述。
3. 是否有歪曲历史、民族歧视、宗教极端或宣扬违法内容的表述。
4. 是否有泄露国家秘密的明显迹象，例如标注涉密的数据或内部文件。
绝大多数技术与学术内容与政治无关，此时判为 pass，finding 写“未发现政治方向问题”。不能因为正常的学术讨论、国际比较、引用国外文献或使用国外数据集而判为存疑。图片、地图等无法从解析文本判断的内容，只有在出现文字证据时才能提出。concern 与 fail 必须引用具体原文证据，说明哪处表述存在什么问题。`}
];

export function complianceSection(hidden=false){
 if(hidden)return `【专项审查】
平台内置 ${complianceChecks.length} 项专项审查（${complianceChecks.map(c=>c.name).join('、')}），审查要求不公开，结果单独输出。`;
 return `【专项审查】
以下 ${complianceChecks.length} 项独立于六维度评分，逐项给出结论。status 只能为 pass（符合）、concern（存疑）、fail（不符合）或 insufficient（解析材料不足以判断）。
finding 写明判断依据；concern 与 fail 必须给出 evidence_ids，pass 可以给出支持性证据，也可以为空。专项审查不影响维度分数。
${complianceChecks.map(c=>`${c.code} ${c.name}：\n${c.prompt}`).join('\n\n')}`;
}
export const complianceOutputSpec=`顶层另含 compliance 数组，按 ${complianceChecks.map(c=>c.code).join('、')} 各恰好一项；每项：code, status(pass/concern/fail/insufficient), finding, evidence_ids。`;

const invalid=message=>{throw Object.assign(Error('结果校验失败：'+message),{validation:true});};
export function validateCompliance(raw,blockMap){
 if(!Array.isArray(raw)||raw.length!==complianceChecks.length)invalid(`专项审查必须恰好 ${complianceChecks.length} 项`);
 return complianceChecks.map(check=>{
  const item=raw.find(v=>v?.code===check.code);if(!item)invalid('缺少专项审查 '+check.name);
  const keys=['code','status','finding','evidence_ids'];
  if(Object.keys(item).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(item,k)))invalid('专项审查字段不完整或包含未知字段');
  if(!Object.hasOwn(complianceStatus,item.status))invalid('专项审查结论无效');
  if(typeof item.finding!=='string'||!item.finding.trim())invalid('专项审查说明不能为空');
  if(!Array.isArray(item.evidence_ids)||new Set(item.evidence_ids).size!==item.evidence_ids.length||item.evidence_ids.some(id=>!blockMap.has(id)))invalid('专项审查证据包含重复或无效的引用');
  if(['concern','fail'].includes(item.status)&&!item.evidence_ids.length)invalid(`${check.name}判为${complianceStatus[item.status]}时必须引用原文证据`);
  return {code:check.code,name:check.name,status:item.status,finding:item.finding.trim(),evidence_ids:item.evidence_ids};
 });
}
// 专项审查不改分数，但会收紧建议：任何一项不符合即不建议答辩；存疑至少需要较大修改后重新评审。
const ladder=['答辩','修改后答辩','较大修改后重新评审','暂不建议答辩，实质修改后重新评审'];
export function applyCompliance(result,compliance){
 if(!compliance)return result;
 let recommendation=result.recommendation;
 if(compliance.some(c=>c.status==='fail'))recommendation=ladder[3];
 else if(compliance.some(c=>c.status==='concern')&&ladder.indexOf(recommendation)>=0&&ladder.indexOf(recommendation)<2)recommendation=ladder[2];
 return {...result,recommendation,compliance};
}
