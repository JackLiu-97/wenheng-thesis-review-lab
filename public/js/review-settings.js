'use strict';
let reviewSettings=null,revisionPaperId=null;
const perFileSettings=new Map();
function monthNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());}
function validateClientMetadata(meta){
 if(!reviewSettings.catalog.levels[meta.degree_level])throw Error('请选择学位（学士、硕士或博士）');
 if(!reviewSettings.catalog.degree_categories[meta.degree_category])throw Error('请选择学位类型（学术学位或专业学位）');
 const tree=reviewSettings.catalog.tree[`${meta.degree_category}_${meta.degree_level}`]||{};
 if(!meta.discipline_category)throw Error('请选择学科门类');
 if(!tree[meta.discipline_category])throw Error('所选学科门类不适用于该学位类型，请重新选择');
 if(!meta.major)throw Error('请选择或填写专业名称');
 if(!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(meta.completion_month)||meta.completion_month>monthNow())throw Error('请选择有效的完成年月，且不能晚于当前月份');
 // degree_type / discipline are derived by the server from the fields above.
 const {degree_type,discipline,research_direction,...rest}=meta;return rest;
}
function fileMetadata(file){const base=readMetadata($('upload-metadata')),overrides=perFileSettings.get(file)||{};return {...base,...Object.fromEntries(Object.entries(overrides).filter(([,value])=>value)),title:revisionPaperId&&realRun?.metadata?.title||file.name.replace(/\.pdf$/i,'')};}
function formatMonth(value){const m=/^(\d{4})-(\d{2})$/.exec(value||'');return m?`${m[1]} 年 ${Number(m[2])} 月`:value;}
function summarizeMetadata(raw){
 const meta=normalizeMetadataValues(raw||{}),type=reviewSettings?.degrees[`${meta.degree_category}_${meta.degree_level}`],cat=reviewSettings?.catalog.categories.find(c=>c.code===meta.discipline_category);
 return [meta.degree_level?reviewSettings.catalog.levels[meta.degree_level]?.label:'未选学位',type?.label||'未选类型',cat?cat.name:reviewSettings?.disciplines[meta.discipline]?.label||'未选门类',meta.major||'未选专业',meta.completion_month?formatMonth(meta.completion_month):'未选年月'].join(' · ');
}
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
 const fieldLabels={title:'论文标题',degree_type:'学位类型',discipline:'学科',major:'专业名称',research_direction:'研究方向',completion_month:'完成年月'};
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
 try{if(!workspace)validateClientMetadata(meta);const response=await api('/api/review-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata:meta,prompt_versions:selectedPromptVersions()})});const prefix=workspace?'rerun-preview':'standard-preview';$(prefix).classList.remove('hidden');$(prefix).open=true;renderPreviewDocument($(prefix+'-text'),response.prompt);if($(prefix).scrollIntoView)$(prefix).scrollIntoView({behavior:'smooth',block:'nearest'});}
 catch(error){toast(error.message);}
}
function fillUploadMetadata(values){$('upload-metadata').innerHTML=metadataForm('upload',values);renderFileSettings();}
// 重新评审直接沿用本论文首次评审的参数；缺少参数的历史记录不能直接重评。
function rerunMetadata(){if(!realRun?.metadata?.degree_type)throw Error('该历史记录缺少学位、学科等参数，无法直接重新评审，请重新上传论文');return structuredClone(realRun.metadata);}
function scoreTone(score){return score==null?'none':score>=90?'a':score>=80?'b':score>=70?'c':score>=60?'d':'e';}
// The overview starts collapsed; it stays open only after the viewer expands it.
function overviewCollapsed(){try{return localStorage.getItem('wenheng.overviewCollapsed')!=='0';}catch{return true;}}
function renderRunOverview(){
 if(!realRun||!reviewSettings)return;const r=realRun;
 const fmt=n=>n==null?'—':Number(n).toFixed(1);
 const scored=r.reviews.filter(d=>d.score!=null),lo=Math.min(...scored.map(d=>d.score)),hi=Math.max(...scored.map(d=>d.score)),lowest=scored.length>1&&lo<hi?lo:null;
 const rec=r.recommendation||'',recommendationTone=!rec?'none':/暂不|不建议/.test(rec)?'danger':/较大修改|材料不足/.test(rec)?'warning':/修改/.test(rec)?'info':'success';
 // Built-in checks: a summary pill stays visible when collapsed; the findings show when expanded.
 const checks=r.compliance||[],flagged=checks.filter(c=>c.status!=='pass'),statusLabel={pass:'符合',concern:'存疑',fail:'不符合',insufficient:'材料不足'},statusTone={pass:'success',concern:'warning',fail:'danger',insufficient:'none'};
 const checkPill=checks.length?`<span class="status-pill status-pill--${flagged.some(c=>c.status==='fail')?'danger':flagged.length?'warning':'success'}" title="${esc(checks.map(c=>c.name+'：'+statusLabel[c.status]).join('；'))}">${flagged.length?`专项审查 ${flagged.length} 项需关注`:'专项审查通过'}</span>`:'';
 const checkCards=checks.length?`<div class="compliance-grid">${checks.map(c=>`<div class="compliance-card is-${esc(c.status)}"><div class="compliance-card__top"><strong>${esc(c.name)}</strong><span class="status-pill status-pill--${statusTone[c.status]}">${statusLabel[c.status]}</span></div><p>${esc(c.finding)}</p>${c.evidence?.length?`<small>证据：${c.evidence.map(b=>`<button type="button" class="link-btn" data-locate-block="${esc(b.id)}">第 ${esc(b.page)} 页</button>`).join('、')}</small>`:''}</div>`).join('')}</div>`:'';
 $('run-overview').classList.toggle('is-collapsed',overviewCollapsed());
 $('run-overview').innerHTML=`<div class="card__body">
 <button class="overview-toggle btn btn--ghost btn--sm" data-overview-toggle aria-expanded="${!overviewCollapsed()}"><span class="when-open">收起概览</span><span class="when-closed">展开概览</span>${icon('collapse')}</button>
 <div class="score-heading">
  <div class="score-main">
   <div class="score-label">${esc(r.standard_snapshot?.name||'历史评审记录')}</div>
   <div class="score-value"><strong class="total-score tone-${scoreTone(r.total_score)}">${r.total_score==null?'未评分':fmt(r.total_score)}</strong>${r.total_score==null?'':'<span class="score-unit">/ 100</span>'}</div>
   <div class="score-badges">${gradeBadge(r.grade)}${r.recommendation?`<span class="status-pill status-pill--${recommendationTone}">${esc(r.recommendation)}</span>`:''}${checkPill}</div>
  </div>
  <div class="score-summary">
   <p class="score-meta">${esc(r.metadata?summarizeMetadata(r.metadata):'历史记录未提供背景参数')}</p>
   <p class="score-text">${esc(r.overall_summary||'历史记录保留原始维度评价，未补造分数和总体结论。')}</p>
   ${r.recommendation_reason?`<p class="score-reason"><strong>建议依据</strong>${esc(r.recommendation_reason)}</p>`:''}
  </div>
 </div>
 <div class="dimension-scores">${r.reviews.map(d=>`<div class="dimension-score tone-${scoreTone(d.score)}${d.score!=null&&d.score===lowest?' is-lowest':''}"><div class="dimension-score__top"><span>${esc(d.dimension)}</span>${d.score!=null&&d.score===lowest?'<em>最低</em>':''}</div><strong>${fmt(d.score)}</strong><div class="score-bar"><i style="width:${d.score==null?0:Math.max(0,Math.min(100,d.score))}%"></i></div><small>${d.weight==null?'权重未记录':'权重 '+d.weight+'%'}${d.assessment_status==='insufficient'?' · 材料不足':''}</small></div>`).join('')}</div>
 ${checkCards}
 <div class="overview-details">
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
 reviewSettings=await api('/api/review-options');fillUploadMetadata({});
 $('history-degree').innerHTML='<option value="">全部学位</option>'+Object.entries(reviewSettings.degrees).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
 $('upload-metadata').addEventListener('input',updateFileSummaries);$('upload-metadata').addEventListener('change',updateFileSummaries);
 // The prompt editor shows the dimension weight for the degree chosen here.
 $('upload-metadata').addEventListener('change',()=>{if(composeMode&&activePage==='workspace')renderPromptView();});
 $('file-settings').addEventListener('input',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('change',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-file]');if(remove){event.preventDefault();removeSelectedFile(Number(remove.dataset.removeFile));return;}const b=event.target.closest('[data-file-preview]');if(b)previewMetadata(fileMetadata(selectedFiles()[Number(b.dataset.filePreview)]));});
 $('preview-standard').addEventListener('click',()=>previewMetadata(selectedFiles().length?fileMetadata(selectedFiles()[0]):readMetadata($('upload-metadata'))));
 $('preview-rerun-standard').addEventListener('click',()=>{try{previewMetadata(rerunMetadata(),true);}catch(error){toast(error.message);}});
 $('revision-notice').addEventListener('click',event=>{if(event.target.id==='cancel-revision'){revisionPaperId=null;$('revision-notice').classList.add('hidden');}});
 for(const id of ['history-degree','history-grade'])$(id).addEventListener('change',renderArchive);
 // Evidence of a built-in check jumps the paper pane to that page.
 document.addEventListener('click',event=>{const link=event.target.closest('[data-locate-block]');if(!link||!realRun)return;const block=(realRun.blocks||[]).find(b=>b.id===link.dataset.locateBlock);if(!block)return;if(narrowScreen())showPane('pdf');$('page-jump').value=block.page;jumpToPage();});
 document.addEventListener('click',async event=>{const report=event.target.closest('[data-report]');if(report)await downloadReport(report.dataset.report);const retry=event.target.closest('[data-retry]');if(retry){retry.disabled=true;try{const accepted=await api('/api/tasks/'+encodeURIComponent(retry.dataset.retry)+'/retry',{method:'POST'});if(typeof expandedTasks!=='undefined'){expandedTasks.delete(retry.dataset.retry);expandedTasks.add(accepted.task_id);taskLogs.delete(accepted.task_id);}await refreshPortal();}catch(error){toast(error.message);}finally{retry.disabled=false;}}});
}
