'use strict';
// Metadata form controls: degree level / degree type segmented choices, 学科门类 → 专业 cascade
// with a searchable picker, and a month picker. Every control keeps its value in an element
// carrying data-meta so readMetadata() and the change listeners keep working unchanged.

const levelOrder=['bachelor','master','doctor'];
const categoryOrder=['academic','professional'];
const degreeAbbr={academic_bachelor:'学术学士',professional_bachelor:'专业学士',academic_master:'学硕',professional_master:'专硕',academic_doctor:'学博',professional_doctor:'专博'};
// Legacy records only stored the platform discipline profile; map the unambiguous ones back to a 门类.
const legacyCategory={science:'07',engineering:'08',agriculture:'09',medicine:'10',education:'04',arts:'13'};
const catalog=()=>reviewSettings.catalog;
const categoryInfo=code=>catalog().categories.find(c=>c.code===code);
function treeFor(level,category){return level&&category?catalog().tree[`${category}_${level}`]||{}:null;}
function majorsFor(level,category,code){const tree=treeFor(level,category);if(!tree)return [];const codes=code?[code]:Object.keys(tree);return codes.flatMap(c=>(tree[c]||[]).flatMap(g=>g.majors.map(m=>({...m,group:g.label,groupCode:g.code,category:c}))));}
const majorDisplay=m=>m.code?`${m.code} ${m.name}`:m.name;

// Fill the new fields for metadata saved before the degree split.
function normalizeMetadataValues(values={}){
 const v={...values},profile=reviewSettings.degrees[v.degree_type];
 if(profile){v.degree_level||=profile.level;v.degree_category||=profile.category;}
 if(!v.discipline_category&&legacyCategory[v.discipline])v.discipline_category=legacyCategory[v.discipline];
 return v;
}

