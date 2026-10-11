'use strict';
let account=null,archive=[],accountTasks=[],portalModels=[],parserReady=false,refreshing=false,uploading=false,activePage='dashboard';
const originalFetch=window.fetch.bind(window);
window.fetch=async(...args)=>{
 const response=await originalFetch(...args);
 if(response.status===401&&String(args[0]).startsWith('/api/'))window.location.replace('/login.html');
 return response;
};
async function api(url,options){
 const response=await fetch(url,options);const data=await response.json();
 if(!response.ok)throw Error(data.error||'请求失败');return data;
}
const pageTitles={dashboard:'仪表盘',review:'新建评审',history:'评审历史',workspace:'评审工作台',profile:'个人中心'};
function relativeTime(value){const time=new Date(value).getTime();if(!time)return formatDate(value);const seconds=(Date.now()-time)/1000;if(seconds<60)return '刚刚';if(seconds<3600)return Math.floor(seconds/60)+' 分钟前';if(seconds<86400)return Math.floor(seconds/3600)+' 小时前';if(seconds<86400*7)return Math.floor(seconds/86400)+' 天前';return formatDate(value);}
function setPage(name,updateHash=true){
 if(!['dashboard','review','history','workspace','profile'].includes(name))name='dashboard';
 const previous=activePage;activePage=name;
 document.title=(name==='workspace'&&realRun?(realRun.metadata?.title||realRun.filename):pageTitles[name])+' · 文衡';
 if(previous!==name&&typeof window.scrollTo==='function')window.scrollTo({top:0});
 for(const page of ['dashboard','review','history','workspace','profile'])$('page-'+page).classList.toggle('hidden',page!==name);
 document.querySelectorAll('.sidebar [data-page]').forEach(b=>b.classList.toggle('sidebar__item--active',b.dataset.page===name));
 $('sidebar').classList.remove('sidebar--open');$('sidebar-overlay').classList.remove('sidebar-overlay--visible');$('mobile-menu-btn').setAttribute('aria-expanded','false');
 if(updateHash)history.replaceState(null,'','#'+name+(name==='workspace'&&realRun?'/'+realRun.id:''));
 if(name==='workspace'){
  $('workspace-empty').classList.toggle('hidden',!!realRun);
  $('page-workspace').classList.toggle('is-empty',!realRun);
  if(!realRun){document.querySelector('.paper-heading h1').textContent='评审工作台';$('issue-list').innerHTML='<div class="empty-state">暂无评审结果，请先上传论文</div>';for(const id of ['count-issues','count-major','count-minor','count-positive','issue-total','run-total'])if($(id))$(id).textContent='0';}
  else requestAnimationFrame(updateVisiblePage);
 }
}
function reportAction(run,compact=false){
 const pending=['pending','generating'].includes(run.report?.status),cls=compact?'link-btn':'btn btn--outline btn--sm';
 return run.report?.status==='ready'?`<a class="${cls}" href="/api/runs/${encodeURIComponent(run.id)}/export?format=pdf">${icon('download')}PDF</a>`:`<button class="${cls}" data-report="${esc(run.id)}" ${pending?'disabled':''}>${pending?'PDF 生成中':run.report?.status==='failed'?icon('refresh')+'重试 PDF':icon('file')+'生成 PDF'}</button>`;
}
function scoreCell(run){return run.total_score==null?'<span class="score-num muted">—</span>':`<span class="score-num tone-${scoreTone(run.total_score)}">${Number(run.total_score).toFixed(1)}</span>`;}
function recordRow(run){
 return `<article class="record-row record-row--compact is-clickable" data-row-open="${esc(run.id)}"><div class="record-main"><div class="record-title" title="${esc(run.metadata?.title||run.filename)}">${esc(run.metadata?.title||run.filename)}</div><div class="record-meta"><span title="${esc(formatDate(run.created_at))}">${esc(relativeTime(run.created_at))}</span><span>${esc(run.model||'历史模型未记录')}</span><span>${run.issue_count||0} 条意见</span></div></div><div class="record-score">${scoreCell(run)}${gradeBadge(run.grade)}</div><div class="record-actions"><button class="btn btn--outline btn--sm" data-open-run="${esc(run.id)}">查看</button></div></article>`;
}
function archiveRow(run){
 return `<article class="record-row archive-row is-clickable" data-row-open="${esc(run.id)}"><div class="record-main"><button class="record-title link-title" data-open-run="${esc(run.id)}" title="${esc(run.metadata?.title||run.filename)}">${esc(run.metadata?.title||run.filename)}</button><div class="record-meta"><span>${esc(run.metadata?summarizeMetadata(run.metadata):'历史参数未记录')}</span>${run.metadata?.title&&run.metadata.title!==run.filename?`<span class="muted">${esc(run.filename)}</span>`:''}</div></div><div class="archive-col archive-col--model">${esc(run.model||'未记录')}<small>${run.issue_count||0} 条意见</small></div><div class="archive-col archive-col--score">${scoreCell(run)}${gradeBadge(run.grade)}</div><div class="archive-col archive-col--date">${esc(formatDate(run.created_at))}</div><div class="record-actions"><button class="btn btn--primary btn--sm" data-open-run="${esc(run.id)}">查看评审</button><span class="export-links">${reportAction(run,true)}<a class="link-btn" href="/api/runs/${encodeURIComponent(run.id)}/export">HTML</a><a class="link-btn" href="/api/runs/${encodeURIComponent(run.id)}/export?format=json">JSON</a></span></div></article>`;
}
const taskStages=[['queued','排队'],['parsing','解析'],['reviewing','维度评审'],['synthesizing','综合评议'],['completed','完成']];
const taskLabels={queued:'排队中',running:'进行中',succeeded:'已完成',failed:'失败',interrupted:'已中断'};
const taskTone={queued:'none',running:'info',succeeded:'success',failed:'danger',interrupted:'warning'};
function taskSteps(t){
 const at=Math.max(0,taskStages.findIndex(([key])=>key===(t.status==='succeeded'?'completed':t.stage)));
 const bad=['failed','interrupted'].includes(t.status);
 return `<ol class="task-steps">${taskStages.map(([,label],i)=>`<li class="${i<at||t.status==='succeeded'?'done':i===at?(bad?'failed':'current'):''}">${label}</li>`).join('')}</ol>`;
}
function taskRow(t,compact=false){
 const progress=Math.max(0,Math.min(100,Number(t.progress)||0));
 return `<article class="record-row task-row task-row--${esc(t.status)}"><div class="record-main"><div class="record-title" title="${esc(t.filename)}">${esc(t.filename)}</div><div class="record-meta"><span>${esc(t.model||t.provider||'')}</span><span title="${esc(formatDate(t.created_at))}">${esc(relativeTime(t.created_at))}</span></div>${['queued','running'].includes(t.status)?`<div class="task-progress"><div class="progress-track"><i style="width:${Math.max(progress,3)}%"></i></div><span>${progress}%</span></div>`:''}${compact||t.status==='succeeded'?'':taskSteps(t)}${t.error||t.message?`<div class="task-message${t.error?' is-error':''}">${esc(t.error||t.message)}</div>`:''}</div><div class="record-actions"><span class="status-pill status-pill--${taskTone[t.status]||'none'}">${taskLabels[t.status]||esc(t.status)}</span>${t.run_id?`<button class="btn btn--outline btn--sm" data-open-run="${esc(t.run_id)}">查看结果</button>${compact?'':`<span class="export-links">${reportAction({id:t.run_id,report:t.report},true)}<a class="link-btn" href="/api/runs/${encodeURIComponent(t.run_id)}/export">HTML</a></span>`}`:''}${t.can_retry?`<button class="btn btn--outline btn--sm" data-retry="${esc(t.task_id)}">${icon('refresh')}重试失败阶段</button>`:''}</div></article>`;
}
function renderGradeOverview(){
 const scored=archive.filter(r=>r.total_score!=null);
 if(!scored.length){$('dash-grades').innerHTML='<div class="empty-state empty-state--inline">完成评分的记录会在这里汇总等级分布</div>';return;}
 const avg=scored.reduce((sum,r)=>sum+Number(r.total_score),0)/scored.length;
 const counts=['A','B','C','D','E'].map(g=>[g,scored.filter(r=>gradeLetter(r.grade)===g).length]);const max=Math.max(...counts.map(c=>c[1]),1);
 $('dash-grades').innerHTML=`<div class="grade-overview"><div class="grade-overview__avg"><span>平均总分</span><strong class="tone-${scoreTone(avg)}">${avg.toFixed(1)}</strong><small>共 ${scored.length} 篇已评分</small></div><div class="grade-bars">${counts.map(([g,n])=>`<div class="grade-bar"><span class="grade-badge grade--${g}">${g}</span><div class="score-bar"><i class="bar--${g}" style="width:${n/max*100}%"></i></div><b>${n}</b></div>`).join('')}</div></div>`;
}
function renderArchive(){
 const sort=$('history-sort')?.value||'time',byTime=(a,b)=>b.created_at.localeCompare(a.created_at);
 const sorted=archive.slice().sort(byTime),query=$('history-search').value.trim().toLowerCase();
 const score=r=>r.total_score==null?null:Number(r.total_score);
 const ordered=sort==='time'?sorted:sorted.slice().sort((a,b)=>score(a)==null?1:score(b)==null?-1:sort==='score-asc'?score(a)-score(b):score(b)-score(a));
 $('recent-list').innerHTML=sorted.slice(0,5).map(recordRow).join('')||`<div class="empty-state">${icon('file')}<strong>还没有评审记录</strong><span>上传第一篇论文，开始你的评审。</span><button class="btn btn--primary btn--sm" data-page="review">新建评审</button></div>`;
 const rows=ordered.filter(r=>[r.filename,r.metadata?.title,r.metadata?.major].some(v=>v?.toLowerCase().includes(query))&&(!$('history-degree').value||r.metadata?.degree_type===$('history-degree').value)&&(!$('history-grade').value||r.grade?.startsWith($('history-grade').value)));
 $('archive-list').innerHTML=rows.length?`<div class="archive-head"><span>论文</span><span>模型</span><span>评分</span><span>评审时间</span><span>操作</span></div>${rows.map(archiveRow).join('')}<div class="archive-foot">共 ${rows.length} 条${rows.length!==archive.length?`（全部 ${archive.length} 条）`:''}</div>`:archive.length?'<div class="empty-state">没有匹配的评审记录，试试调整搜索词或筛选条件</div>':`<div class="empty-state">${icon('history')}<strong>还没有评审记录</strong><span>提交的论文完成评审后会出现在这里。</span><button class="btn btn--primary btn--sm" data-page="review">新建评审</button></div>`;
 $('stat-total').textContent=archive.length+accountTasks.filter(t=>t.status!=='succeeded').length;
 $('stat-running').textContent=accountTasks.filter(t=>['queued','running'].includes(t.status)).length;
 $('stat-done').textContent=archive.length;
 $('stat-failed').textContent=accountTasks.filter(t=>['failed','interrupted'].includes(t.status)).length;
 const tasks=accountTasks.slice().reverse();
 $('task-list').innerHTML=tasks.map(t=>taskRow(t)).join('')||'<div class="empty-state empty-state--inline">暂无任务。提交后可在这里查看进度，刷新页面后仍可继续查看。</div>';
 if($('dash-tasks')){const rank={running:0,queued:1,failed:2,interrupted:3},active=tasks.filter(t=>t.status!=='succeeded').sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)).slice(0,4);$('dash-tasks').innerHTML=active.map(t=>taskRow(t,true)).join('')||'<div class="empty-state empty-state--inline">当前没有排队或进行中的任务</div>';}
 if($('dash-grades'))renderGradeOverview();
}
async function refreshPortal(){
 if(refreshing)return;refreshing=true;
 try{[archive,accountTasks]=await Promise.all([api('/api/runs'),api('/api/tasks')]);renderArchive();if(realRun){const latest=archive.find(r=>r.id===realRun.id);if(latest){realRun.report=latest.report;updateReportButton();}}}
 catch(error){toast(error.message);}finally{refreshing=false;}
}
window.refreshPortal=refreshPortal;
let openSerial=0;
async function openRun(id){
 const serial=++openSerial;topProgress.start();$('page-workspace').classList.add('is-loading');
 try{
  const run=await api('/api/runs/'+encodeURIComponent(id));if(serial!==openSerial)return;
  normalizeRun(run);opened.clear();selectedIssue=null;dimensionFilter='all';$('severity-filter').value='all';
  setPage('workspace');renderAll();tab('results');
 }catch(error){toast(error.message);}
 finally{if(serial===openSerial){$('page-workspace').classList.remove('is-loading');}topProgress.done();}
}
function updateUploadModel(){
 const model=portalModels.find(m=>m.id===$('upload-model').value);
 $('upload-model-status').textContent=!model?.configured?'该模型尚未配置，请配置后再使用':!parserReady?'论文解析服务尚未配置':model.model;
 $('submit-btn').disabled=uploading||!model?.configured||!parserReady||!reviewSettings;
}
let droppedFiles=null;
function selectedFiles(){return droppedFiles||Array.from($('paper-file').files||[]);}
function showFiles(){const files=selectedFiles();$('file-name').textContent=files.length?`已选择 ${files.length} 份`:'';renderFileSettings();}
$('paper-file').addEventListener('change',()=>{droppedFiles=null;showFiles();});
$('upload-area').addEventListener('dragover',event=>{event.preventDefault();$('upload-area').classList.add('dragging');});
$('upload-area').addEventListener('dragleave',()=>$('upload-area').classList.remove('dragging'));
$('upload-area').addEventListener('drop',event=>{event.preventDefault();$('upload-area').classList.remove('dragging');droppedFiles=Array.from(event.dataTransfer.files);$('paper-file').required=false;showFiles();});
$('upload-model').addEventListener('change',updateUploadModel);
$('review-form').addEventListener('submit',async event=>{
 event.preventDefault();if(uploading)return;
 const files=selectedFiles();$('upload-error').classList.add('hidden');
 if(!files.length){$('upload-error').textContent='请先选择论文 PDF';$('upload-error').classList.remove('hidden');return;}
 if(files.length>10||files.some(f=>!f.name.toLowerCase().endsWith('.pdf')||f.size>30*1024*1024)){
  $('upload-error').textContent='每次最多提交 10 份 PDF，每份不超过 30 MB';$('upload-error').classList.remove('hidden');return;
 }
 if(promptSaving||hasPromptDrafts()){toast('请先保存评审重点草稿');setPage('workspace');tab('prompts');return;}
 if(revisionPaperId&&files.length!==1){toast('修订稿一次只能选择一份文件');return;}
 let metadata;try{metadata=files.map(file=>validateClientMetadata(fileMetadata(file)));}catch(error){$('upload-error').textContent=error.message;$('upload-error').classList.remove('hidden');return;}
 uploading=true;updateUploadModel();$('upload-model').disabled=true;let submitted=0;
 try{
  for(const [index,file] of files.entries()){$('submit-btn').innerHTML=`<span class="loader loader--sm loader--light"></span>正在提交 ${index+1} / ${files.length}`;const form=new FormData();form.set('file',file);form.set('provider',$('upload-model').value);form.set('metadata',JSON.stringify(metadata[index]));if(revisionPaperId)form.set('paper_id',revisionPaperId);await api('/api/review',{method:'POST',body:form});submitted++;}
  $('review-form').reset();perFileSettings.clear();revisionPaperId=null;$('revision-notice').classList.add('hidden');droppedFiles=null;$('paper-file').required=true;showFiles();toast(`已提交 ${submitted} 份论文，正在依次处理`);
 }catch(error){$('upload-error').textContent=`${submitted?`已提交 ${submitted} 份；剩余文件未提交。`:''}${error.message}`;$('upload-error').classList.remove('hidden');droppedFiles=files.slice(submitted);$('paper-file').required=false;showFiles();}
 finally{uploading=false;$('submit-btn').textContent='开始评审';$('upload-model').disabled=false;updateUploadModel();await refreshPortal();}
});
document.addEventListener('click',event=>{
 const page=event.target.closest('[data-page]');if(page)setPage(page.dataset.page);
 const run=event.target.closest('[data-open-run]');if(run)openRun(run.dataset.openRun);
 // Whole record rows open the review, except clicks on their own links and buttons.
 const row=event.target.closest('[data-row-open]');if(row&&!run&&!event.target.closest('a,button'))openRun(row.dataset.rowOpen);
});
$('history-search').addEventListener('input',renderArchive);
if($('history-sort'))$('history-sort').addEventListener('change',renderArchive);
async function manualRefresh(button){if(button.classList.contains('is-busy'))return;button.classList.add('is-busy');const started=Date.now();await refreshPortal();setTimeout(()=>button.classList.remove('is-busy'),Math.max(0,500-(Date.now()-started)));}
$('refresh-history-btn').addEventListener('click',()=>manualRefresh($('refresh-history-btn')));
$('refresh-tasks').addEventListener('click',()=>manualRefresh($('refresh-tasks')));
$('export').addEventListener('click',()=>{if(realRun)downloadReport(realRun.id);else toast('请先选择一条评审记录');});
$('logout-btn').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});window.location.replace('/login.html');}catch(error){toast(error.message);}});
$('password-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.target.querySelector('button');
 if($('new-password').value!==$('confirm-password').value){$('password-message').textContent='两次新密码不一致';return;}
 button.disabled=true;
 try{await api('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:$('old-password').value,password:$('new-password').value})});window.location.replace('/login.html');}
 catch(error){$('password-message').textContent=error.message;}finally{button.disabled=false;}
});
$('mobile-menu-btn').addEventListener('click',()=>{const open=$('sidebar').classList.toggle('sidebar--open');$('sidebar-overlay').classList.toggle('sidebar-overlay--visible',open);$('mobile-menu-btn').setAttribute('aria-expanded',String(open));});
$('sidebar-overlay').addEventListener('click',()=>setPage(activePage));
function showPane(name){const layout=document.querySelector('.split-layout');if(!layout)return;layout.classList.toggle('show-pdf',name==='pdf');document.querySelectorAll('[data-pane]').forEach(b=>{const on=b.dataset.pane===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});if(name==='pdf')requestAnimationFrame(updateVisiblePage);}
const narrowScreen=()=>typeof window.matchMedia==='function'&&window.matchMedia('(max-width: 900px)').matches;
document.addEventListener('click',event=>{
 const pane=event.target.closest('[data-pane]');if(pane){showPane(pane.dataset.pane);return;}
 if(!narrowScreen())return;
 // On phones the two panes are stacked as tabs: jump to whichever side the click points at.
 if(event.target.closest('.evidence-link[data-locate],.quote[data-locate]'))showPane('pdf');
 else if(event.target.closest('[data-pdf-issue]'))showPane('review');
},true);
window.addEventListener('hashchange',()=>{const [page,id]=location.hash.slice(1).split('/');if(page==='workspace'&&id)openRun(id);else setPage(page,false);});
async function bootPortal(){
 try{
  account=(await api('/api/auth/me')).user;
  $('current-username').textContent=account.username;$('user-avatar').textContent=account.username.slice(0,1);
  $('greeting-text').textContent='欢迎回来，'+account.username;$('current-date').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  $('profile-username').textContent=account.username;$('profile-phone').textContent=account.phone||'未填写';$('profile-created').textContent=formatDate(account.created_at);
  const config=await api('/api/config/status');portalModels=config.models;parserReady=config.mineru_configured;availableModels=portalModels;renderModelSelectors(portalModels);updateModelStatus();updateUploadModel();
  await initReviewSettings();updateUploadModel();await refreshPortal();
  const [page,id]=location.hash.slice(1).split('/');
  if(page==='workspace'&&id)await openRun(id);
  else{if(archive.length){const latest=archive.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];const run=await api('/api/runs/'+latest.id);normalizeRun(run);renderAll();}setPage(page||'dashboard');}
  setInterval(()=>{if(!document.hidden)refreshPortal();},5000);
 }catch(error){toast(error.message);}
}

