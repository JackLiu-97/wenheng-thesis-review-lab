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
const formatDate=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—';
function setPage(name,updateHash=true){
 if(!['dashboard','review','history','workspace','profile'].includes(name))name='dashboard';
 activePage=name;
 for(const page of ['dashboard','review','history','workspace','profile'])$('page-'+page).classList.toggle('hidden',page!==name);
 document.querySelectorAll('.sidebar [data-page]').forEach(b=>b.classList.toggle('sidebar__item--active',b.dataset.page===name));
 $('sidebar').classList.remove('sidebar--open');$('sidebar-overlay').classList.remove('sidebar-overlay--visible');$('mobile-menu-btn').setAttribute('aria-expanded','false');
 if(updateHash)history.replaceState(null,'','#'+name+(name==='workspace'&&realRun?'/'+realRun.id:''));
 if(name==='workspace'){
  $('workspace-empty').classList.toggle('hidden',!!realRun);
  if(!realRun){document.querySelector('.paper-heading h1').textContent='评审工作台';$('issue-list').innerHTML='<div class="empty">暂无评审结果，请先上传论文</div>';$('count-issues').textContent='0';$('count-major').textContent='0';$('issue-total').textContent='0';$('run-total').textContent='0';}
  else requestAnimationFrame(updateVisiblePage);
 }
}
function reportAction(run){
 const pending=['pending','generating'].includes(run.report?.status);
 return run.report?.status==='ready'?`<a class="btn btn--outline btn--sm" href="/api/runs/${encodeURIComponent(run.id)}/export?format=pdf">下载 PDF</a>`:`<button class="btn btn--outline btn--sm" data-report="${esc(run.id)}" ${pending?'disabled':''}>${pending?'PDF 生成中':run.report?.status==='failed'?'重试 PDF':'生成 PDF'}</button>`;
}
function recordRow(run){
 return `<article class="record-row"><div><div class="record-title">${esc(run.metadata?.title||run.filename)}</div><div class="record-meta">${esc(formatDate(run.created_at))} · ${esc(run.model||'历史模型未记录')} · ${run.issue_count||0} 条意见</div><div class="record-meta">${esc(run.metadata?summarizeMetadata(run.metadata):'历史参数未记录')} · ${run.total_score==null?'未评分':Number(run.total_score).toFixed(1)+' 分'} ${esc(run.grade||'')}</div></div><div class="record-actions"><button class="btn btn--outline btn--sm" data-open-run="${esc(run.id)}">查看评审 ↗</button>${reportAction(run)}<a class="btn btn--outline btn--sm" href="/api/runs/${encodeURIComponent(run.id)}/export">HTML</a><a class="btn btn--outline btn--sm" href="/api/runs/${encodeURIComponent(run.id)}/export?format=json">JSON</a></div></article>`;
}
function renderArchive(){
 const sorted=archive.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)),query=$('history-search').value.trim().toLowerCase();
 $('recent-list').innerHTML=sorted.slice(0,4).map(recordRow).join('')||'<div class="empty-state">还没有评审记录<br>上传第一篇论文，开始你的评审。</div>';
 $('archive-list').innerHTML=sorted.filter(r=>[r.filename,r.metadata?.title,r.metadata?.major].some(v=>v?.toLowerCase().includes(query))&&(!$('history-degree').value||r.metadata?.degree_type===$('history-degree').value)&&(!$('history-grade').value||r.grade?.startsWith($('history-grade').value))).map(recordRow).join('')||'<div class="empty-state">没有匹配的评审记录</div>';
 $('stat-total').textContent=archive.length+accountTasks.filter(t=>t.status!=='succeeded').length;
 $('stat-running').textContent=accountTasks.filter(t=>['queued','running'].includes(t.status)).length;
 $('stat-done').textContent=archive.length;
 $('stat-failed').textContent=accountTasks.filter(t=>['failed','interrupted'].includes(t.status)).length;
 const labels={queued:'排队中',running:'进行中',succeeded:'已完成',failed:'失败',interrupted:'已中断'};
 $('task-list').innerHTML=accountTasks.slice().reverse().map(t=>`<article class="record-row"><div><div class="record-title">${esc(t.filename)}</div><div class="record-meta">${esc(t.model||t.provider)} · ${esc(formatDate(t.created_at))}</div><div class="record-meta">${esc(t.error||t.message)}</div></div><div class="record-actions"><span class="record-status ${t.status}">${labels[t.status]||esc(t.status)}</span>${t.run_id?`<button class="btn btn--outline btn--sm" data-open-run="${esc(t.run_id)}">查看结果</button><a class="btn btn--outline btn--sm" href="/api/runs/${encodeURIComponent(t.run_id)}/export">HTML</a>${reportAction({id:t.run_id,report:t.report})}`:''}${t.can_retry?`<button class="btn btn--outline btn--sm" data-retry="${esc(t.task_id)}">重试失败阶段</button>`:''}</div></article>`).join('')||'<div class="empty-state">暂无任务。提交后可在这里查看进度，刷新页面后仍可继续查看。</div>';
}
async function refreshPortal(){
 if(refreshing)return;refreshing=true;
 try{[archive,accountTasks]=await Promise.all([api('/api/runs'),api('/api/tasks')]);renderArchive();if(realRun){const latest=archive.find(r=>r.id===realRun.id);if(latest){realRun.report=latest.report;updateReportButton();}}}
 catch(error){toast(error.message);}finally{refreshing=false;}
}
window.refreshPortal=refreshPortal;
let openSerial=0;
async function openRun(id){
 const serial=++openSerial;
 try{
  const run=await api('/api/runs/'+encodeURIComponent(id));if(serial!==openSerial)return;
  normalizeRun(run);opened.clear();selectedIssue=null;dimensionFilter='all';$('severity-filter').value='all';
  setPage('workspace');renderAll();tab('results');
 }catch(error){toast(error.message);}
}
function updateUploadModel(){
 const model=portalModels.find(m=>m.id===$('upload-model').value);
 $('upload-model-status').textContent=!model?.configured?'该模型尚未配置，请配置后再使用':!parserReady?'论文解析服务尚未配置':model.model;
 $('submit-btn').disabled=uploading||!model?.configured||!parserReady||!reviewSettings;
}
let droppedFiles=null;
function selectedFiles(){return droppedFiles||Array.from($('paper-file').files||[]);}
function showFiles(){const files=selectedFiles();$('file-name').textContent=files.map(f=>f.name).join('、');renderFileSettings();}
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
  for(const [index,file] of files.entries()){const form=new FormData();form.set('file',file);form.set('provider',$('upload-model').value);form.set('metadata',JSON.stringify(metadata[index]));if(revisionPaperId)form.set('paper_id',revisionPaperId);await api('/api/review',{method:'POST',body:form});submitted++;}
  $('review-form').reset();perFileSettings.clear();revisionPaperId=null;$('revision-notice').classList.add('hidden');droppedFiles=null;$('paper-file').required=true;showFiles();toast(`已提交 ${submitted} 份论文，正在依次处理`);
 }catch(error){$('upload-error').textContent=`${submitted?`已提交 ${submitted} 份；剩余文件未提交。`:''}${error.message}`;$('upload-error').classList.remove('hidden');droppedFiles=files.slice(submitted);$('paper-file').required=false;showFiles();}
 finally{uploading=false;$('upload-model').disabled=false;updateUploadModel();await refreshPortal();}
});
document.addEventListener('click',event=>{
 const page=event.target.closest('[data-page]');if(page)setPage(page.dataset.page);
 const run=event.target.closest('[data-open-run]');if(run)openRun(run.dataset.openRun);
});
$('history-search').addEventListener('input',renderArchive);
$('refresh-history-btn').addEventListener('click',refreshPortal);
$('refresh-tasks').addEventListener('click',refreshPortal);
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
bootPortal();