function segmentedControl(prefix,key,options,value,override){
 const items=(override?[['','继承']]:[]).concat(options);
 return `<div class="segmented" role="radiogroup" id="${prefix}-${key}-group" data-seg="${key}">${items.map(([v,label,sub])=>`<label class="segmented__item${v===''?' segmented__item--inherit':''}"><input type="radio" name="${prefix}-${key}" value="${v}" data-meta="${key}" ${String(value||'')===v?'checked':''}><span>${esc(label)}${sub?`<small data-sub="${v}">${esc(sub)}</small>`:''}</span></label>`).join('')}</div>`;
}
function categorySubLabel(level,category){return level?degreeAbbr[`${category}_${level}`]:'';}
function categorySelectOptions(level,category,value,override){
 const tree=treeFor(level,category),list=tree?catalog().categories.filter(c=>tree[c.code]):catalog().categories;
 return `<option value="">${override?'继承公共参数':'请选择学科门类'}</option>`+list.map(c=>`<option value="${c.code}" ${value===c.code?'selected':''}>${c.code} ${esc(c.name)}</option>`).join('');
}
function majorPicker(prefix,values,override){
 const custom=values.major&&!majorsFor(values.degree_level,values.degree_category,values.discipline_category).some(m=>m.name===values.major);
 const display=values.major?(values.major_code?`${values.major_code} ${values.major}`:values.major):'';
 return `<div class="combo" data-combo>
  <input type="text" class="combo__input" id="${prefix}-major-input" value="${esc(display)}" placeholder="${override?'留空继承公共参数':'输入关键词搜索，或从列表选择'}" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${prefix}-major-list" maxlength="120">
  <svg class="icon combo__icon" aria-hidden="true"><use href="#i-search"/></svg>
  <input type="hidden" id="${prefix}-major" data-meta="major" value="${esc(values.major||'')}" ${custom?'data-custom="1"':''}>
  <div class="combo__list" id="${prefix}-major-list" role="listbox" hidden></div>
 </div>`;
}
function monthPicker(prefix,value,override){
 return `<div class="month-picker" data-month-picker>
  <button type="button" class="month-picker__trigger" id="${prefix}-completion_month-trigger" aria-haspopup="dialog" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg><span class="month-picker__value${value?'':' is-empty'}">${value?esc(formatMonth(value)):override?'继承公共参数':'选择年月'}</span><svg class="icon month-picker__chevron" aria-hidden="true"><use href="#i-chevron"/></svg></button>
  <input type="hidden" id="${prefix}-completion_month" data-meta="completion_month" value="${esc(value||'')}">
  <div class="month-picker__pop" role="dialog" aria-label="选择完成年月" hidden></div>
 </div>`;
}
function metadataForm(prefix,rawValues={},override=false){
 const values=override?rawValues:normalizeMetadataValues(rawValues),star=override?'':' <span class="required">*</span>';
 const levels=levelOrder.map(k=>[k,catalog().levels[k].label,k==='bachelor'?'本科':'']);
 const categories=categoryOrder.map(k=>[k,catalog().degree_categories[k].label,categorySubLabel(values.degree_level,k)]);
 return `<div class="field" data-field="degree_level"><span>学位${star}</span>${segmentedControl(prefix,'degree_level',levels,values.degree_level,override)}</div>
 <div class="field" data-field="degree_category"><span>学位类型${star}</span>${segmentedControl(prefix,'degree_category',categories,values.degree_category,override)}</div>
 <label class="field" for="${prefix}-discipline_category"><span>学科门类${star}</span><select id="${prefix}-discipline_category" data-meta="discipline_category">${categorySelectOptions(values.degree_level,values.degree_category,values.discipline_category,override)}</select></label>
 <label class="field" for="${prefix}-major-input"><span>专业名称${star}</span>${majorPicker(prefix,values,override)}</label>
 <div class="field" data-field="completion_month"><span>完成 / 提交年月${star}</span>${monthPicker(prefix,values.completion_month,override)}</div>`;
}
function readMetadata(container){
 const result={};
 for(const el of container.querySelectorAll('[data-meta]')){const key=el.dataset.meta;if(el.type==='radio'){if(el.checked)result[key]=el.value;else result[key]??='';}else result[key]=el.value.trim();}
 const major=container.querySelector('[data-meta="major"]');
 // Catalog codes are recomputed by the server; only the name is submitted.
 if(major&&!major.value)delete result.major_code;
 return result;
}
// The effective level/category/门类 for a form: per-file overrides fall back to the shared form.
function effectiveContext(grid){
 const own=readMetadata(grid);if(grid.id==='upload-metadata')return own;
 const base=readMetadata($('upload-metadata'));
 return {degree_level:own.degree_level||base.degree_level,degree_category:own.degree_category||base.degree_category,discipline_category:own.discipline_category||base.discipline_category};
}
const fire=el=>el.dispatchEvent(new Event('change',{bubbles:true}));

// --- Cascade -----------------------------------------------------------------
function refreshCascade(grid){
 const ctx=effectiveContext(grid),override=!!grid.closest('[data-file-fields]');
 grid.querySelectorAll('[data-seg="degree_category"] [data-sub]').forEach(el=>{el.textContent=categorySubLabel(ctx.degree_level,el.dataset.sub);});
 const select=grid.querySelector('[data-meta="discipline_category"]');
 if(select){const current=select.value;select.innerHTML=categorySelectOptions(ctx.degree_level,ctx.degree_category,current,override);if(current&&select.value!==current){select.value='';}}
 const major=grid.querySelector('[data-meta="major"]');
 if(major&&major.value&&!major.dataset.custom){const ctx2=effectiveContext(grid);if(ctx2.degree_level&&ctx2.degree_category&&!majorsFor(ctx2.degree_level,ctx2.degree_category,ctx2.discipline_category).some(m=>m.name===major.value))setMajor(grid,null);}
}
document.addEventListener('change',event=>{
 const el=event.target;if(!el.matches||!el.matches('[data-meta="degree_level"],[data-meta="degree_category"],[data-meta="discipline_category"]'))return;
 const grid=el.closest('.metadata-grid');if(!grid)return;refreshCascade(grid);
 // Changing the shared form can change what the per-file overrides may offer.
 if(grid.id==='upload-metadata')document.querySelectorAll('[data-file-fields]').forEach(refreshCascade);
});

