'use strict';
let reviewSettings=null,revisionPaperId=null,metadataRunId=null;
const perFileSettings=new Map();
const metadataFields=[['title','论文标题','text',300],['degree_type','学位类型','degree',50],['discipline','学科大类','discipline',50],['major','专业名称','text',120],['research_direction','研究方向','text',300],['completion_month','完成 / 提交年月','month',7]];
function monthNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());}
function metadataForm(prefix,values={},override=false){
 return metadataFields.map(([key,label,type,max])=>{const required=['degree_type','discipline','major','completion_month'].includes(key);let control;
  if(type==='degree'||type==='discipline'){const options=type==='degree'?reviewSettings.degrees:reviewSettings.disciplines;control=`<select id="${prefix}-${key}" data-meta="${key}"><option value="">${override?'继承公共参数':'请选择'}</option>${Object.entries(options).map(([code,o])=>`<option value="${code}" ${values[key]===code?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;}
  else control=`<input id="${prefix}-${key}" data-meta="${key}" type="${type}" maxlength="${max}" value="${esc(values[key]||'')}" ${key==='major'?'list="major-options"':''} ${type==='month'?`max="${monthNow()}" min="1900-01" lang="zh-CN"`:''} placeholder="${override?'留空继承公共参数':key==='title'?'留空则使用文件名':key==='research_direction'?'可选':'请填写'}">`;
  return `<label for="${prefix}-${key}" class="field${key==='title'?' field--wide':''}"><span>${label}${required&&!override?' <span class="required">*</span>':''}</span>${control}</label>`;
 }).join('');
}
function readMetadata(container){return Object.fromEntries([...container.querySelectorAll('[data-meta]')].map(el=>[el.dataset.meta,el.value.trim()]));}
function validateClientMetadata(meta){
 if(!reviewSettings.degrees[meta.degree_type])throw Error('请选择学位类型');
 if(!reviewSettings.disciplines[meta.discipline])throw Error('请选择学科大类');
 if(!meta.major)throw Error('请填写专业名称');
 if(!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(meta.completion_month)||meta.completion_month>monthNow())throw Error('请填写有效的完成年月，且不能晚于当前月份');return meta;
}
function fileMetadata(file){const base=readMetadata($('upload-metadata')),overrides=perFileSettings.get(file)||{};return {...base,...Object.fromEntries(Object.entries(overrides).filter(([,value])=>value)),title:overrides.title||base.title||file.name.replace(/\.pdf$/i,'')};}
function formatMonth(value){const m=/^(\d{4})-(\d{2})$/.exec(value||'');return m?`${m[1]} 年 ${Number(m[2])} 月`:value;}
function summarizeMetadata(meta){return [reviewSettings?.degrees[meta.degree_type]?.label||'未选学位',reviewSettings?.disciplines[meta.discipline]?.label||'未选学科',meta.major||'未填专业',meta.completion_month?formatMonth(meta.completion_month):'未填年月'].join(' · ');}
const formatSize=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
function fileProblem(file){return !file.name.toLowerCase().endsWith('.pdf')?'不是 PDF 文件':(file.size||0)>30*1024*1024?'超过 30 MB 上限':'';}
function renderFileSettings(){if(!reviewSettings)return;const files=selectedFiles();
 const total=files.reduce((sum,f)=>sum+(f.size||0),0),bad=files.filter(fileProblem).length;
 const head=files.length?`<div class="file-list__head"><span>已选择 <b>${files.length}</b> 份 · 共 ${formatSize(total)}</span>${files.length>10?'<span class="file-list__warn">一次最多提交 10 份，请移除多余文件</span>':bad?`<span class="file-list__warn">${bad} 份文件无法提交，请移除</span>`:'<span class="file-list__ok">文件检查通过</span>'}</div>`:'';
 $('file-settings').innerHTML=head+files.map((file,i)=>`<details class="file-setting${fileProblem(file)?' is-invalid':''}"><summary><span class="file-setting__icon">${icon(fileProblem(file)?'alert':'file')}</span><span class="file-setting__main"><span class="file-setting__name" title="${esc(file.name)}">${esc(file.name)}</span><span class="file-setting__meta">${fileProblem(file)?`<span class="file-setting__error">${fileProblem(file)}</span>`:''}<span>${formatSize(file.size||0)}</span><span data-file-summary="${i}">${esc(summarizeMetadata(fileMetadata(file)))}</span></span></span><span class="file-setting__edit">单独设置${icon('chevron')}</span><button type="button" class="icon-btn file-setting__remove" data-remove-file="${i}" aria-label="移除 ${esc(file.name)}" title="移除">${icon('x')}</button></summary><div class="file-setting__body"><p class="muted">仅填写与公共参数不同的字段，留空则继承公共参数。</p><div class="metadata-grid" data-file-fields="${i}">${metadataForm('file-'+i,perFileSettings.get(file),true)}</div><button type="button" class="btn btn--outline btn--sm" data-file-preview="${i}">${icon('eye')}预览这篇论文的标准</button></div></details>`).join('');
}
function updateFileSummaries(){selectedFiles().forEach((file,i)=>{const el=document.querySelector(`[data-file-summary="${i}"]`);if(el)el.textContent=summarizeMetadata(fileMetadata(file));});}
// Turns the plain-text prompt preview into readable sections; falls back to raw text.
function renderPreviewDocument(container,text){
 const fieldLabels={title:'论文标题',degree_type:'学位类型',discipline:'学科大类',major:'专业名称',research_direction:'研究方向',completion_month:'完成年月'};
 const valueLabel=(key,value)=>key==='degree_type'?reviewSettings?.degrees?.[value]?.label||value:key==='discipline'?reviewSettings?.disciplines?.[value]?.label||value:key==='completion_month'?formatMonth(value):value;
 try{
  const lines=String(text||'').split('\n');const sections=[];let currentSection={title:'',body:[]};sections.push(currentSection);
  for(let i=0;i<lines.length;i++){
   const line=lines[i];const heading=/^【([^】]+)】(.*)$/.exec(line.trim());
   if(heading&&!heading[2].trim()&&!/论文材料/.test(heading[1])){currentSection={title:heading[1],body:[]};sections.push(currentSection);continue;}
   if(line.trim()==='{'){let j=i,json='';for(;j<lines.length;j++){json+=lines[j]+'\n';if(lines[j].trim()==='}')break;}try{currentSection.body.push({type:'table',data:JSON.parse(json)});i=j;continue;}catch{}}
   currentSection.body.push({type:'line',text:line});
  }
  const renderLine=raw=>{const line=raw.trim();if(!line)return '';
   const sub=/^【([^】]+)】(.*)$/.exec(line);if(sub)return /论文材料/.test(sub[1])?`<p class="preview-doc__note">${esc(sub[1])}</p>`:`<h5>${esc(sub[1])}<span>${esc(sub[2].trim())}</span></h5>`;
   const code=/^(d\dc\d)\s+(.+?)：(.*)$/.exec(line);if(code)return `<p class="preview-doc__criterion"><code>${esc(code[1])}</code><strong>${esc(code[2])}</strong>${esc(code[3])}</p>`;
   return `<p>${esc(line)}</p>`;};
  const renderBody=body=>body.map(item=>item.type==='table'?`<table class="kv-table">${Object.entries(item.data).map(([k,v])=>`<tr><th>${esc(fieldLabels[k]||k)}</th><td>${esc(valueLabel(k,v))||'<span class="muted">未填写</span>'}</td></tr>`).join('')}</table>`:renderLine(item.text)).join('');
  container.innerHTML=sections.map((s,i)=>!s.title?`<div class="preview-doc__intro">${renderBody(s.body)}</div>`:`<details class="preview-doc__section" ${i<=2?'open':''}><summary>${esc(s.title)}</summary><div>${renderBody(s.body)}</div></details>`).join('');
 }catch{container.innerHTML=`<pre>${esc(text)}</pre>`;}
}
async function previewMetadata(meta,workspace=false){
 try{validateClientMetadata(meta);const response=await api('/api/review-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata:meta})});const prefix=workspace?'rerun-preview':'standard-preview';$(prefix).classList.remove('hidden');$(prefix).open=true;renderPreviewDocument($(prefix+'-text'),response.prompt);if($(prefix).scrollIntoView)$(prefix).scrollIntoView({behavior:'smooth',block:'nearest'});}
 catch(error){toast(error.message);}
}
function fillUploadMetadata(values){$('upload-metadata').innerHTML=metadataForm('upload',values);renderFileSettings();}
function rerunMetadata(){return validateClientMetadata(readMetadata($('rerun-metadata')));}
function scoreTone(score){return score==null?'none':score>=90?'a':score>=80?'b':score>=70?'c':score>=60?'d':'e';}
function overviewCollapsed(){try{return localStorage.getItem('wenheng.overviewCollapsed')==='1';}catch{return false;}}
function renderRunOverview(){
 if(!realRun||!reviewSettings)return;const r=realRun;
 if(metadataRunId!==r.id){$('rerun-metadata').innerHTML=metadataForm('rerun',r.metadata||{});metadataRunId=r.id;}
 const fmt=n=>n==null?'—':Number(n).toFixed(1);
 const scored=r.reviews.filter(d=>d.score!=null),lo=Math.min(...scored.map(d=>d.score)),hi=Math.max(...scored.map(d=>d.score)),lowest=scored.length>1&&lo<hi?lo:null;
 const rec=r.recommendation||'',recommendationTone=!rec?'none':/暂不|不建议/.test(rec)?'danger':/较大修改|材料不足/.test(rec)?'warning':/修改/.test(rec)?'info':'success';
 const criterionName=c=>r.standard_snapshot?.rubric.flatMap(d=>d.criteria).find(x=>x.code===c.code)?.name||c.code;
 const evidenceText=c=>esc(c.evidence_ids.map(id=>{const b=(r.blocks||[]).find(b=>b.id===id);return b?`第 ${b.page} 页`:id;}).join('、')||'未定位');
 $('run-overview').classList.toggle('is-collapsed',overviewCollapsed());
 $('run-overview').innerHTML=`<div class="card__body">
 <button class="overview-toggle btn btn--ghost btn--sm" data-overview-toggle aria-expanded="${!overviewCollapsed()}"><span class="when-open">收起概览</span><span class="when-closed">展开概览</span>${icon('collapse')}</button>
 <div class="score-heading">
  <div class="score-main">
   <div class="score-label">${esc(r.standard_snapshot?.name||'历史评审记录')}</div>
   <div class="score-value"><strong class="total-score tone-${scoreTone(r.total_score)}">${r.total_score==null?'未评分':fmt(r.total_score)}</strong>${r.total_score==null?'':'<span class="score-unit">/ 100</span>'}</div>
   <div class="score-badges">${gradeBadge(r.grade)}${r.recommendation?`<span class="status-pill status-pill--${recommendationTone}">${esc(r.recommendation)}</span>`:''}</div>
  </div>
  <div class="score-summary">
   <p class="score-meta">${esc(r.metadata?summarizeMetadata(r.metadata):'历史记录未提供背景参数')}</p>
   <p class="score-text">${esc(r.overall_summary||'历史记录保留原始维度评价，未补造分数和总体结论。')}</p>
   ${r.recommendation_reason?`<p class="score-reason"><strong>建议依据</strong>${esc(r.recommendation_reason)}</p>`:''}
  </div>
 </div>
 <div class="dimension-scores">${r.reviews.map(d=>`<div class="dimension-score tone-${scoreTone(d.score)}${d.score!=null&&d.score===lowest?' is-lowest':''}"><div class="dimension-score__top"><span>${esc(d.dimension)}</span>${d.score!=null&&d.score===lowest?'<em>最低</em>':''}</div><strong>${fmt(d.score)}</strong><div class="score-bar"><i style="width:${d.score==null?0:Math.max(0,Math.min(100,d.score))}%"></i></div><small>${d.weight==null?'权重未记录':'权重 '+d.weight+'%'}${d.assessment_status==='insufficient'?' · 材料不足':''}</small></div>`).join('')}</div>
 <div class="overview-details">
  <details><summary>主要贡献与评价边界</summary><div class="two-col"><div><h4>主要贡献与优点</h4><ul>${(r.strengths||[]).map(v=>`<li>${esc(v)}</li>`).join('')||'<li class="muted">历史记录未单独提供</li>'}</ul></div><div><h4>核心不足与局限</h4><ul>${(r.limitations||[]).map(v=>`<li>${esc(v)}</li>`).join('')||'<li class="muted">历史记录未单独提供</li>'}</ul></div></div></details>
  <details><summary>评分依据与优先修改清单</summary><div class="criteria-list">${r.reviews.map(d=>`<section><h4>${esc(d.dimension)}<span>${fmt(d.score)}</span></h4><p>${esc(d.summary)}</p>${(d.criteria||[]).map(c=>`<div class="criterion"><div class="criterion__head"><strong>${esc(criterionName(c))}</strong><span>${fmt(c.score)}</span></div><p>${esc(c.reason)}</p><small>证据：${evidenceText(c)}</small></div>`).join('')}</section>`).join('')}</div><h4>修改清单</h4><div class="revision-plan">${(r.revision_plan||[]).map(p=>`<article class="plan-item plan--${esc(p.priority)}"><span class="plan-item__tag">${esc(({high:'优先',medium:'随后',low:'完善'})[p.priority]||p.priority)}</span><div><strong>${esc(p.title)}</strong><p>${esc(p.action)}</p><small>关联意见：${esc(p.issue_ids.join('、')||'—')}</small></div></article>`).join('')||'<p class="muted">未单独记录</p>'}</div></details>
  <span id="workspace-report-status" class="status-pill" role="status"></span>
 </div>
</div>`;
 updateReportButton();
}
function updateReportButton(){if(!realRun)return;const report=realRun.report;const pending=['pending','generating'].includes(report?.status);$('export').disabled=pending;$('export').innerHTML=report?.status==='ready'?icon('download')+'下载 PDF':pending?'<span class="loader loader--sm"></span>PDF 生成中':report?.status==='failed'?icon('refresh')+'重试生成 PDF':icon('file')+'生成 PDF';const status=$('workspace-report-status');if(status){status.textContent=report?.status==='failed'?'PDF 生成失败：'+report.error:pending?'正在生成 PDF 报告':report?.status==='ready'?'PDF 报告已就绪':'可直接生成 PDF，无需重新评审';status.className='status-pill status-pill--'+(report?.status==='failed'?'danger':pending?'warning':report?.status==='ready'?'success':'none');}}
async function downloadReport(id){
 try{const r=id===realRun?.id?realRun:await api('/api/runs/'+encodeURIComponent(id));if(r.report?.status==='ready'){window.location.href='/api/runs/'+encodeURIComponent(id)+'/export?format=pdf';return;}await api('/api/runs/'+encodeURIComponent(id)+'/reports',{method:'POST'});toast('已开始生成 PDF，完成后即可下载');await refreshPortal();}
 catch(error){toast(error.message);}
}
function removeSelectedFile(index){
 const files=selectedFiles().filter((_,i)=>i!==index);
 if(files.length){droppedFiles=files;$('paper-file').required=false;}else{droppedFiles=null;$('paper-file').value='';$('paper-file').required=true;}
 showFiles();
}
async function initReviewSettings(){
 reviewSettings=await api('/api/review-options');fillUploadMetadata({});$('rerun-metadata').innerHTML=metadataForm('rerun');
 $('major-options').innerHTML=reviewSettings.major_suggestions.map(s=>`<option value="${esc(s)}"></option>`).join('');
 $('history-degree').innerHTML='<option value="">全部学位</option>'+Object.entries(reviewSettings.degrees).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
 $('upload-metadata').addEventListener('input',updateFileSummaries);$('upload-metadata').addEventListener('change',updateFileSummaries);
 $('file-settings').addEventListener('input',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('change',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-file]');if(remove){event.preventDefault();removeSelectedFile(Number(remove.dataset.removeFile));return;}const b=event.target.closest('[data-file-preview]');if(b)previewMetadata(fileMetadata(selectedFiles()[Number(b.dataset.filePreview)]));});
 $('preview-standard').addEventListener('click',()=>previewMetadata(selectedFiles().length?fileMetadata(selectedFiles()[0]):readMetadata($('upload-metadata'))));
 $('preview-rerun-standard').addEventListener('click',()=>previewMetadata(readMetadata($('rerun-metadata')),true));
 $('upload-revision').addEventListener('click',()=>{if(!realRun)return;revisionPaperId=realRun.paper_id;fillUploadMetadata(realRun.metadata||{});$('revision-notice').classList.remove('hidden');$('revision-notice').innerHTML=`<span>${icon('alert')}正在上传「${esc(realRun.metadata?.title||realRun.filename)}」的修订稿，一次只能选择一个文件。</span><button type="button" id="cancel-revision" class="btn btn--ghost btn--sm">取消关联</button>`;setPage('review');});
 $('revision-notice').addEventListener('click',event=>{if(event.target.id==='cancel-revision'){revisionPaperId=null;$('revision-notice').classList.add('hidden');}});
 for(const id of ['history-degree','history-grade'])$(id).addEventListener('change',renderArchive);
 document.addEventListener('click',async event=>{const report=event.target.closest('[data-report]');if(report)await downloadReport(report.dataset.report);const retry=event.target.closest('[data-retry]');if(retry){retry.disabled=true;try{await api('/api/tasks/'+encodeURIComponent(retry.dataset.retry)+'/retry',{method:'POST'});await refreshPortal();}catch(error){toast(error.message);}finally{retry.disabled=false;}}});
}
