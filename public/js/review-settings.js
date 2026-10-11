'use strict';
let reviewSettings=null,revisionPaperId=null,metadataRunId=null;
const perFileSettings=new Map();
const metadataFields=[['title','论文标题','text',300],['degree_type','学位类型','degree',50],['discipline','学科大类','discipline',50],['major','专业名称','text',120],['research_direction','研究方向','text',300],['completion_month','完成／提交年月','month',7]];
function monthNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());}
function metadataForm(prefix,values={},override=false){
 return metadataFields.map(([key,label,type,max])=>{const required=['degree_type','discipline','major','completion_month'].includes(key);let control;
  if(type==='degree'||type==='discipline'){const options=type==='degree'?reviewSettings.degrees:reviewSettings.disciplines;control=`<select id="${prefix}-${key}" data-meta="${key}"><option value="">${override?'继承公共参数':'请选择'}</option>${Object.entries(options).map(([code,o])=>`<option value="${code}" ${values[key]===code?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;}
  else control=`<input id="${prefix}-${key}" data-meta="${key}" type="${type}" maxlength="${max}" value="${esc(values[key]||'')}" ${key==='major'?'list="major-options"':''} ${type==='month'?`max="${monthNow()}" min="1900-01"`:''} placeholder="${override?'留空继承公共参数':key==='title'?'留空使用文件名':key==='research_direction'?'可选':'请填写'}">`;
  return `<label for="${prefix}-${key}"><span>${label}${required&&!override?' <span class="required">*</span>':''}</span>${control}</label>`;
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
function summarizeMetadata(meta){return [reviewSettings?.degrees[meta.degree_type]?.label||'未选学位',reviewSettings?.disciplines[meta.discipline]?.label||'未选学科',meta.major||'未填专业',meta.completion_month||'未填年月'].join(' · ');}
function renderFileSettings(){if(!reviewSettings)return;const files=selectedFiles();
 $('file-settings').innerHTML=files.map((file,i)=>`<details class="file-setting"><summary>${esc(file.name)} <span data-file-summary="${i}">${esc(summarizeMetadata(fileMetadata(file)))}</span></summary><p>仅覆盖需要不同设置的字段，留空继承上方公共参数。</p><div class="metadata-grid" data-file-fields="${i}">${metadataForm('file-'+i,perFileSettings.get(file),true)}</div><button type="button" class="btn btn--outline btn--sm" data-file-preview="${i}">预览这篇论文的标准</button></details>`).join('');
}
function updateFileSummaries(){selectedFiles().forEach((file,i)=>{const el=document.querySelector(`[data-file-summary="${i}"]`);if(el)el.textContent=summarizeMetadata(fileMetadata(file));});}
async function previewMetadata(meta,workspace=false){
 try{validateClientMetadata(meta);const response=await api('/api/review-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata:meta})});const prefix=workspace?'rerun-preview':'standard-preview';$(prefix).classList.remove('hidden');$(prefix).open=true;$(prefix+'-text').textContent=response.prompt;}
 catch(error){toast(error.message);}
}
function fillUploadMetadata(values){$('upload-metadata').innerHTML=metadataForm('upload',values);renderFileSettings();}
function rerunMetadata(){return validateClientMetadata(readMetadata($('rerun-metadata')));}
function renderRunOverview(){
 if(!realRun||!reviewSettings)return;const r=realRun;
 if(metadataRunId!==r.id){$('rerun-metadata').innerHTML=metadataForm('rerun',r.metadata||{});metadataRunId=r.id;}
 const fmt=n=>n==null?'未评分':Number(n).toFixed(1);
 $('run-overview').innerHTML=`<div class="card__body"><div class="score-heading"><div><div class="section-kicker">${esc(r.standard_snapshot?.name||'历史评审记录')}</div><strong class="total-score">${fmt(r.total_score)}</strong><span>${esc(r.grade||'历史记录未评分')}</span></div><div><strong>${esc(r.recommendation||'历史记录未提供综合建议')}</strong><p>${esc(r.metadata?summarizeMetadata(r.metadata):'历史记录未提供背景参数')}</p><small>平台辅助评审建议；关键维度与重大问题会影响建议。</small></div></div><p>${esc(r.overall_summary||'历史记录保留原始维度评价，未补造分数和总体结论。')}</p><p>${esc(r.recommendation_reason||'')}</p><details><summary>主要贡献与评价边界</summary><h4>主要贡献与优点</h4><ul>${(r.strengths||[]).map(v=>`<li>${esc(v)}</li>`).join('')||'<li>历史记录未单独提供</li>'}</ul><h4>核心不足与局限</h4><ul>${(r.limitations||[]).map(v=>`<li>${esc(v)}</li>`).join('')||'<li>历史记录未单独提供</li>'}</ul></details><div class="dimension-scores">${r.reviews.map(d=>`<div><span>${esc(d.dimension)}</span><strong>${fmt(d.score)}</strong><small>${d.weight==null?'权重未记录':d.weight+'%'}${d.assessment_status==='insufficient'?' · 材料不足':''}</small></div>`).join('')}</div><details><summary>查看评分依据与优先修改清单</summary>${r.reviews.map(d=>`<h4>${esc(d.dimension)}</h4><p>${esc(d.summary)}</p>${(d.criteria||[]).map(c=>`<p><strong>${esc(r.standard_snapshot?.rubric.flatMap(d=>d.criteria).find(x=>x.code===c.code)?.name||c.code)} · ${fmt(c.score)}</strong><br>${esc(c.reason)}<br><small>证据：${esc(c.evidence_ids.map(id=>{const b=(r.blocks||[]).find(b=>b.id===id);return b?`${id}（PDF 第 ${b.page} 页）`:id;}).join('、')||'未定位')}</small></p>`).join('')}`).join('')}<h4>修改清单</h4>${(r.revision_plan||[]).map(p=>`<article><strong>${esc(({high:'优先',medium:'随后',low:'完善'})[p.priority])} · ${esc(p.title)}</strong><p>${esc(p.action)}</p><small>关联意见：${esc(p.issue_ids.join('、'))}</small></article>`).join('')||'<p>未单独记录</p>'}</details><p id="workspace-report-status" role="status"></p></div>`;
 updateReportButton();
}
function updateReportButton(){if(!realRun)return;const report=realRun.report;const pending=['pending','generating'].includes(report?.status);$('export').disabled=pending;$('export').textContent=report?.status==='ready'?'↓ 下载 PDF':pending?'PDF 正在生成…':report?.status==='failed'?'↻ 重试 PDF':'生成 PDF';if($('workspace-report-status'))$('workspace-report-status').textContent=report?.status==='failed'?'PDF 生成失败：'+report.error:pending?'评审已完成，正在生成 PDF 报告。':report?.status==='ready'?'PDF 报告已就绪。':'可根据已保存结果生成 PDF，无需重新评审。';}
async function downloadReport(id){
 try{const r=id===realRun?.id?realRun:await api('/api/runs/'+encodeURIComponent(id));if(r.report?.status==='ready'){window.location.href='/api/runs/'+encodeURIComponent(id)+'/export?format=pdf';return;}await api('/api/runs/'+encodeURIComponent(id)+'/reports',{method:'POST'});toast('已请求生成 PDF；完成后可下载');await refreshPortal();}
 catch(error){toast(error.message);}
}
async function initReviewSettings(){
 reviewSettings=await api('/api/review-options');fillUploadMetadata({});$('rerun-metadata').innerHTML=metadataForm('rerun');
 $('major-options').innerHTML=reviewSettings.major_suggestions.map(s=>`<option value="${esc(s)}"></option>`).join('');
 $('history-degree').innerHTML='<option value="">全部学位</option>'+Object.entries(reviewSettings.degrees).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
 $('upload-metadata').addEventListener('input',updateFileSummaries);$('upload-metadata').addEventListener('change',updateFileSummaries);
 $('file-settings').addEventListener('input',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('change',event=>{const group=event.target.closest('[data-file-fields]');if(group){perFileSettings.set(selectedFiles()[Number(group.dataset.fileFields)],readMetadata(group));updateFileSummaries();}});
 $('file-settings').addEventListener('click',event=>{const b=event.target.closest('[data-file-preview]');if(b)previewMetadata(fileMetadata(selectedFiles()[Number(b.dataset.filePreview)]));});
 $('preview-standard').addEventListener('click',()=>previewMetadata(selectedFiles().length?fileMetadata(selectedFiles()[0]):readMetadata($('upload-metadata'))));
 $('preview-rerun-standard').addEventListener('click',()=>previewMetadata(readMetadata($('rerun-metadata')),true));
 $('upload-revision').addEventListener('click',()=>{if(!realRun)return;revisionPaperId=realRun.paper_id;fillUploadMetadata(realRun.metadata||{});$('revision-notice').classList.remove('hidden');$('revision-notice').innerHTML=`正在上传「${esc(realRun.metadata?.title||realRun.filename)}」的修订稿。一次选择一个文件。 <button type="button" id="cancel-revision" class="btn btn--outline btn--sm">取消关联</button>`;setPage('review');});
 $('revision-notice').addEventListener('click',event=>{if(event.target.id==='cancel-revision'){revisionPaperId=null;$('revision-notice').classList.add('hidden');}});
 for(const id of ['history-degree','history-grade'])$(id).addEventListener('change',renderArchive);
 document.addEventListener('click',async event=>{const report=event.target.closest('[data-report]');if(report)await downloadReport(report.dataset.report);const retry=event.target.closest('[data-retry]');if(retry){retry.disabled=true;try{await api('/api/tasks/'+encodeURIComponent(retry.dataset.retry)+'/retry',{method:'POST'});await refreshPortal();}catch(error){toast(error.message);}finally{retry.disabled=false;}}});
}
