// 把 MinerU 解析出的原文证据转成可读 HTML：表格按白名单重建，LaTeX 公式交给 KaTeX，
// 只保留 <sup>/<sub>，其余标签一律转义，避免把 Markdown／HTML 源码原样打进报告。
import fs from 'node:fs';
import {createRequire} from 'node:module';
import katex from 'katex';

const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'"};
const decode=v=>String(v??'').replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#\d+|#x[\da-f]+);/gi,(m,k)=>{k=k.toLowerCase();if(entities[k]!=null)return entities[k];const code=k.startsWith('#x')?parseInt(k.slice(2),16):k.startsWith('#')?Number(k.slice(1)):NaN;return Number.isFinite(code)&&code>0&&code<0x110000?String.fromCodePoint(code):m;});

// MinerU spaces tokens out (\mathrm { m A P 5 0 }); math mode ignores those spaces.
function math(tex,display){
 try{return katex.renderToString(tex.trim(),{displayMode:display,throwOnError:false,strict:'ignore',trust:false,output:'html',errorColor:'#5c6b73'});}
 catch{return `<code class="ev-tex">${escape(tex)}</code>`;}
}
const token=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|<(\/?)(sup|sub)\s*>/gi;
// Escapes text, renders formulas and keeps balanced <sup>/<sub>.
export function inlineHtml(text){
 const source=decode(text);let out='',last=0;const open=[];
 for(const m of source.matchAll(token)){
  out+=escape(source.slice(last,m.index));last=m.index+m[0].length;
  if(m[6]){const tag=m[6].toLowerCase();if(!m[5]){open.push(tag);out+=`<${tag}>`;}else if(open.at(-1)===tag){open.pop();out+=`</${tag}>`;}}
  else if(m[1]!=null||m[2]!=null)out+=math(m[1]??m[2],true);
  else out+=math(m[3]??m[4],false);
 }
 out+=escape(source.slice(last));
 while(open.length)out+=`</${open.pop()}>`;
 return out;
}
const stripTags=html=>String(html).replace(/<(?!\/?(sup|sub)\s*>)[^>]*>/gi,'');
// Rebuilds a MinerU HTML table from rows and cells only; rowspan/colspan are kept as numbers.
export function tableHtml(html){
 const rows=[...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];if(!rows.length)return null;
 const span=(attrs,name)=>{const m=attrs.match(new RegExp(name+'\\s*=\\s*["\']?(\\d{1,3})','i'));return m&&Number(m[1])>1?` ${name}="${Number(m[1])}"`:'';};
 return `<table class="ev-table"><tbody>${rows.map(r=>`<tr>${[...r[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(c=>{const tag=c[1].toLowerCase();return `<${tag}${span(c[2],'rowspan')}${span(c[2],'colspan')}>${inlineHtml(stripTags(c[3]))}</${tag}>`;}).join('')}</tr>`).join('')}</tbody></table>`;
}
const paragraphs=text=>String(text??'').split(/\n+/).map(v=>v.trim()).filter(Boolean).map(v=>`<p>${inlineHtml(stripTags(v))}</p>`).join('');
export function evidenceHtml(block){
 const text=String(block?.text??'');
 if(/<table\b/i.test(text)){
  // Captions or notes may surround the table.
  const start=text.search(/<table\b/i),end=text.search(/<\/table>/i),table=end>start?text.slice(start,end+8):text.slice(start);
  return paragraphs(text.slice(0,start))+(tableHtml(table)||paragraphs(table))+(end>start?paragraphs(text.slice(end+8)):'');
 }
 if(block?.type==='equation'||/^\s*\$\$[\s\S]*\$\$\s*$/.test(text)){
  const tex=text.trim().replace(/^\$\$|\$\$$/g,'').replace(/^\\\[|\\\]$/g,'');return `<div class="ev-equation">${math(tex,true)}</div>`;
 }
 if(['image','chart'].includes(block?.type))return `<div class="ev-figure"><span class="ev-figure__tag">${block.type==='chart'?'图表':'图'}</span>${paragraphs(text)||'<p>（图片无文字说明）</p>'}</div>`;
 return paragraphs(text)||'<p class="muted">（证据块无文字内容）</p>';
}
export const hasMath=blocks=>blocks.some(b=>b?.type==='equation'||/\$[^$]+\$|\\\(|\\\[/.test(String(b?.text??'')));

// KaTeX stylesheet with its woff2 fonts inlined, so the offline PDF renderer needs no network.
let katexCssCache=null;
export function katexCss(){
 if(katexCssCache)return katexCssCache;
 const require=createRequire(import.meta.url),cssPath=require.resolve('katex/dist/katex.min.css'),fonts=cssPath.replace(/katex\.min\.css$/,'fonts/');
 katexCssCache=fs.readFileSync(cssPath,'utf8').replace(/url\(fonts\/([\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\([^)]+\)\s*format\("[^"]+"\))*/g,(_,name)=>`url(data:font/woff2;base64,${fs.readFileSync(fonts+name+'.woff2').toString('base64')}) format("woff2")`);
 return katexCssCache;
}