// --- Major picker ------------------------------------------------------------
let comboActive=-1;
function setMajor(grid,major,custom=''){
 const hidden=grid.querySelector('[data-meta="major"]'),input=grid.querySelector('.combo__input');if(!hidden)return;
 if(major){
  hidden.value=major.name;delete hidden.dataset.custom;input.value=majorDisplay(major);
  const select=grid.querySelector('[data-meta="discipline_category"]');
  if(select&&major.category&&select.value!==major.category){select.value=major.category;refreshCascade(grid);}
 }else if(custom){hidden.value=custom;hidden.dataset.custom='1';input.value=custom;}
 else{hidden.value='';delete hidden.dataset.custom;input.value='';}
 fire(hidden);
}
function comboOptions(grid,query){
 const ctx=effectiveContext(grid),q=query.trim().toLowerCase();
 if(!ctx.degree_level||!ctx.degree_category)return {hint:'请先选择学位和学位类型',items:[]};
 const all=majorsFor(ctx.degree_level,ctx.degree_category,ctx.discipline_category);
 const items=q?all.filter(m=>m.name.toLowerCase().includes(q)||(m.code||'').startsWith(q)):all;
 // Exact and prefix matches first when searching.
 if(q)items.sort((a,b)=>(b.name===query.trim())-(a.name===query.trim())||(b.name.startsWith(q))-(a.name.startsWith(q)));
 if(!q&&!ctx.discipline_category)return {hint:'输入关键词搜索全部学科门类，或先选择学科门类',items:[]};
 return {items:items.slice(0,300),total:items.length};
}
// query=null shows the whole list for the current 门类 (opening the picker on a filled field).
function renderCombo(grid,query=null){
 const input=grid.querySelector('.combo__input'),list=grid.querySelector('.combo__list');if(!input||!list)return;
 query??=input.dataset.typed?input.value:'';
 const {hint,items,total}=comboOptions(grid,query),ctx=effectiveContext(grid);let html='',group=null,index=0;
 for(const m of items){
  const label=ctx.discipline_category?m.group:`${categoryInfo(m.category)?.name} · ${m.group}`;
  if(label!==group){html+=`<div class="combo__group">${esc(label)}</div>`;group=label;}
  html+=`<div class="combo__option" role="option" id="${input.id}-opt-${index}" data-index="${index++}" data-name="${esc(m.name)}" data-category="${m.category}" data-code="${esc(m.code||'')}">${m.code?`<code>${esc(m.code)}</code>`:''}<span>${esc(m.name)}</span></div>`;
 }
 const typed=query.trim();
 if(typed&&!items.some(m=>m.name===typed))html+=`<div class="combo__option combo__option--custom" role="option" id="${input.id}-opt-${index}" data-index="${index++}" data-custom="${esc(typed)}">${icon('plus')}<span>目录中没有？使用「${esc(typed)}」作为专业名称</span></div>`;
 if(!index)html=`<div class="combo__empty">${esc(hint||'没有匹配的专业，可换个关键词')}</div>`;
 else if(total>items.length)html+=`<div class="combo__empty">还有 ${total-items.length} 项，继续输入以缩小范围</div>`;
 list.innerHTML=html;list.hidden=false;input.setAttribute('aria-expanded','true');comboActive=-1;
}
function closeCombo(grid,commit=true){
 const input=grid.querySelector('.combo__input'),list=grid.querySelector('.combo__list'),hidden=grid.querySelector('[data-meta="major"]');if(!list||list.hidden)return;
 list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');delete input.dataset.typed;
 if(!commit)return;
 const typed=input.value.trim();
 if(!typed){if(hidden.value)setMajor(grid,null);return;}
 // Keep an exact catalog match; otherwise restore the last confirmed value.
 const ctx=effectiveContext(grid),exact=ctx.degree_level&&ctx.degree_category?majorsFor(ctx.degree_level,ctx.degree_category,ctx.discipline_category).find(m=>m.name===typed||majorDisplay(m)===typed):null;
 if(exact){if(exact.name!==hidden.value)setMajor(grid,exact);else input.value=majorDisplay(exact);return;}
 if(hidden.dataset.custom){input.value=hidden.value;return;}
 const current=hidden.value?majorsFor(ctx.degree_level,ctx.degree_category,ctx.discipline_category).find(m=>m.name===hidden.value):null;
 input.value=current?majorDisplay(current):hidden.value;
}
function pickOption(grid,option){
 if(option.dataset.custom!==undefined&&option.dataset.custom!=='')setMajor(grid,null,option.dataset.custom);
 else setMajor(grid,{name:option.dataset.name,code:option.dataset.code,category:option.dataset.category});
 closeCombo(grid,false);
}
function moveActive(grid,step){
 const options=[...grid.querySelectorAll('.combo__option')];if(!options.length)return;
 comboActive=(comboActive+step+options.length)%options.length;
 options.forEach((o,i)=>o.classList.toggle('is-active',i===comboActive));
 options[comboActive].scrollIntoView?.({block:'nearest'});grid.querySelector('.combo__input').setAttribute('aria-activedescendant',options[comboActive].id);
}
document.addEventListener('focusin',event=>{if(event.target.classList?.contains('combo__input')){delete event.target.dataset.typed;renderCombo(event.target.closest('.metadata-grid'));event.target.select?.();}});
document.addEventListener('input',event=>{if(event.target.classList?.contains('combo__input')){event.target.dataset.typed='1';renderCombo(event.target.closest('.metadata-grid'),event.target.value);}},true);
document.addEventListener('keydown',event=>{
 const input=event.target;if(!input.classList?.contains('combo__input'))return;const grid=input.closest('.metadata-grid');
 if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(grid.querySelector('.combo__list').hidden)renderCombo(grid);moveActive(grid,event.key==='ArrowDown'?1:-1);}
 else if(event.key==='Enter'){event.preventDefault();const options=[...grid.querySelectorAll('.combo__option')];const chosen=options[comboActive]||options[0];if(chosen)pickOption(grid,chosen);else closeCombo(grid);}
 else if(event.key==='Escape'){event.stopPropagation();closeCombo(grid);input.blur();}
 else if(event.key==='Tab')closeCombo(grid);
});
document.addEventListener('mousedown',event=>{
 const option=event.target.closest?.('.combo__option');
 if(option){event.preventDefault();pickOption(option.closest('.metadata-grid'),option);return;}
 for(const combo of document.querySelectorAll('.combo')){if(!combo.contains(event.target)){const grid=combo.closest('.metadata-grid');if(grid)closeCombo(grid);}}
});
document.addEventListener('focusout',event=>{
 if(!event.target.classList?.contains('combo__input'))return;const grid=event.target.closest('.metadata-grid');
 setTimeout(()=>{if(!grid.contains(document.activeElement)||!document.activeElement.classList.contains('combo__input'))closeCombo(grid);},120);
});

