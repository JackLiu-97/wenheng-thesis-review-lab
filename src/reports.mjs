import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {describeMetadata} from './standards.mjs';
import {safeError} from './models.mjs';
import {evidenceHtml,hasMath,katexCss} from './evidence-format.mjs';
export const reportTemplateVersion='report-v3.0';
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const number=v=>v==null?'—':Number(v).toFixed(1);
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未记录';
const tone=score=>score==null?'none':score>=90?'a':score>=80?'b':score>=70?'c':score>=60?'d':'e';
const recommendationTone=rec=>!rec?'none':/暂不|不建议/.test(rec)?'danger':/较大修改|材料不足/.test(rec)?'warning':/修改/.test(rec)?'info':'success';
const severity={major:['重大问题','major'],minor:['修改建议','minor'],positive:['值得肯定','positive']};
const priority={high:['优先处理','danger'],medium:['随后处理','warning'],low:['最后完善','info']};
const checkStatus={pass:['符合','success'],concern:['存疑','warning'],fail:['不符合','danger'],insufficient:['材料不足','none']};
const list=items=>items?.length?`<ul>${items.map(v=>`<li>${e(v)}</li>`).join('')}</ul>`:'<p class="muted">未单独记录</p>';
const pill=(text,kind)=>`<span class="pill pill--${kind}">${e(text)}</span>`;
const evidenceBlock=b=>`<figure class="evidence"><figcaption>原文证据 · PDF 第 ${e(b.page)} 页<span>${e(b.id)}</span></figcaption><div class="evidence__body">${evidenceHtml(b)}</div></figure>`;

