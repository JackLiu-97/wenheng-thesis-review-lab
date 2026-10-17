'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dimensions=['选题质量','文献综述','逻辑严谨性','工作量','创新性及论文价值','论文规范性'];
// Shared presentation helpers (also used by review-settings.js and portal.js).
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const severityLabels={major:'重点关注',minor:'改进建议',positive:'值得肯定'};
// Token counts and model cost, shown in the task list, run overview and run records.
const fmtTokens=n=>n==null?'—':n>=10000?(n/10000).toFixed(n>=100000?0:1)+' 万':Number(n).toLocaleString('zh-CN');
// Costs are stored in USD (the provider's price list) and shown in RMB at the configured rate.
let usdToCny=null;
const fmtUsd=v=>v==null?'—':'$'+(v<1?v.toFixed(4):v.toFixed(2));
const fmtCny=(v,rate=usdToCny)=>v==null?'—':rate?'¥'+(v*rate).toFixed(v*rate<1?3:2):fmtUsd(v);
const costTitle=(v,rate=usdToCny)=>v==null?'':`${fmtUsd(v)}${rate?`，按 1 美元 = ${rate} 元折算`:''}`;
const gradeLetter=grade=>/^[A-E]/.test(String(grade||''))?String(grade)[0]:'';
const gradeBadge=grade=>grade?`<span class="grade-badge grade--${gradeLetter(grade)||'none'}">${esc(String(grade).replace(/\s*[／/]\s*/,' · '))}</span>`:'<span class="grade-badge grade--none">未评分</span>';
function formatDate(value,withTime=true){
 if(!value)return '—';const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}${withTime?` ${parts.hour==='24'?'00':parts.hour}:${parts.minute}`:''}`;
}
let composeMode=true,state=null,documentData=null,realRun=null,realMode=false,page=1,zoom=100,dimensionFilter='all',selectedIssue=null,opened=new Set(),promptDim=0;
const current=()=>state?.runs?.[0];
let toastTimer=null;
function toast(message,type){
 const el=$('toast');if(!el)return;const text=String(message??'');
 const kind=type||(/失败|错误|无法|超时|中断|不一致|无效|不存在|过于频繁/.test(text)?'error':/请先|不能为空|尚未|一次只能/.test(text)?'warning':/已保存|已提交|完成|已开始|已复制|已刷新|已移除/.test(text)?'success':'info');
 el.className='visible toast--'+kind;el.innerHTML=`${icon({error:'alert',warning:'alert',success:'check',info:'clock'}[kind])}<span>${esc(text)}</span>`;
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),kind==='error'?5200:3200);
}
function pageSize(){return realRun?.coordinate_size||[1000,1000];}
function normalizeRun(run){realRun=run;realMode=true;const issues=[];const anchors={};(run.reviews||[]).forEach((review,dim)=>(review.issues||[]).forEach(item=>{const evidence=(item.evidence||[]).filter(e=>e&&Number.isFinite(e.page)&&Array.isArray(e.bbox));const anchor='real-'+item.id;anchors[anchor]={page:evidence[0]?.page||1,quote:evidence[0]?.text||'',count:evidence.length,boxes:evidence.map(e=>({page:e.page,bbox:e.bbox,text:e.text||''}))};issues.push({...item,id:item.id,dim,dimension:review.dimension,anchor,evidence:item.evidence||[],evidence_ids:item.evidence_ids||[]});}));const pages=run.page_count||Math.max(...(run.blocks||[]).map(b=>b.page||1),1);documentData={pages:Array.from({length:pages},(_,i)=>`第 ${i+1} 页`),anchors};state={runs:[{id:run.id,date:run.created_at,scope:'六维度评审与综合评议',snapshots:run.snapshots||[],issues}],prompts:(run.snapshots||[]).map(x=>[x]),currentRun:run.id};const selected=availableModels.find(m=>m.configured&&m.model===run.model&&(!run.provider||!m.provider||m.provider===run.provider))||availableModels.find(m=>m.id===run.provider&&m.configured);if(selected){$('review-model').value=selected.id;updateModelStatus();}}
function renderHeader(){
 const r=current(),issues=r.issues||[],count=s=>issues.filter(i=>i.severity===s).length;
 $('current-run-label').innerHTML=`<span>${esc(realRun.model||'历史记录未记录模型')}</span><span>${esc(formatDate(realRun.created_at))}</span>`;
 $('run-total').textContent='1';$('issue-total').textContent=issues.length;$('count-issues').textContent=issues.length;$('count-major').textContent=count('major');
 if($('count-minor'))$('count-minor').textContent=count('minor');if($('count-positive'))$('count-positive').textContent=count('positive');
 const h=document.querySelector('.paper-heading h1');if(h)h.textContent=realRun.metadata?.title||realRun.filename;
 const meta=document.querySelector('.paper-meta');if(meta)meta.innerHTML=`<span>${icon('file')}${esc(realRun.filename)}</span><span>${documentData.pages.length} 页</span><span>评审于 ${esc(formatDate(realRun.created_at))}</span>`;
 const link=document.querySelector('.pane-header a');if(link)link.href=realRun.source_pdf;
 document.getElementById('page-workspace')?.classList.remove('is-empty');
}
function renderFilters(){const issues=current()?.issues||[];$('dimension-filters').innerHTML=['全部',...dimensions].map((d,i)=>{const n=i===0?issues.length:issues.filter(x=>x.dim===i-1).length;return `<button class="${(i===0&&dimensionFilter==='all')||(i>0&&dimensionFilter===i-1)?'active':''}" data-filter="${i===0?'all':i-1}">${esc(d)}<span>${n}</span></button>`;}).join('');}
function renderIssues(){const severity=$('severity-filter').value,issues=current()?.issues||[];let html='';dimensions.forEach((name,d)=>{if(dimensionFilter!=='all'&&dimensionFilter!==d)return;const list=issues.filter(i=>i.dim===d&&(severity==='all'||i.severity===severity));if(!list.length)return;html+=`<div class="dimension-heading">${esc(name)}<span>${list.length} 条</span><div class="dim-line"></div></div>`;list.forEach(i=>{const a=documentData.anchors[i.anchor]||{page:1,quote:'',count:0},open=opened.has(i.id),idx=issues.findIndex(x=>x.id===i.id)+1;html+=`<article class="issue issue--${esc(i.severity)} ${selectedIssue===i.id?'selected':''} ${open?'is-open':''}" id="issue-${i.id}"><div class="issue-main" data-locate="${i.id}" role="button" tabindex="0"><span class="issue-number">${idx}</span><span class="issue-title" title="${esc(i.title)}">${esc(i.title)}</span><span class="severity ${esc(i.severity)}">${severityLabels[i.severity]||esc(i.severity)}</span></div><div class="issue-bottom">${a.count?`<button class="evidence-link" data-locate="${i.id}">${icon('locate')}第 ${a.page} 页 · ${a.count} 处证据</button>`:`<span class="evidence-link is-missing">${icon('alert')}未定位到原文证据</span>`}<button class="expand-button" data-expand="${i.id}" aria-expanded="${open}">${open?'收起':'详情'}${icon('chevron')}</button></div><div class="issue-details ${open?'':'hidden'}"><div class="detail-label">详细意见</div><p>${esc(i.detail)}</p>${a.count?`<div class="detail-label">原文证据 · 第 ${a.page} 页<button class="copy-btn" data-copy="quote" data-issue="${i.id}" title="复制原文">${icon('copy')}复制</button></div><div class="quote" data-locate="${i.id}" role="button" tabindex="0" title="在原文中查看">“${esc(a.quote)}”</div>`:'<div class="detail-label">原文证据</div><p class="muted">未定位到原文证据，请结合论文内容人工核实。</p>'}<div class="detail-label">修改建议<button class="copy-btn" data-copy="suggestion" data-issue="${i.id}" title="复制修改建议">${icon('copy')}复制</button></div><p>${esc(i.suggestion)}</p><div class="issue-nav"><button class="btn btn--ghost btn--sm" data-issue-nav="prev">${icon('chevron-up')}上一条</button><button class="btn btn--ghost btn--sm" data-issue-nav="next">下一条${icon('chevron')}</button><span class="kbd-hint"><kbd>J</kbd><kbd>K</kbd> 切换</span></div></div></article>`;});});$('issue-list').innerHTML=html||`<div class="empty-state">${icon('search')}<strong>当前筛选条件下没有意见</strong><button class="btn btn--outline btn--sm" data-clear-filters>清除筛选</button></div>`;}
function renderHighlights(){
  const layers=new Map([...document.querySelectorAll('.page-highlights')].map(el=>[Number(el.dataset.page),el]));
  const groups=new Map();
  if($('highlight-toggle').checked)(current().issues||[]).forEach((issue,index)=>{
    const a=documentData.anchors[issue.anchor];
    (a?.boxes||[]).forEach((e,n)=>{const [w,h]=pageSize(e.page),b=e.bbox;
      if(!groups.has(e.page))groups.set(e.page,[]);
      groups.get(e.page).push(`<button class="evidence-highlight sev-${esc(issue.severity)} ${selectedIssue===issue.id?'active':''}" style="left:${b[0]/w*100}%;top:${b[1]/h*100}%;width:${Math.max((b[2]-b[0])/w*100,.8)}%;height:${Math.max((b[3]-b[1])/h*100,.8)}%" data-pdf-issue="${issue.id}" title="${esc(issue.title)}" aria-label="意见 ${index+1}：${esc(issue.title)}"><span>${index+1}${a.count>1?'·'+(n+1):''}</span></button>`);
    });
  });
  layers.forEach((layer,p)=>layer.innerHTML=(groups.get(p)||[]).join(''));
}
function renderPage(){
  $('pdf-pages').innerHTML=documentData.pages.map((_,i)=>{
    const p=i+1,[w,h]=realRun.page_sizes?.[i]||[595,841];
    return `<section class="pdf-page-item" aria-label="PDF 第 ${p} 页"><div class="page-caption">${p}</div><div class="paper-page" id="paper-page-${p}" data-page="${p}" style="aspect-ratio:${w}/${h}"><img loading="lazy" decoding="async" width="${w}" height="${h}" src="/api/runs/${realRun.id}/pages/${p}.png" alt="论文第 ${p} 页"><div class="page-highlights" data-page="${p}"></div></div></section>`;
  }).join('');
  $('page-total').textContent=documentData.pages.length;
  renderHighlights();updateVisiblePage();
}
function updateVisiblePage(){
  const scroller=$('pdf-scroll'),top=scroller.getBoundingClientRect().top+scroller.clientHeight*.3;
  const pages=[...document.querySelectorAll('.paper-page')];
  const visible=pages.find(el=>el.getBoundingClientRect().bottom>top)||pages.at(-1);
  if(visible){page=Number(visible.dataset.page);$('page-current').textContent=page;const jump=$('page-jump');if(jump&&document.activeElement!==jump)jump.value=page;const n=visible.querySelectorAll('.evidence-highlight').length;$('page-chapter').textContent=n?`本页 ${n} 处证据`:'本页无证据标注';}
}
function setZoom(value){
  const scroller=$('pdf-scroll'),oldWidth=$('pdf-pages').getBoundingClientRect().width;
  zoom=Math.max(70,Math.min(170,value));$('pdf-pages').style.width=zoom+'%';$('zoom-label').textContent=zoom+'%';
  const ratio=$('pdf-pages').getBoundingClientRect().width/oldWidth;
  scroller.scrollTo({top:scroller.scrollTop*ratio,behavior:'instant'});updateVisiblePage();
}
function renderAll(){renderHeader();renderFilters();renderIssues();renderPage();renderRunOverview();}
function locate(id,fromPdf=false){
  const issue=current().issues.find(i=>i.id===id);if(!issue)return;
  const a=documentData.anchors[issue.anchor];if(!a)return;
  selectedIssue=id;opened.add(id);
  if(fromPdf){dimensionFilter='all';$('severity-filter').value='all';renderFilters();tab('results');}
  renderHighlights();renderIssues();
  if(!a.count)return;
  requestAnimationFrame(()=>{
    const scroller=fromPdf?$('issue-list'):$('pdf-scroll');
    const target=fromPdf?$('issue-'+id):$('paper-page-'+a.page);if(!target)return;
    if(!fromPdf){target.querySelector('img').loading='eager';}
    const offset=fromPdf?0:target.getBoundingClientRect().height*(a.boxes?.[0]?.bbox?.[1]||0)/pageSize(a.page)[1];
    const top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top+offset-(fromPdf?10:scroller.clientHeight*.25);
    scroller.scrollTo({top:Math.max(0,top),behavior:'smooth'});
    if(!fromPdf)document.querySelectorAll('.evidence-highlight').forEach(el=>{if(el.dataset.pdfIssue===id){el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse');setTimeout(()=>el.classList.remove('pulse'),1800);}});
    else revealIssue(id);
  });
}
// Keeps the selected opinion visible inside the results list without moving the page.
function revealIssue(id){
  const scroller=$('issue-list'),target=$('issue-'+id);if(!scroller||!target)return;
  const box=target.getBoundingClientRect(),view=scroller.getBoundingClientRect();
  if(box.top<view.top+40||box.bottom>view.bottom)scroller.scrollTo({top:Math.max(0,scroller.scrollTop+box.top-view.top-48),behavior:'smooth'});
}
function stepIssue(delta){
  const ids=[...document.querySelectorAll('#issue-list .issue')].map(el=>el.id.slice(6));if(!ids.length)return;
  const at=ids.indexOf(selectedIssue),next=ids[at<0?(delta>0?0:ids.length-1):Math.max(0,Math.min(ids.length-1,at+delta))];
  if(!next||next===selectedIssue&&at>=0)return;
  locate(next);requestAnimationFrame(()=>revealIssue(next));
}
function copyIssueText(id,kind){
  const issue=current()?.issues.find(i=>i.id===id);if(!issue)return;
  const text=kind==='quote'?(documentData.anchors[issue.anchor]?.quote||''):issue.suggestion||'';
  const done=()=>toast(kind==='quote'?'已复制原文证据':'已复制修改建议');
  if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done,()=>toast('复制失败，请手动选择文本'));
  else toast('当前浏览器不支持一键复制，请手动选择文本');
}
let promptVersions=null,promptLoading=false,promptSaving=false;
const promptDrafts=new Map(),promptSelections=new Map();
function hasPromptDrafts(){return [...promptDrafts.values()].some(d=>d.dirty);}
// Version each dimension will be reviewed with: the one chosen in the editor, otherwise the latest.
const selectedVersion=i=>promptSelections.get(i)??promptVersions?.[i]?.at(-1)?.version;
function selectedPromptVersions(){return promptVersions?dimensions.map((_,i)=>selectedVersion(i)):null;}
function renderPromptView(){
 const versions=promptVersions?.[promptDim]||[];
 const selected=selectedVersion(promptDim);
 const snap=versions.find(v=>v.version===selected)||versions.at(-1);
 const draft=promptDrafts.get(promptDim);
 $('prompt-dimensions').innerHTML=dimensions.map((d,i)=>`<button class="${i===promptDim?'active':''}" data-prompt="${i}">${esc(d)}<em>v${selectedVersion(i)??'—'}${promptDrafts.get(i)?.dirty?' · 未保存':''}</em></button>`).join('');
 $('prompt-title').textContent=dimensions[promptDim];
 // The fixed rubric for this dimension is shown beside the editable prompt so the two read as one prompt.
 // While composing, the weight follows the degree chosen in the upload form.
 const formMeta=composeMode&&typeof readMetadata==='function'&&$('upload-metadata')?readMetadata($('upload-metadata')):null;
 const degreeType=composeMode?(formMeta?.degree_category&&formMeta?.degree_level?`${formMeta.degree_category}_${formMeta.degree_level}`:null):realRun?.metadata?.degree_type;
 const rubric=typeof reviewSettings!=='undefined'&&reviewSettings?.standard?.rubric?.[promptDim],weight=typeof reviewSettings!=='undefined'&&reviewSettings?.degrees?.[degreeType]?.weights?.[promptDim];
 $('prompt-weight').textContent=weight?`${composeMode?'所选学位下':'本论文'}权重 ${weight}%`:'';
 $('prompt-criteria').innerHTML=rubric?rubric.criteria.map(c=>`<div class="prompt-criterion"><strong>${esc(c.name)}</strong><p>${esc(c.check)}</p></div>`).join(''):'<p class="muted">正在载入系统细则…</p>';
 $('prompt-meta').textContent=snap?[typeof formatDate==='function'?formatDate(snap.date):snap.date,snap.note].filter(Boolean).join(' · '):'正在载入提示词…';
 $('version-select').innerHTML=versions.slice().reverse().map(v=>`<option value="${v.version}" ${v.version===snap?.version?'selected':''}>v${v.version}${v.kind!=='focus'?' · 旧版完整提示词（不可用于评审）':v.version===versions.at(-1).version?' · 最新':''}</option>`).join('');
 $('prompt-text').value=draft?.text??snap?.text??'';
 $('prompt-text').readOnly=!snap||snap.kind!=='focus';
 $('version-note').value=draft?.note||'';
 $('version-note').disabled=!snap||snap.kind!=='focus';
 $('save-prompt').disabled=promptSaving||!snap||snap.kind!=='focus';
 $('dirty-badge').textContent=draft?.dirty?'未保存':'';if($('prompt-count'))$('prompt-count').textContent=$('prompt-text').value.length+' / 20000';
 const latest=versions.at(-1)?.version;
 $('prompt-status').textContent=snap?.kind!=='focus'?'旧版提示词只读，不能用于评审；请选择其他版本':draft?.dirty?'草稿尚未保存；评审前请先保存为新版本':snap&&snap.version!==latest?`评审将使用历史版本 v${snap.version}；编辑后保存会生成新版本`:'评审将使用此版本；编辑后保存会生成新版本';
 $('used-version').textContent=current()?.snapshots?.[promptDim]?`v${current().snapshots[promptDim].version}`:'暂无运行';
}
async function loadPromptVersions(){
 if(promptLoading)return;
 promptLoading=true;
 try{const response=await fetch('/api/prompts');if(!response.ok)throw Error('无法载入提示词');promptVersions=await response.json();if(!$('prompts-view').classList.contains('hidden'))renderPromptView();}
 catch(error){toast(error.message);$('prompt-status').textContent=error.message;}
 finally{promptLoading=false;}
}
function capturePromptDraft(){
 const latest=promptVersions?.[promptDim]?.at(-1);if(!latest)return;
 const previous=promptDrafts.get(promptDim);
 promptDrafts.set(promptDim,{text:$('prompt-text').value,note:$('version-note').value,base_version:previous?.base_version??latest.version,dirty:true});
 $('dirty-badge').textContent='未保存';$('prompt-status').textContent='草稿尚未保存；重新评审前请先保存';if($('prompt-count'))$('prompt-count').textContent=$('prompt-text').value.length+' / 20000';
}
async function savePrompt(){
 if(promptSaving)return;
 const index=promptDim,latest=promptVersions?.[index]?.at(-1);if(!latest)return;
 const draft=promptDrafts.get(index)||{text:$('prompt-text').value,note:$('version-note').value,base_version:latest.version};
 if(!draft.text.trim()){toast('提示词不能为空');return;}
 promptSaving=true;$('save-prompt').disabled=true;
 try{
  const response=await fetch('/api/prompts/'+index,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');
  promptVersions[index].push(result);promptSelections.set(index,result.version);
  // Preserve edits made while this save request was in flight.
  if(!promptDrafts.has(index)||promptDrafts.get(index)===draft)promptDrafts.delete(index);
  else promptDrafts.get(index).base_version=result.version;
  toast(dimensions[index]+'已保存为 v'+result.version);
 }catch(error){toast(error.message);$('prompt-status').textContent=error.message;}
 finally{promptSaving=false;if(promptDim===index)renderPromptView();else $('save-prompt').disabled=false;}
}
$('prompt-text').addEventListener('input',capturePromptDraft);
$('version-note').addEventListener('input',capturePromptDraft);
$('save-prompt').addEventListener('click',savePrompt);
$('version-select').addEventListener('change',()=>{
 if(promptDrafts.get(promptDim)?.dirty){toast('请先保存草稿，或点击“载入最新版本”放弃当前草稿');renderPromptView();return;}
 promptSelections.set(promptDim,Number($('version-select').value));renderPromptView();
});
$('restore').addEventListener('click',async()=>{promptDrafts.delete(promptDim);promptSelections.delete(promptDim);await loadPromptVersions();renderPromptView();});
function tab(name){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));['results','prompts','history'].forEach(t=>$(t+'-view').classList.toggle('hidden',t!==name));if(name==='history')renderHistory();if(name==='prompts'){renderPromptView();if(!promptVersions)loadPromptVersions();}}
function renderHistory(){if(!realRun){$('history-list').innerHTML='<div class="empty-state">尚未选择评审记录</div>';return;}$('history-list').innerHTML=`<article class="history-card current"><div class="history-top"><strong>${esc(realRun.metadata?.title||realRun.filename)}</strong><span class="status-pill status-pill--success">${icon('check')}已完成</span></div><div class="history-meta"><span>${esc(formatDate(realRun.created_at))}</span><span>${esc(realRun.model||'历史记录未记录模型')}</span><span>${current().issues.length} 条评审意见</span></div><div class="snapshot-list">${(realRun.snapshots||[]).map((s,i)=>`<details class="snapshot"><summary><span>${esc(dimensions[i])}</span><em>v${s.version}</em></summary><pre>${esc(s.text)}</pre></details>`).join('')}</div>${usageTable(realRun.usage)}</article>`;}
// Every model call behind this result, failed and corrective calls included.
const usageStage={reviewing:'六维度评审',synthesizing:'综合评议'},usageStatus={succeeded:'成功',failed:'失败',interrupted:'中断',running:'进行中'};
function usageTable(u){
 if(!u?.calls)return '';
 return `<div class="usage-table"><h3>模型调用与费用</h3><table><thead><tr><th>阶段</th><th>结果</th><th>输入 token</th><th>输出 token</th><th>费用</th></tr></thead><tbody>${u.attempts.map(a=>`<tr class="${a.status==='succeeded'?'':'is-failed'}"><td>${esc(usageStage[a.stage]||a.stage)} · 第 ${a.attempt_no} 次</td><td>${esc(usageStatus[a.status]||a.status)}</td><td>${a.input_tokens==null?'未记录':fmtTokens(a.input_tokens)+(a.cache_hit_tokens?`<small>缓存 ${fmtTokens(a.cache_hit_tokens)}</small>`:'')}</td><td>${a.output_tokens==null?'未记录':fmtTokens(a.output_tokens)+(a.reasoning_tokens?`<small>思考 ${fmtTokens(a.reasoning_tokens)}</small>`:'')}</td><td title="${esc(costTitle(a.cost_usd,u.usd_to_cny))}">${fmtCny(a.cost_usd,u.usd_to_cny)}${a.price_tier?`<small>${a.price_tier==='peak'?'高峰':'非高峰'} · ${fmtUsd(a.cost_usd)}</small>`:''}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">合计 ${u.calls} 次调用</td><td>${fmtTokens(u.input_tokens)}</td><td>${fmtTokens(u.output_tokens)}</td><td>${fmtCny(u.cost_usd,u.usd_to_cny)}<small>${fmtUsd(u.cost_usd)}</small></td></tr></tfoot></table>${u.unrecorded_calls?`<p class="muted">${u.unrecorded_calls} 次调用发生在用量记录上线前，未计入合计。</p>`:''}</div>`;
}
document.addEventListener('click',e=>{const t=e.target.closest('button,[data-locate]');if(!t)return;if(t.dataset.tab)tab(t.dataset.tab);if(t.dataset.prompt!==undefined){promptDim=Number(t.dataset.prompt);renderPromptView();}if(t.dataset.filter){dimensionFilter=t.dataset.filter==='all'?'all':Number(t.dataset.filter);renderFilters();renderIssues();}if(t.dataset.locate)locate(t.dataset.locate);if(t.dataset.expand){opened.has(t.dataset.expand)?opened.delete(t.dataset.expand):opened.add(t.dataset.expand);renderIssues();}if(t.dataset.pdfIssue)locate(t.dataset.pdfIssue,true);if(t.dataset.issueNav)stepIssue(t.dataset.issueNav==='next'?1:-1);if(t.dataset.copy)copyIssueText(t.dataset.issue,t.dataset.copy);if(t.dataset.clearFilters!==undefined){dimensionFilter='all';$('severity-filter').value='all';renderFilters();renderIssues();}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-locate]')){e.preventDefault();locate(e.target.dataset.locate);}});
if($('severity-filter'))$('severity-filter').onchange=renderIssues;
if($('highlight-toggle'))$('highlight-toggle').onchange=()=>{if(state){renderHighlights();updateVisiblePage();}};
if($('zoom-in'))$('zoom-in').onclick=()=>setZoom(zoom+10);
if($('zoom-out'))$('zoom-out').onclick=()=>setZoom(zoom-10);
if($('fit-page'))$('fit-page').onclick=()=>setZoom(100);
let scrollFrame=null;
if($('pdf-scroll'))$('pdf-scroll').addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;updateVisiblePage();});},{passive:true});

