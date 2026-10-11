import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {describeMetadata} from './standards.mjs';
import {safeError} from './models.mjs';
export const reportTemplateVersion='report-v2.6';
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const number=v=>v==null?'未评分':Number(v).toFixed(1);
const list=items=>items?.length?`<ul>${items.map(v=>`<li>${e(v)}</li>`).join('')}</ul>`:'<p class="muted">未单独记录</p>';
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
export function reportHtml(run,{fontData=null,fontBoldData=null}={}){
 const meta=run.metadata||{},policy=run.standard_snapshot,described=describeMetadata(meta);
 const blockMap=new Map((run.blocks||[]).map(b=>[b.id,b]));
 const evidenceLabel=ids=>(ids||[]).map(id=>blockMap.has(id)?`${id}（PDF 第 ${blockMap.get(id).page} 页）`:id).join('、')||'未定位';
 const evidence=new Map();for(const review of run.reviews)for(const issue of review.issues)for(const b of issue.evidence||[])evidence.set(b.id,b);
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(meta.title||run.filename)} · 文衡评审报告</title><style>
 ${fontData?`@font-face{font-family:ReportCJK;src:url(data:font/ttf;base64,${fontData}) format('truetype');font-weight:400;}`:''}
 ${fontBoldData?`@font-face{font-family:ReportCJK;src:url(data:font/ttf;base64,${fontBoldData}) format('truetype');font-weight:700;}`:''}
 @page{size:A4;margin:20mm 18mm 20mm}*{box-sizing:border-box}body{margin:0;color:#202a33;font-family:ReportCJK,"Microsoft YaHei",sans-serif;font-size:10.5pt;line-height:1.6;overflow-wrap:anywhere}main{max-width:180mm;margin:auto}h1{font-size:22pt;line-height:1.4;margin:10px 0 20px;color:#243c50}h2{font-size:15pt;margin:22px 0 10px;color:#243c50;border-bottom:1px solid #c5d2d9;padding-bottom:7px}h3{font-size:12pt;margin:16px 0 8px}h4{font-size:10.5pt;margin:10px 0 4px}h1,h2,h3,h4{break-after:avoid}p{margin:6px 0 8px;white-space:pre-wrap;orphans:3;widows:3}.kicker{font-size:10pt;letter-spacing:2px;color:#7d5141}.meta{border-top:3px solid #9b6751;padding:12px 0}.muted,small{color:#63727b;font-size:9pt}.score{font-size:28pt;font-weight:bold;color:#9b5139}.verdict{background:#f1f5f6;border-left:4px solid #526d7b;padding:12px 16px;break-inside:avoid}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:9pt;line-height:1.5}thead{display:table-header-group}th,td{border:1px solid #d6dfe3;padding:6px 8px;text-align:left;vertical-align:top}th{background:#edf2f4}tr{break-inside:avoid}.issue{border-left:2px solid #d6dfe3;padding-left:12px;margin:12px 0}.issue>small{display:block;break-after:avoid}.badge{font-size:9pt;color:#85513d}.quote{break-inside:avoid;background:#f5f6f7;border-left:2px solid #bccbd3;padding:6px 10px;font-size:9pt}.basis{font-size:9pt;break-inside:avoid}.rule-note{font-size:9pt;color:#53626a}li{margin:4px 0}a{color:#33596f;text-decoration:none}.compact{break-inside:avoid}@media screen{body{background:#eef1f3;padding:32px}main{background:white;max-width:900px;padding:36px}}
 </style></head><body><main>
 <div class="kicker">文衡 · 学位论文评审报告</div><h1>${e(meta.title||run.filename)}</h1>
 <div class="meta"><p>学位：${e(described.degree||'历史记录未提供')}　学科：${e(described.discipline||'历史记录未提供')}<br>专业：${e(described.major||'历史记录未提供')}${meta.research_direction?`　研究方向：${e(meta.research_direction)}`:''}<br>完成／提交年月：${e(meta.completion_month||'历史记录未提供')}　评审时间：${e(date(run.created_at))}<br>报告编号：${e(run.id)}　论文版本：${e(run.version_no||1)}</p></div>
 <p class="rule-note">本报告采用平台辅助评审标准，不代表学校或国家统一标准，也不替代学校正式学位评审决定。评价基于本次可解析论文材料，未进行外部文献真实性核验或查重。</p>
 <h2>一、评分总览</h2><div class="verdict"><div><span class="score">${number(run.total_score)}</span>${run.total_score!=null?' / 100':''}　${e(run.grade||'历史记录未评分')}</div><strong>综合建议：${e(run.recommendation||'历史记录未提供')}</strong><p>${e(run.recommendation_reason||'本次记录没有综合建议解释。')}</p></div>
 <table><thead><tr><th>评审维度</th><th>得分</th><th>权重</th><th>评价状态</th></tr></thead><tbody>${run.reviews.map(r=>`<tr><td>${e(r.dimension)}</td><td>${number(r.score)}</td><td>${r.weight==null?'未记录':e(r.weight)+'%'}</td><td>${r.assessment_status==='insufficient'?'材料不足':r.score==null?'历史未评分':'已评价'}</td></tr>`).join('')}</tbody></table>
 <p class="rule-note">总分为六维度加权得分。等级反映分数区间；综合建议同时考虑关键维度低分、重大问题与材料不足，因而可能比总分等级更审慎。材料不足不计为零分，也不重新分配权重。</p>
 <h2>二、总体评议</h2><p>${e(run.overall_summary||'历史记录没有单独的总体评议，以下保留原始六维度评价。')}</p><h3>主要贡献与优点</h3>${list(run.strengths)}<h3>核心不足与评价边界</h3>${list(run.limitations)}
 <h2>三、六维度详细评审</h2>${run.reviews.map((r,i)=>`<section><h3>${i+1}. ${e(r.dimension)} · ${number(r.score)}</h3><p>${e(r.summary)}</p>${r.criteria?.length?`<table><thead><tr><th style="width:22%">分项</th><th style="width:12%">得分</th><th>评价依据</th></tr></thead><tbody>${r.criteria.map(c=>`<tr><td>${e(policy?.rubric?.[i]?.criteria.find(x=>x.code===c.code)?.name||c.code)}</td><td>${number(c.score)}</td><td>${e(c.reason)}<br><small>证据：${e(evidenceLabel(c.evidence_ids))}</small></td></tr>`).join('')}</tbody></table>`:''}${r.issues.length?r.issues.map(issue=>`<article class="issue" id="${e(issue.id)}"><h4><span class="badge">${({major:'重大问题',minor:'修改建议',positive:'值得肯定'})[issue.severity]}</span>　${e(issue.title)}</h4><small>意见编号：${e(issue.id)}</small><p>${e(issue.detail)}</p>${issue.evidence?.length?issue.evidence.map(b=>`<div class="quote"><strong>证据 ${e(b.id)} · PDF 第 ${e(b.page)} 页</strong><p>${e(b.text)}</p></div>`).join(''):'<p class="muted">未定位原文证据；需结合全文人工核验。</p>'}<h4>修改建议</h4><p>${e(issue.suggestion)}</p></article>`).join(''):'<p class="muted">该维度未记录具体意见。</p>'}</section>`).join('')}
 <h2>四、按优先级整理的修改清单</h2>${run.revision_plan?.length?run.revision_plan.map((p,i)=>`<article><h3>${i+1}. ${e(p.title)} <span class="badge">${({high:'优先处理',medium:'随后处理',low:'最后完善'})[p.priority]||e(p.priority)}</span></h3><p>${e(p.action)}</p><small>关联意见：${e(p.issue_ids.join('、'))}</small></article>`).join(''):'<p>本次未记录独立修改清单；请参照上文原始意见。</p>'}
 <h2>五、评审依据与追溯信息</h2><div class="basis"><p>标准：${e(policy?.name||'历史记录未保存系统标准')}<br>模型：${e(run.model||'未记录')}<br>提示词模板：${e(run.prompt_template_version)}<br>补充重点版本：${e((run.snapshots||[]).map((s,i)=>`${i+1}: v${s.version}`).join('；'))}<br>报告模板：${reportTemplateVersion}<br>原文件：${e(run.filename)}<br>PDF 页数：${e(run.page_count)}；关联原文证据块：${e(evidence.size)}。</p>${policy?`<p>学位要求：${e(policy.degree_profiles[meta.degree_type]?.requirement)}<br>学科要求：${e(policy.discipline_profiles[meta.discipline]?.requirement)}<br>评分锚点：${e(policy.scoring_rules.anchors)}</p>`:''}<p>证据页码统一指 PDF 文件页序，不一定等于论文印刷页码。模型意见需要结合原文核验；解析未覆盖内容与论文自身缺陷分别处理。历史记录缺失的元数据和评分不做追溯补造。</p></div>
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
  await page.pdf({path:temporary,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:`<style>@font-face{font-family:ReportHeader;src:url(data:font/ttf;base64,${fontData}) format('truetype');font-weight:400}</style><div style="font-family:ReportHeader;font-size:8px;width:100%;padding:0 18mm;color:#64727b">${e((run.metadata?.title||run.filename).slice(0,65))}</div>`,footerTemplate:`<div style="font-size:8px;width:100%;padding:0 18mm;color:#64727b;display:flex;justify-content:space-between"><span>${e(run.id)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`});
  await fs.rename(temporary,target);const bytes=await fs.readFile(target);return {path:target,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),generated_at:new Date().toISOString()};
 }finally{await browser.close();}
}
export function createReportService(repo,dataDir,{generate=generatePdf}={}){
 const pending=new Map();let queue=Promise.resolve();
 function request(runId){
  if(pending.has(runId))return pending.get(runId);
  const run=repo.run(runId);if(!run)throw Object.assign(Error('评审记录不存在'),{status:404});
  const existing=repo.report(runId);
  if(existing?.status==='ready'&&existing.template_version===reportTemplateVersion&&existsSync(existing.storage_path))return Promise.resolve(existing);
  repo.setReport(runId,reportTemplateVersion,'pending');
  const work=queue.catch(()=>{}).then(async()=>{
   repo.setReport(runId,reportTemplateVersion,'generating');
   try{const info=await generate(run,path.join(dataDir,'reports',runId,reportTemplateVersion+'.pdf'));return repo.setReport(runId,reportTemplateVersion,'ready',info);}
   catch(error){return repo.setReport(runId,reportTemplateVersion,'failed',{error:safeError(error)});}
   finally{pending.delete(runId);}
  });pending.set(runId,work);queue=work;return work;
 }
 return {request,idle:()=>queue};
}