const styles=`
@page{size:A4;margin:24mm 16mm 20mm}
*{box-sizing:border-box}
:root{--brand:#c8643f;--brand-strong:#9c4a2c;--brand-soft:#fbf1ec;--ink:#1d2329;--text:#33393f;--muted:#6f767d;--line:#e6e1db;--line-soft:#f0ece7;--paper:#fbfaf8;
 --major:#b42318;--major-soft:#fdf0ef;--minor:#b25e09;--minor-soft:#fef6e7;--positive:#17734a;--positive-soft:#ebf7f0;--info:#2f5d8a;--info-soft:#edf3f9}
body{margin:0;color:var(--text);font-family:ReportCJK,"PingFang SC","Microsoft YaHei",sans-serif;font-size:10pt;line-height:1.7;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:178mm;margin:0 auto}
h1,h2,h3,h4{color:var(--ink);line-height:1.4;break-after:avoid;margin:0}
p{margin:0 0 6px;orphans:3;widows:3}
ul{margin:4px 0 0;padding-left:18px}li{margin:3px 0}
small,.muted{color:var(--muted);font-size:8.5pt}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:8.5pt;font-weight:700;line-height:1.7;white-space:nowrap}
.pill--success{background:var(--positive-soft);color:var(--positive)}.pill--warning{background:var(--minor-soft);color:var(--minor)}.pill--danger{background:var(--major-soft);color:var(--major)}.pill--info{background:var(--info-soft);color:var(--info)}.pill--none{background:var(--line-soft);color:var(--muted)}
.pill--major{background:var(--major);color:#fff}.pill--minor{background:var(--minor);color:#fff}.pill--positive{background:var(--positive);color:#fff}
.cover{border-top:5px solid var(--brand);padding-top:14px;margin-bottom:16px}
.cover__brand{display:flex;justify-content:space-between;align-items:baseline;font-size:8.5pt;color:var(--muted);letter-spacing:.5px}
.cover__brand strong{color:var(--brand-strong);letter-spacing:3px;font-size:9.5pt}
.cover h1{font-size:20pt;margin:12px 0 4px}
.cover__file{font-size:9pt;color:var(--muted)}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:14px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--paper)}
.meta div{padding:7px 12px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.meta div:nth-child(4n){border-right:0}.meta div:nth-last-child(-n+4){border-bottom:0}
.meta dt{font-size:8pt;color:var(--muted)}.meta dd{margin:1px 0 0;font-size:9.5pt;color:var(--ink);font-weight:700}
.summary{display:grid;grid-template-columns:62mm 1fr;gap:14px;margin:14px 0 8px;break-inside:avoid}
.score-card{border-radius:10px;background:var(--brand-soft);border:1px solid #f1d9cd;padding:16px 18px;display:flex;flex-direction:column;gap:8px}
.score-card__label{font-size:8.5pt;color:var(--brand-strong);font-weight:700;letter-spacing:1px}
.score-card__value{font-size:34pt;font-weight:700;line-height:1;color:var(--brand-strong)}.score-card__value small{font-size:11pt;color:var(--muted);font-weight:400;margin-left:4px}
.score-card__badges{display:flex;flex-wrap:wrap;gap:6px}
.grade{display:inline-block;padding:1px 9px;border-radius:6px;background:#fff;border:1px solid #efcdbd;color:var(--brand-strong);font-weight:700;font-size:9pt}
.bars{border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.bar{display:grid;grid-template-columns:30mm 1fr 14mm 11mm;align-items:center;gap:8px;padding:4px 0;font-size:9pt}
.bar + .bar{border-top:1px dashed var(--line-soft)}
.bar__track{height:7px;border-radius:4px;background:var(--line-soft);overflow:hidden}.bar__track i{display:block;height:100%;border-radius:4px;background:var(--brand)}
.bar__score{font-weight:700;color:var(--ink);text-align:right}.bar__weight{color:var(--muted);font-size:8pt;text-align:right}
.tone-e .bar__track i,.tone-d .bar__track i{background:var(--major)}.tone-c .bar__track i{background:var(--minor)}.tone-none .bar__track i{background:transparent}
.note{font-size:8.5pt;color:var(--muted);margin:6px 0 0}
section.chapter{margin-top:22px}
.chapter-title{display:flex;align-items:center;gap:10px;font-size:13.5pt;padding-bottom:6px;border-bottom:1.5px solid var(--ink);margin-bottom:12px}
.chapter-title b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--brand);color:#fff;font-size:10pt}
.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.check{border:1px solid var(--line);border-radius:8px;padding:10px 12px;break-inside:avoid;background:#fff}
.check--warning{border-color:#f0cf98;background:var(--minor-soft)}.check--danger{border-color:#f2b8b2;background:var(--major-soft)}
.check__head{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px}.check__head h3{font-size:10pt}
.check p{font-size:9pt;margin:0}
.check-evidence{margin-top:10px}
.verdict{border-left:4px solid var(--brand);background:var(--paper);padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px}
.verdict h3{font-size:10.5pt;margin-bottom:4px}
.two-col{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.panel{border:1px solid var(--line);border-radius:8px;padding:10px 14px}.panel h3{font-size:10pt;margin-bottom:2px}
.panel--good h3{color:var(--positive)}.panel--bad h3{color:var(--major)}
.dimension{margin-top:16px}
.dimension__head{display:flex;align-items:center;gap:10px;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px 12px;break-after:avoid}
.dimension__head h3{font-size:11.5pt;flex:1}.dimension__index{color:var(--brand);font-weight:700}
.dimension__score{font-size:15pt;font-weight:700;color:var(--ink)}.dimension__weight{font-size:8.5pt;color:var(--muted)}
.dimension__summary{margin:8px 2px 4px}
table{width:100%;border-collapse:collapse;font-size:9pt;line-height:1.55;margin:8px 0}
thead{display:table-header-group}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:var(--paper);color:var(--muted);font-weight:700;font-size:8.5pt;border-top:1px solid var(--line)}
tr{break-inside:avoid}
td.num{font-weight:700;color:var(--ink);white-space:nowrap}
.issue{margin:12px 0 0;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:0 8px 8px 0;padding:10px 14px}
.issue--major{border-left-color:var(--major)}.issue--minor{border-left-color:var(--minor)}.issue--positive{border-left-color:var(--positive)}
.issue__head{display:flex;align-items:flex-start;gap:8px;break-after:avoid}.issue__head h4{font-size:10.5pt;flex:1}
.issue__id{font-size:7.5pt;color:var(--muted);margin:2px 0 6px}
.suggestion{margin-top:8px;padding:8px 12px;background:var(--info-soft);border-radius:6px;break-inside:avoid}
.suggestion strong{display:block;color:var(--info);font-size:8.5pt;margin-bottom:2px}
.evidence{margin:8px 0 0;border:1px solid var(--line-soft);border-radius:6px;background:var(--paper);overflow:hidden}
.evidence figcaption{display:flex;justify-content:space-between;gap:8px;padding:4px 10px;font-size:8pt;font-weight:700;color:var(--brand-strong);background:#f6f2ee;border-bottom:1px solid var(--line-soft)}
.evidence figcaption span{font-weight:400;color:var(--muted)}
.evidence__body{padding:7px 10px;font-size:9pt;color:var(--text)}
.evidence__body p{margin:0 0 4px}.evidence__body p:last-child{margin:0}
.ev-table{font-size:7.5pt;margin:4px 0;background:#fff}.ev-table td,.ev-table th{border:1px solid var(--line);padding:3px 5px;text-align:center;vertical-align:middle}
.ev-table tr:first-child td{background:var(--line-soft);font-weight:700;color:var(--ink)}
.ev-figure{display:flex;align-items:flex-start;gap:8px}.ev-figure__tag{flex:none;padding:0 6px;border-radius:4px;background:var(--line-soft);color:var(--muted);font-size:8pt}
.ev-equation{text-align:center;padding:4px 0}
.katex{font-size:1.05em}.katex-display{margin:2px 0}
.plan td:first-child{width:7mm;color:var(--muted)}
.basis{font-size:8.5pt;color:var(--muted)}.basis dl{display:grid;grid-template-columns:28mm 1fr;gap:3px 10px;margin:0 0 8px}.basis dt{color:var(--ink);font-weight:700}.basis dd{margin:0}
@media screen{body{background:#eeebe7;padding:32px}main{background:#fff;max-width:900px;padding:40px 44px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.06)}}
`;

