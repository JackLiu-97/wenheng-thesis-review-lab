export const dimensions=['选题质量','文献综述','逻辑严谨性','工作量','创新性及论文价值','论文规范性'];
const focus=['研究问题的清晰程度、选题依据与研究目标是否一致。','文献覆盖、组织结构、比较分析以及研究空白的论证。','前提、方法、实验与结论之间的逻辑链条，避免以局部结果支持普遍结论。','方法实现、数据准备、实验设计与验证工作是否充分。','区分工程组合与实质创新，评价研究贡献、应用价值及其边界。','术语、结构、图表、引用与表达的一致性和规范性。'];
const legacySuffix='\n\n请严格输出 JSON，不要输出 Markdown。每条意见必须包含 title、severity（major/minor/positive）、detail、evidence_ids（来自给定文本块 ID 的数组）和 suggestion。只根据论文内容判断，证据不足时明确说明，不能编造证据或坐标。';

// Only remove the exact legacy wrapper. Preserve custom instructions verbatim.
export function focusText(snapshot,index){
 const text=snapshot.text;
 if(snapshot.kind==='focus')return text;
 const prefix=`你是一名严谨的学术论文评审专家，请从“${dimensions[index]}”维度评审论文。\n\n评审重点：`;
 return text.startsWith(prefix)&&text.endsWith(legacySuffix)?text.slice(prefix.length,-legacySuffix.length):text;
}
export const defaultPrompts=()=>focus.map(text=>[{version:1,date:'初始版本',note:'系统默认评审重点',kind:'focus',text}]);
export function migratePrompts(store){
 let changed=false;
 store.prompts.forEach((versions,index)=>{
  const latest=versions.at(-1);
  if(latest.kind==='focus')return;
  versions.push({version:Math.max(...versions.map(v=>v.version))+1,date:new Date().toISOString(),note:'提取独立评审重点，公共指令由后端统一拼接',kind:'focus',text:focusText(latest,index)});
  changed=true;
 });
 return changed;
}
export function appendFocusVersion(store,index,input){
 if(!Number.isInteger(index)||index<0||index>=dimensions.length)throw Object.assign(new Error('无效的评审维度'),{status:400});
 if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>20000)throw Object.assign(new Error('评审重点不能为空，且不得超过 20000 字符'),{status:400});
 if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>500))throw Object.assign(new Error('版本说明不得超过 500 字符'),{status:400});
 const versions=store.prompts[index],latest=versions.at(-1);
 if(input.base_version!==latest.version)throw Object.assign(new Error('该维度已有更新，请先载入最新版本；你的草稿仍保留在编辑框中'),{status:409});
 const version={version:latest.version+1,date:new Date().toISOString(),note:input.note?.trim()||'更新评审重点',kind:'focus',text:input.text.trim()};
 versions.push(version);
 return version;
}
export const promptTemplateVersion='focus-v1';
export function buildPrompt(snapshots,blocks){
 if(snapshots.length!==dimensions.length)throw new Error('必须提供六个维度的评审重点');
 return `你是一名严谨的学术论文评审专家。请根据论文内容，从以下六个维度进行评审。只根据论文内容判断，证据不足时明确说明，不得编造证据或坐标。

评审重点：
${snapshots.map((s,i)=>`【${dimensions[i]}】\n${focusText(s,i)}`).join('\n\n')}

输出要求：
严格输出 JSON，不要输出 Markdown。顶层为 {"dimensions": [...]}，必须包含上述六个维度，且名称完全一致。
每个维度包含 dimension（维度名称）、summary（评审总结）、issues（评审意见数组）。
每条意见包含 title（意见标题）、severity（major/minor/positive）、detail（详细意见）、evidence_ids（支持该意见的论文文本块 ID 数组，只能使用下方提供的 ID）、suggestion（修改建议）。

论文已解析文本块：
${blocks.map(b=>`[${b.id}] page=${b.page} ${b.text}`).join('\n')}`;
}