let availableModels=[],testing=false;
function renderModelSelectors(models){
 const first=models.find(m=>m.configured&&m.is_default)||models.find(m=>m.configured)||models[0];
 for(const id of ['upload-model','review-model']){const select=$(id);if(!select)continue;const previous=select.value;
  select.innerHTML=models.map(m=>`<option value="${esc(m.id)}">${esc(m.label||m.model||m.id)}${m.configured?'':'（未配置）'}</option>`).join('');
  select.value=models.some(m=>m.id===previous&&m.configured)?previous:(first?.id||'');
 }
}
function updateModelStatus(){
 const model=availableModels.find(x=>x.id===$('review-model').value);
 $('model-status').textContent=model?.configured?(model.model||'已配置'):'未配置，请先设置 API Key 和模型';
 $('model-status').classList.toggle('field-status--error',!model?.configured);
 $('rerun-top').disabled=testing||!model?.configured;
 $('rerun-prompt').disabled=testing||!model?.configured;
}
async function loadModels(){
 try{const response=await fetch('/api/config/status');if(!response.ok)throw Error();const config=await response.json();availableModels=config.models||[];renderModelSelectors(availableModels);updateModelStatus();}
 catch{$('model-status').textContent='无法读取模型配置，请刷新重试';$('rerun-top').disabled=true;$('rerun-prompt').disabled=true;}
}
async function startTest(){
 if(testing)return;
 if(promptSaving||hasPromptDrafts()){toast('请先保存修改过的提示词，再重新评审');tab('prompts');return;}
 if(!realRun){toast('请先打开一条已有评审记录');return;}
 try{rerunMetadata();}catch(error){toast(error.message);return;}
 const provider=$('review-model').value;
 testing=true;updateModelStatus();$('review-model').disabled=true;
 $('run-overlay').classList.remove('hidden');$('run-step').textContent='正在提交评审任务…';$('run-progress').style.width='5%';
 try{
  // The server reuses the original run's parameters when no metadata is sent.
  const form=new FormData();form.set('provider',provider);form.set('run_id',realRun.id);const versions=selectedPromptVersions();if(versions)form.set('prompt_versions',JSON.stringify(versions));
  const response=await fetch('/api/review',{method:'POST',body:form}),accepted=await response.json();
  if(!response.ok)throw Error(accepted.error||'提交失败');
  let failures=0;
  while(true){
   await new Promise(resolve=>setTimeout(resolve,2000));
   let task;
   try{const response=await fetch('/api/tasks/'+accepted.task_id);if(!response.ok)throw Error('无法读取任务状态');task=await response.json();failures=0;}
   catch(error){if(++failures>=5)throw Error('任务状态连接中断，请稍后刷新查看结果');continue;}
   if(typeof taskProgressBlock==='function'){$('run-step').classList.add('hidden');$('run-progress').parentElement.classList.add('hidden');$('run-live').innerHTML=taskProgressBlock(task);animateBars($('run-live'));liveBase=Date.now();}
   else{$('run-step').textContent=task.message;$('run-progress').style.width=task.progress+'%';}
   if(['failed','interrupted'].includes(task.status))throw Error(task.error||'评审失败');
   if(task.status==='succeeded'){normalizeRun(task.run);history.replaceState(null,'','#workspace/'+encodeURIComponent(task.run.id));opened.clear();selectedIssue=null;dimensionFilter='all';$('severity-filter').value='all';renderAll();tab('results');toast('重新评审完成 · '+task.run.model);if(window.refreshPortal)await window.refreshPortal();break;}
  }
 }catch(error){toast(error.message);$('model-status').textContent=error.message;}
 finally{testing=false;$('review-model').disabled=false;$('run-overlay').classList.add('hidden');$('run-live').innerHTML='';$('run-step').classList.remove('hidden');$('run-progress').parentElement.classList.remove('hidden');const configured=availableModels.find(x=>x.id===$('review-model').value)?.configured;$('rerun-top').disabled=!configured;$('rerun-prompt').disabled=!configured;}
}
$('review-model').addEventListener('change',updateModelStatus);
$('rerun-top').addEventListener('click',startTest);
$('rerun-prompt').addEventListener('click',startTest);