export function reportHtml(run,{fontData=null,fontBoldData=null}={}){
 const meta=run.metadata||{},policy=run.standard_snapshot,described=describeMetadata(meta);
 const blockMap=new Map((run.blocks||[]).map(b=>[b.id,b]));
 const pages=ids=>(ids||[]).map(id=>blockMap.has(id)?`第 ${blockMap.get(id).page} 页`:id).join('、')||'未定位';
 const evidence=new Map();for(const review of run.reviews)for(const issue of review.issues)for(const b of issue.evidence||[])evidence.set(b.id,b);
 for(const c of run.compliance||[])for(const b of c.evidence||[])evidence.set(b.id,b);
 const checks=run.compliance||[];let chapter=0;const heading=title=>`<h2 class="chapter-title"><b>${++chapter}</b>${e(title)}</h2>`;
 const metaItems=[['学位',described.degree||'未提供'],['学科门类',described.discipline||'未提供'],['专业',described.major||'未提供'],['完成年月',meta.completion_month||'未提供'],['评审时间',date(run.created_at)],['评审模型',run.model||'未记录'],['论文版本',`第 ${run.version_no||1} 版`],['PDF 页数',`${run.page_count??'—'} 页`]];
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(meta.title||run.filename)} · 文衡评审报告</title><style>
 ${fontData?`@font-face{font-family:ReportCJK;src:url(data:font/ttf;base64,${fontData}) format('truetype');font-weight:400;}`:''}
 ${fontBoldData?`@font-face{font-family:ReportCJK;src:url(data:font/ttf;base64,${fontBoldData}) format('truetype');font-weight:700;}`:''}
 ${hasMath([...evidence.values()])?katexCss():''}
 ${styles}
 </style></head><body><main>
 <header class="cover">
  <div class="cover__brand"><strong>文衡 · 学位论文评审报告</strong><span>报告编号 ${e(run.id)}</span></div>
  <h1>${e(meta.title||run.filename)}</h1><div class="cover__file">${e(run.filename)}</div>
  <dl class="meta">${metaItems.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
 </header>

 <div class="summary">
  <div class="score-card"><div class="score-card__label">评分总览</div>
   <div class="score-card__value">${number(run.total_score)}${run.total_score!=null?'<small>/ 100</small>':''}</div>
   <div class="score-card__badges">${run.grade?`<span class="grade">${e(run.grade)}</span>`:''}${run.recommendation?pill(run.recommendation,recommendationTone(run.recommendation)):''}</div>
   ${checks.length?`<div class="score-card__badges">${checks.filter(c=>c.status!=='pass').length?pill(`专项审查 ${checks.filter(c=>c.status!=='pass').length} 项需关注`,checks.some(c=>c.status==='fail')?'danger':'warning'):pill('专项审查通过','success')}</div>`:''}
  </div>
  <div class="bars">${run.reviews.map(r=>`<div class="bar tone-${tone(r.score)}"><span>${e(r.dimension)}</span><div class="bar__track"><i style="width:${r.score==null?0:Math.max(0,Math.min(100,r.score))}%"></i></div><span class="bar__score">${number(r.score)}</span><span class="bar__weight">${r.weight==null?'—':e(r.weight)+'%'}</span></div>`).join('')}</div>
 </div>
 <p class="note">总分为六维度加权得分；等级反映分数区间，综合建议同时考虑关键维度低分、重大问题、材料不足与专项审查结论，可能比等级更审慎。本报告采用平台辅助评审标准，不代表学校或国家统一标准，也不替代正式学位评审决定；未进行外部文献核验或查重。</p>

 ${checks.length?`<section class="chapter">${heading('专项审查')}
  <div class="checks">${checks.map(c=>{const [label,kind]=checkStatus[c.status]||[c.status,'none'];return `<div class="check check--${kind}"><div class="check__head"><h3>${e(c.name)}</h3>${pill(label,kind)}</div><p>${e(c.finding)}</p>${c.evidence?.length?`<small>证据：${e(c.evidence.map(b=>'第 '+b.page+' 页').join('、'))}</small>`:''}</div>`;}).join('')}</div>
  ${checks.filter(c=>c.status!=='pass'&&c.evidence?.length).map(c=>`<div class="check-evidence"><h4>${e(c.name)} · 相关原文</h4>${c.evidence.map(evidenceBlock).join('')}</div>`).join('')}
 </section>`:''}

 <section class="chapter">${heading('总体评议')}
  <div class="verdict"><h3>综合建议：${e(run.recommendation||'未提供')}</h3><p>${e(run.recommendation_reason||'本次记录没有综合建议说明。')}</p></div>
  <p>${e(run.overall_summary||'历史记录没有单独的总体评议，以下保留原始六维度评价。')}</p>
  <div class="two-col"><div class="panel panel--good"><h3>主要贡献与优点</h3>${list(run.strengths)}</div><div class="panel panel--bad"><h3>核心不足与评价边界</h3>${list(run.limitations)}</div></div>
 </section>

 <section class="chapter">${heading('六维度详细评审')}
 ${run.reviews.map((r,i)=>`<div class="dimension">
  <div class="dimension__head"><span class="dimension__index">${String(i+1).padStart(2,'0')}</span><h3>${e(r.dimension)}</h3><span class="dimension__weight">权重 ${r.weight==null?'—':e(r.weight)+'%'}${r.assessment_status==='insufficient'?' · 材料不足':''}</span><span class="dimension__score">${number(r.score)}</span></div>
  <p class="dimension__summary">${e(r.summary)}</p>
  ${r.criteria?.length?`<table><thead><tr><th style="width:24%">评分分项</th><th style="width:10%">得分</th><th>评价依据</th></tr></thead><tbody>${r.criteria.map(c=>`<tr><td>${e(policy?.rubric?.[i]?.criteria.find(x=>x.code===c.code)?.name||c.code)}</td><td class="num">${number(c.score)}</td><td>${e(c.reason)}<br><small>证据：${e(pages(c.evidence_ids))}</small></td></tr>`).join('')}</tbody></table>`:''}
  ${r.issues.length?r.issues.map(issue=>{const [label,kind]=severity[issue.severity]||[issue.severity,'none'];return `<article class="issue issue--${kind}" id="${e(issue.id)}">
   <div class="issue__head">${pill(label,kind)}<h4>${e(issue.title)}</h4></div><div class="issue__id">意见编号 ${e(issue.id)}</div>
   <p>${e(issue.detail)}</p>
   ${issue.evidence?.length?issue.evidence.map(evidenceBlock).join(''):'<p class="muted">未定位到原文证据，需要结合全文人工核验。</p>'}
   ${issue.severity!=='positive'||issue.suggestion?`<div class="suggestion"><strong>修改建议</strong>${e(issue.suggestion)}</div>`:''}
  </article>`;}).join(''):'<p class="muted">该维度未记录具体意见。</p>'}
 </div>`).join('')}
 </section>

 <section class="chapter">${heading('修改清单')}
  ${run.revision_plan?.length?`<table class="plan"><thead><tr><th>#</th><th style="width:26%">修改事项</th><th style="width:12%">优先级</th><th>具体行动</th><th style="width:18%">关联意见</th></tr></thead><tbody>${run.revision_plan.map((p,i)=>{const [label,kind]=priority[p.priority]||[p.priority,'none'];return `<tr><td>${i+1}</td><td><strong>${e(p.title)}</strong></td><td>${pill(label,kind)}</td><td>${e(p.action)}</td><td><small>${e(p.issue_ids.join('、'))}</small></td></tr>`;}).join('')}</tbody></table>`:'<p class="muted">本次未记录独立修改清单；请参照上文各维度意见。</p>'}
 </section>

 <section class="chapter">${heading('评审依据与追溯信息')}
  <div class="basis"><dl>
   <dt>评审标准</dt><dd>${e(policy?.name||'历史记录未保存系统标准')}</dd>
   <dt>评审模型</dt><dd>${e(run.model||'未记录')}</dd>
   <dt>提示词模板</dt><dd>${e(run.prompt_template_version)}</dd>
   <dt>维度提示词版本</dt><dd>${e((run.snapshots||[]).map((s,i)=>`${run.reviews[i]?.dimension||i+1} v${s.version}`).join('；')||'未记录')}</dd>
   <dt>报告模板</dt><dd>${reportTemplateVersion}</dd>
   <dt>原文件</dt><dd>${e(run.filename)}（${e(run.page_count)} 页，引用原文证据 ${evidence.size} 处）</dd>
   ${policy?`<dt>学位要求</dt><dd>${e(policy.degree_profiles[meta.degree_type]?.requirement)}</dd><dt>学科要求</dt><dd>${e(policy.discipline_profiles[meta.discipline]?.requirement)}</dd><dt>评分锚点</dt><dd>${e(policy.scoring_rules.anchors)}</dd>`:''}
  </dl><p>证据页码统一指 PDF 文件页序，不一定等于论文印刷页码。模型意见需要结合原文核验；解析未覆盖的内容与论文自身缺陷分别处理。历史记录缺失的元数据和评分不做追溯补造。</p></div>
 </section>
 </main></body></html>`;
}

let fontPromise;
export async function generatePdf(run,target){
 fontPromise??=Promise.all(['Regular','Bold'].map(weight=>fs.readFile(fileURLToPath(new URL(`../assets/fonts/NotoSansSC-${weight}.ttf`,import.meta.url))).then(b=>b.toString('base64'))));
 const [fontData,fontBoldData]=await fontPromise;const html=reportHtml(run,{fontData,fontBoldData});
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({javaScriptEnabled:false});await context.route('**/*',route=>route.abort());
  const page=await context.newPage();page.setDefaultTimeout(60000);await page.setContent(html,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
  await fs.mkdir(path.dirname(target),{recursive:true});const temporary=target+'.tmp';
  await page.pdf({path:temporary,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:`<style>@font-face{font-family:ReportHeader;src:url(data:font/ttf;base64,${fontData}) format('truetype');font-weight:400}</style><div style="font-family:ReportHeader;font-size:7.5px;width:100%;margin:0 16mm;padding-bottom:4px;border-bottom:0.5px solid #e6e1db;color:#8a8f94;display:flex;justify-content:space-between"><span style="color:#9c4a2c;letter-spacing:1px">文衡 · 学位论文评审报告</span><span>${e((run.metadata?.title||run.filename).slice(0,48))}</span></div>`,footerTemplate:`<style>@font-face{font-family:ReportFooter;src:url(data:font/ttf;base64,${fontData}) format('truetype');font-weight:400}</style><div style="font-family:ReportFooter;font-size:7.5px;width:100%;margin:0 16mm;color:#8a8f94;display:flex;justify-content:space-between"><span>平台辅助评审，不代表学校正式意见</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`});
  await fs.rename(temporary,target);const bytes=await fs.readFile(target);return {path:target,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),generated_at:new Date().toISOString()};
 }finally{await browser.close();}
}
export function createReportService(repo,dataDir,{generate=generatePdf}={}){
 const pending=new Map();let queue=Promise.resolve();
 // One report at a time; repeated requests for the same run share one job, and a ready file is reused.
 function request(runId){
  if(pending.has(runId))return pending.get(runId);
  // `started` settles once the job is recorded as pending (or found ready), before generation finishes.
  let markStarted;const started=new Promise(resolve=>{markStarted=resolve;});
  const job=(async()=>{
   let run;
   try{
    run=await repo.run(runId);if(!run)throw Object.assign(Error('评审记录不存在'),{status:404});
    const existing=await repo.report(runId);
    if(existing?.status==='ready'&&existing.template_version===reportTemplateVersion&&existsSync(existing.storage_path))return existing;
    await repo.setReport(runId,reportTemplateVersion,'pending');
   }finally{markStarted();}
   const work=queue.catch(()=>{}).then(async()=>{
    await repo.setReport(runId,reportTemplateVersion,'generating');
    try{const info=await generate(run,path.join(dataDir,'reports',runId,reportTemplateVersion+'.pdf'));return await repo.setReport(runId,reportTemplateVersion,'ready',info);}
    catch(error){return repo.setReport(runId,reportTemplateVersion,'failed',{error:safeError(error)});}
   });queue=work;return work;
  })().finally(()=>pending.delete(runId));
  job.started=started;pending.set(runId,job);return job;
 }
 return {request,idle:async()=>{while(pending.size)await Promise.allSettled([...pending.values()]);await queue;}};
}