// ---------------------------------------------------------------------------
// Interaction layer: loading feedback, keyboard shortcuts, hover linking.
// ---------------------------------------------------------------------------
const topProgress={count:0,timer:null,
 start(){const bar=$('top-progress');if(!bar)return;this.count++;clearTimeout(this.timer);bar.classList.remove('is-done');bar.classList.add('is-active');},
 done(){const bar=$('top-progress');if(!bar)return;this.count=Math.max(0,this.count-1);if(this.count)return;bar.classList.add('is-done');this.timer=setTimeout(()=>bar.classList.remove('is-active','is-done'),400);}};
let hoverIssue=null;
function setHoverIssue(id){
 if(id===hoverIssue)return;document.querySelectorAll('.is-hover').forEach(el=>el.classList.remove('is-hover'));hoverIssue=id;if(!id)return;
 document.querySelectorAll('.evidence-highlight').forEach(el=>{if(el.dataset.pdfIssue===id)el.classList.add('is-hover');});
 $('issue-'+id)?.classList.add('is-hover');
}
document.addEventListener('mouseover',event=>{
 if(!event.target.closest)return;const highlight=event.target.closest('.evidence-highlight'),issue=event.target.closest('.issue');
 setHoverIssue(highlight?highlight.dataset.pdfIssue:issue?issue.id.slice(6):null);
});
function jumpToPage(){
 const input=$('page-jump');if(!input||!documentData)return;const total=documentData.pages.length;
 const value=Math.max(1,Math.min(total,parseInt(input.value,10)||page));input.value=value;
 const scroller=$('pdf-scroll'),target=$('paper-page-'+value);if(!target)return;
 const img=target.querySelector('img');if(img)img.loading='eager';
 scroller.scrollTo({top:scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-28,behavior:'smooth'});
}
if($('page-jump')){
 $('page-jump').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpToPage();event.target.blur();}else if(event.key==='Escape'){event.target.value=page;event.target.blur();}});
 $('page-jump').addEventListener('focus',event=>{if(event.target.select)event.target.select();});
 $('page-jump').addEventListener('blur',event=>{event.target.value=page;});
}
document.addEventListener('click',event=>{
 const toggle=event.target.closest&&event.target.closest('[data-overview-toggle]');if(!toggle)return;
 const collapsed=$('run-overview').classList.toggle('is-collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));
 try{localStorage.setItem('wenheng.overviewCollapsed',collapsed?'1':'0');}catch{}
});
document.addEventListener('keydown',event=>{
 const target=event.target||{},typing=!!(target.closest&&target.closest('input,textarea,select,[contenteditable="true"]'));
 const promptsOpen=activePage==='workspace'&&!$('prompts-view').classList.contains('hidden');
 if((event.metaKey||event.ctrlKey)&&String(event.key).toLowerCase()==='s'&&promptsOpen){event.preventDefault();savePrompt();return;}
 if(event.key==='Escape'){
  if($('sidebar').classList.contains('sidebar--open')){setPage(activePage,false);return;}
  if(typing){target.blur?.();return;}
  if(activePage==='workspace'&&selectedIssue){selectedIssue=null;renderHighlights();renderIssues();}
  return;
 }
 if(typing||event.metaKey||event.ctrlKey||event.altKey)return;
 if((event.key==='Enter'||event.key===' ')&&target.matches&&target.matches('[role="button"][data-page]')){event.preventDefault();setPage(target.dataset.page);return;}
 if(activePage==='workspace'&&realRun&&!$('results-view').classList.contains('hidden')&&/^[jk]$/i.test(event.key)){event.preventDefault();stepIssue(/j/i.test(event.key)?1:-1);return;}
 if(event.key==='/'&&activePage==='history'){event.preventDefault();$('history-search').focus();}
});
window.addEventListener('beforeunload',event=>{if(typeof hasPromptDrafts==='function'&&hasPromptDrafts()){event.preventDefault();event.returnValue='';}});

bootPortal();
