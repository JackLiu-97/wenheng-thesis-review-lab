import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const httpError=(label,status)=>Object.assign(Error(`${label}：HTTP ${status}`),{httpStatus:status});
async function fetchChecked(url,options,label){const response=await fetch(url,{...options,signal:AbortSignal.timeout(120000)});if(!response.ok)throw httpError(label,response.status);return response;}
const toText=value=>typeof value==='string'?value:Array.isArray(value)?value.map(toText).filter(Boolean).join('\n'):'';

// MinerU v1 content-list fields: https://opendatalab.github.io/MinerU/reference/output_files/
export function normalizeMineruBlocks(raw){
 if(!Array.isArray(raw)||raw.some(x=>!x||Array.isArray(x)||typeof x!=='object'))throw Error('MinerU content_list 结构不是受支持的扁平文本块数组');
 return raw.map((x,i)=>{
  const text=[toText(x.text||x.content||x.html||x.table_body),toText(x.image_caption),toText(x.table_caption),toText(x.table_footnote),toText(x.chart_caption)].filter(Boolean).join('\n');
  const page=Number(x.page_idx??x.page_number??0)+1;
  if(!Number.isInteger(page)||page<1)throw Error('MinerU 返回了无效页码');
  const rawBox=x.bbox||x.box;
  const bbox=Array.isArray(rawBox)&&rawBox.length===4&&rawBox.every(Number.isFinite)&&rawBox[2]>=rawBox[0]&&rawBox[3]>=rawBox[1]?rawBox:null;
  return {id:`b${i+1}`,type:x.type||'text',text,page,bbox};
 }).filter(b=>b.text.trim());
}

export async function parseMineru(pdfPath,target,onProgress=()=>{}){
 const token=process.env.MINERU_TOKEN;if(!token)throw Error('MINERU_TOKEN 未配置');
 const base=(process.env.MINERU_API_BASE||'https://mineru.net/api/v4').replace(/\/$/,'');
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
 onProgress({message:'正在申请解析服务上传地址',fraction:0.02});
 const response=await fetchChecked(`${base}/file-urls/batch`,{method:'POST',headers,body:JSON.stringify({files:[{name:path.basename(pdfPath),data_id:path.basename(pdfPath,path.extname(pdfPath))}],model_version:process.env.MINERU_MODEL_VERSION||'vlm'})},'MinerU 申请上传地址失败');
 const payload=await response.json(),data=payload.data||{};
 if(!data.batch_id||!data.file_urls?.[0])throw Error('MinerU 返回缺少 batch_id 或 upload URL');
 onProgress({message:'正在上传论文 PDF 到解析服务',fraction:0.06});
 await fetchChecked(data.file_urls[0],{method:'PUT',body:fs.createReadStream(pdfPath),duplex:'half'},'MinerU 上传 PDF 失败');
 let result;const deadline=Date.now()+10*60*1000;
 while(Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const poll=await fetchChecked(`${base}/extract-results/batch/${data.batch_id}`,{headers:{Authorization:`Bearer ${token}`}},'MinerU 查询失败');
  result=((await poll.json()).data?.extract_result||[])[0];
  if(result?.state==='done')break;
  // MinerU states: waiting-file / pending / running (extract_progress) / converting.
  const pages=result?.extract_progress||{},done=Number(pages.extracted_pages),total=Number(pages.total_pages);
  if(result?.state==='running'&&total>0)onProgress({message:`MinerU 正在解析：已完成 ${Math.min(done||0,total)} / ${total} 页`,fraction:0.15+0.7*Math.min(1,(done||0)/total),pages:{done:Math.min(done||0,total),total}});
  else if(result?.state==='running')onProgress({message:'MinerU 正在解析论文',fraction:0.2});
  else if(result?.state==='converting')onProgress({message:'MinerU 正在转换解析结果',fraction:0.86});
  else onProgress({message:'论文已上传，等待解析服务排队',fraction:0.1});
  if(result?.state==='failed')throw Error(`MinerU 解析失败：${result.err_msg||'unknown'}`);
 }
 if(result?.state!=='done'||!result.full_zip_url)throw Object.assign(Error('MinerU 解析超时'),{name:'TimeoutError'});
 onProgress({message:'正在下载解析结果',fraction:0.9});
 const archive=await fetchChecked(result.full_zip_url,{},'MinerU 结果下载失败');
 const zipPath=path.join(target,'mineru.zip');await fsp.writeFile(zipPath,Buffer.from(await archive.arrayBuffer()));
 const unpack=path.join(target,'mineru');await fsp.mkdir(unpack,{recursive:true});
 onProgress({message:'正在整理文本块与页码坐标',fraction:0.95});
 await exec('unzip',['-o','-q',zipPath,'-d',unpack],{timeout:120000});
 let contentList=null,markdown=null,layoutFile=null;
 async function walk(dir){for(const entry of await fsp.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('_content_list.json')||entry.name==='content_list.json')contentList??=file;else if(entry.name==='layout.json'||entry.name.endsWith('_middle.json'))layoutFile??=file;else if(entry.name.endsWith('.md'))markdown??=file;}}
 await walk(unpack);
 if(!contentList)throw Error('MinerU 未返回可定位的 content_list.json，不能把无页码 Markdown 冒充原文证据');
 const blocks=normalizeMineruBlocks(JSON.parse(await fsp.readFile(contentList,'utf8')));
 let pageSizes=[];
 if(layoutFile){const layout=JSON.parse(await fsp.readFile(layoutFile,'utf8'));pageSizes=(layout.pdf_info||[]).map(x=>Array.isArray(x.page_size)&&x.page_size.length===2&&x.page_size.every(n=>Number.isFinite(n)&&n>0)?x.page_size:[595,841]);}
 await fsp.writeFile(path.join(target,'blocks.json'),JSON.stringify(blocks,null,2));return {markdown,blocks,pageSizes,coordinateSize:[1000,1000]};
}