// --- Month picker ------------------------------------------------------------
const pickerState=new WeakMap();
function nowMonth(){return monthNow();}
function renderMonthPop(picker){
 const state=pickerState.get(picker),pop=picker.querySelector('.month-picker__pop'),value=picker.querySelector('[data-meta="completion_month"]').value;
 const [maxYear,maxMonth]=nowMonth().split('-').map(Number);
 if(state.mode==='years'){
  const start=Math.floor(state.year/12)*12;
  pop.innerHTML=`<div class="month-picker__head"><button type="button" class="icon-btn" data-mp="prev-years" aria-label="上一组年份" ${start<=1900?'disabled':''}>${icon('chevron')}</button><strong>${start} – ${start+11}</strong><button type="button" class="icon-btn" data-mp="next-years" aria-label="下一组年份" ${start+12>maxYear?'disabled':''}>${icon('chevron')}</button></div>
  <div class="month-picker__grid">${Array.from({length:12},(_,i)=>start+i).map(y=>`<button type="button" class="month-picker__cell${y===Number(value.slice(0,4))?' is-selected':''}${y===maxYear?' is-current':''}" data-year="${y}" ${y>maxYear||y<1900?'disabled':''}>${y}</button>`).join('')}</div>`;
 }else{
  pop.innerHTML=`<div class="month-picker__head"><button type="button" class="icon-btn" data-mp="prev" aria-label="上一年" ${state.year<=1900?'disabled':''}>${icon('chevron')}</button><button type="button" class="month-picker__year" data-mp="years" title="切换年份">${state.year} 年${icon('chevron')}</button><button type="button" class="icon-btn" data-mp="next" aria-label="下一年" ${state.year>=maxYear?'disabled':''}>${icon('chevron')}</button></div>
  <div class="month-picker__grid">${Array.from({length:12},(_,i)=>i+1).map(m=>{const v=`${state.year}-${String(m).padStart(2,'0')}`,future=state.year>maxYear||state.year===maxYear&&m>maxMonth;return `<button type="button" class="month-picker__cell${v===value?' is-selected':''}${state.year===maxYear&&m===maxMonth?' is-current':''}" data-month="${v}" ${future?'disabled title="不能晚于当前月份"':''}>${m} 月</button>`;}).join('')}</div>
  <div class="month-picker__foot"><button type="button" class="btn btn--ghost btn--sm" data-mp="this">本月</button><button type="button" class="btn btn--ghost btn--sm" data-mp="last">上个月</button>${value?'<button type="button" class="btn btn--ghost btn--sm month-picker__clear" data-mp="clear">清除</button>':''}</div>`;
 }
}
function openMonthPicker(picker){
 document.querySelectorAll('[data-month-picker].is-open').forEach(p=>{if(p!==picker)closeMonthPicker(p);});
 const value=picker.querySelector('[data-meta="completion_month"]').value;
 pickerState.set(picker,{year:Number((value||nowMonth()).slice(0,4)),mode:'months'});
 picker.classList.add('is-open');picker.querySelector('.month-picker__pop').hidden=false;picker.querySelector('.month-picker__trigger').setAttribute('aria-expanded','true');renderMonthPop(picker);
 const rect=picker.getBoundingClientRect?.();picker.classList.toggle('opens-up',!!rect&&typeof window.innerHeight==='number'&&rect.bottom+330>window.innerHeight&&rect.top>330);
}
function closeMonthPicker(picker){picker.classList.remove('is-open');const pop=picker.querySelector('.month-picker__pop');if(pop)pop.hidden=true;picker.querySelector('.month-picker__trigger')?.setAttribute('aria-expanded','false');}
function setMonth(picker,value){
 const hidden=picker.querySelector('[data-meta="completion_month"]'),label=picker.querySelector('.month-picker__value'),override=!!picker.closest('[data-file-fields]');
 hidden.value=value;label.textContent=value?formatMonth(value):override?'继承公共参数':'选择年月';label.classList.toggle('is-empty',!value);fire(hidden);
}
document.addEventListener('click',event=>{
 const picker=event.target.closest?.('[data-month-picker]');
 document.querySelectorAll('[data-month-picker].is-open').forEach(p=>{if(p!==picker)closeMonthPicker(p);});
 if(!picker)return;
 if(event.target.closest('.month-picker__trigger')){event.preventDefault();picker.classList.contains('is-open')?closeMonthPicker(picker):openMonthPicker(picker);return;}
 const state=pickerState.get(picker);if(!state)return;
 const action=event.target.closest('[data-mp]')?.dataset.mp,cell=event.target.closest('[data-month],[data-year]');
 if(cell?.dataset.month){setMonth(picker,cell.dataset.month);closeMonthPicker(picker);picker.querySelector('.month-picker__trigger').focus();return;}
 if(cell?.dataset.year){state.year=Number(cell.dataset.year);state.mode='months';}
 else if(action==='prev')state.year--;else if(action==='next')state.year++;
 else if(action==='years')state.mode='years';
 else if(action==='prev-years')state.year-=12;else if(action==='next-years')state.year+=12;
 else if(action==='this'||action==='last'){const [y,m]=nowMonth().split('-').map(Number),d=action==='this'?new Date(y,m-1):new Date(y,m-2);setMonth(picker,`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);closeMonthPicker(picker);return;}
 else if(action==='clear'){setMonth(picker,'');closeMonthPicker(picker);return;}
 else return;
 renderMonthPop(picker);
});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=document.querySelector('[data-month-picker].is-open');if(open){event.stopPropagation();closeMonthPicker(open);open.querySelector('.month-picker__trigger').focus();}},true);
