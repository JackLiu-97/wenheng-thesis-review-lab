import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseMineru} from './parser.mjs';
import {callModel,checkContext,safeError,transient,modelConfig} from './models.mjs';
import {buildPrompt,buildSynthesisPrompt} from './prompts.mjs';
import {stageProgress} from './progress.mjs';
import {detailedSchemaFor,synthesisSchema,validateDetailed,validateSynthesis} from './review-schema.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createReviewEngine(repo,dataDir,reports,{parse=parseMineru,model=callModel,sleep=delay,currentConfig=modelConfig}={}){
 const queue=[],scheduled=new Set();let pumping=null;
 async function stageCall(task,stage,prompt,schema,validate,dir){
  let transientCount=0,corrected=false,current=prompt;
  while(true){
   checkContext(current,task.request.model_config);
   const stem=path.join(dir,stage+'-'+crypto.randomUUID());const input=stem+'.prompt.txt';await fs.writeFile(input,current,'utf8');
   // Keep the familiar first-stage prompt path for audit and manual inspection.
   if(stage==='reviewing'&&!corrected)await fs.writeFile(path.join(dir,'prompt.txt'),current,'utf8');
   const attempt=await repo.attempt(task.id,stage,input);let outputPath=null,raw='';
   try{
    raw=await model(current,dir,task.request.model_config,schema);if(typeof raw!=='string')raw=JSON.stringify(raw);
    outputPath=stem+'.result.json';await fs.writeFile(outputPath,raw,'utf8');
    let value;try{value=JSON.parse(raw);}catch{throw Object.assign(Error('模型未输出有效 JSON'),{validation:true});}
    const result=validate(value);await repo.finishAttempt(attempt.id,'succeeded',outputPath);return result;
   }catch(error){
    await repo.finishAttempt(attempt.id,'failed',outputPath,safeError(error));
    if(error.validation&&!corrected){corrected=true;await repo.updateTask(task.id,{message:(stage==='reviewing'?'六维度评审':'综合评议')+'输出未通过校验，正在让模型纠正'});current=prompt+'\n\n上一次输出未通过校验：'+safeError(error)+'\n请完整重新输出，修正结构和引用，不改变原有证据规则。上一次输出仅用于纠错：\n'+raw;continue;}
    if(transient(error)&&transientCount<2){await repo.updateTask(task.id,{message:`模型服务暂时不可用，第 ${transientCount+1} 次自动重试`});await sleep(1000*2**transientCount++);continue;}
    throw error;
   }
  }
 }
 async function execute(taskId){
  const task=await repo.task(taskId);if(!task||task.status!=='queued')return;
  const dir=path.join(dataDir,'runs',task.id);
  await repo.updateTask(taskId,{status:'running',started_at:task.started_at||new Date().toISOString(),error:null});
  try{
   await fs.mkdir(dir,{recursive:true});
   const version=await repo.version(task.paper_version_id);if(!version)throw Error('提交文件不存在，请重新上传');
   let parsed=task.checkpoint?.parse_id?await repo.parse(task.checkpoint.parse_id):await repo.latestParse(version.id);
   // A byte-identical PDF that was parsed before is not sent to MinerU again.
   if(!parsed){const reusable=await repo.reusableParse(version.sha256);if(reusable){parsed=await repo.cloneParse(reusable.id,version.id);await repo.updateTask(taskId,{stage:'parsing',message:`检测到相同 PDF（${reusable.original_filename}），已复用此前的解析结果`,progress:stageProgress('parsing',1),stage_started_at:new Date().toISOString()});}}
   if(!parsed){
    await repo.updateTask(taskId,{stage:'parsing',message:'正在解析论文',progress:stageProgress('parsing',0),stage_started_at:new Date().toISOString()});
    // Persist parser sub-steps (upload, MinerU page progress, download) only when they change, in order.
    let last='',writes=Promise.resolve();const onProgress=({message,fraction})=>{const progress=stageProgress('parsing',fraction),key=message+'|'+progress;if(key===last)return;last=key;writes=writes.then(()=>repo.updateTask(taskId,{message,progress})).catch(error=>console.error('progress:',safeError(error)));};
    let result;try{for(let attempt=0;;attempt++){try{result=await parse(version.storage_path,dir,onProgress);break;}catch(error){if(!transient(error)||attempt>=2)throw error;await sleep(1000*2**attempt);}}}finally{await writes;}
    if(!result.blocks?.length)throw Error('解析未得到可评审的文本块；文件已保留，请检查 PDF 或重新上传');
    parsed=await repo.saveParse(version.id,result,dir);
   }
   if(!parsed.blocks.length)throw Error('没有可用于评审的解析文本');
   let detailed=task.checkpoint?.detailed;
   if(!detailed){
    await repo.updateTask(taskId,{stage:'reviewing',message:'模型正在进行六维度详细评审',progress:stageProgress('reviewing',0),stage_started_at:new Date().toISOString()});
    const prompt=buildPrompt(task.request.snapshots,parsed.blocks,task.request);
    detailed=await stageCall(task,'reviewing',prompt,detailedSchemaFor(task.request),value=>validateDetailed(value,parsed.blocks,task.request,task.id),dir);
    await repo.updateTask(taskId,{checkpoint_json:JSON.stringify({parse_id:parsed.id,detailed})});
   }
   await repo.updateTask(taskId,{stage:'synthesizing',message:'模型正在生成综合评议与修改清单',progress:stageProgress('synthesizing',0),stage_started_at:new Date().toISOString()});
   const synthesis=await stageCall(task,'synthesizing',buildSynthesisPrompt(detailed,task.request),synthesisSchema,value=>validateSynthesis(value,detailed),dir);
   await repo.transaction(async tx=>{await tx.saveRun(task.id,parsed.id,{...detailed,...synthesis});await tx.updateTask(task.id,{status:'succeeded',stage:'completed',message:'评审完成，报告正在生成',progress:100,stage_started_at:new Date().toISOString(),finished_at:new Date().toISOString()});});
   reports.request(task.id).catch(error=>console.error('report queue:',safeError(error)));
  }catch(error){await repo.updateTask(taskId,{status:'failed',message:'评审未完成，可从已完成阶段重试',error:safeError(error),finished_at:new Date().toISOString()});}
 }
 async function pump(){while(queue.length){const taskId=queue.shift();try{await execute(taskId);}finally{scheduled.delete(taskId);}}}
 function enqueue(taskId){if(!scheduled.has(taskId)){scheduled.add(taskId);queue.push(taskId);}if(!pumping)pumping=pump().catch(error=>console.error('review queue:',safeError(error))).finally(()=>{pumping=null;if(queue.length)enqueue(queue[0]);});return pumping;}
 function retry(taskId,owner){return repo.transaction(async tx=>{
  const task=await tx.task(taskId,owner);if(!task)throw Object.assign(Error('任务不存在'),{status:404});
  if(!['failed','interrupted'].includes(task.status))throw Object.assign(Error('仅失败或中断的任务可以重试'),{status:409});
  if(!task.paper_version_id||!task.request.metadata||!task.request.model_config)throw Object.assign(Error('历史任务缺少可恢复参数，请重新提交'),{status:400});
  if((await tx.tasks(owner)).filter(t=>['queued','running'].includes(t.status)).length>=10)throw Object.assign(Error('待处理任务已达 10 个'),{status:429});
  // Snapshots are immutable: when the model config changed since submission, retry as a linked task using the current config.
  const previous=task.request.model_config;let next=null;
  try{next=currentConfig(previous.selection_id||task.provider);}catch{}
  if(next&&['model','base_url','context_tokens','output_tokens'].some(k=>next[k]!==previous[k])){
   const sameModel=next.model===previous.model&&next.base_url===previous.base_url;
   const request=structuredClone(task.request);request.model_config=next;request.retry_of_task_id=taskId;
   const fresh=await tx.createTask({id:crypto.randomUUID(),owner_id:task.owner_id,paper_version_id:task.paper_version_id,parent_run_id:task.parent_run_id,provider:next.provider,model:next.model,request,message:'已使用当前模型配置重试，复用原论文解析'});
   // Completed model stages carry over only when the same model produced them; the parse is reused either way.
   const checkpoint=task.checkpoint&&(sameModel?task.checkpoint:{parse_id:task.checkpoint.parse_id});
   if(checkpoint)await tx.updateTask(fresh.id,{checkpoint_json:JSON.stringify(checkpoint)});
   await tx.updateTask(taskId,{message:'已使用当前模型配置创建重试任务'});
   return fresh.id;
  }
  await tx.updateTask(taskId,{status:'queued',error:null,message:'已加入重试队列',finished_at:null});return taskId;
 });}
 return {enqueue,retry,idle:async()=>{while(pumping)await pumping;},execute};
}
