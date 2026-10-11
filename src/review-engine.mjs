import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseMineru} from './parser.mjs';
import {callModel,checkContext,safeError,transient,modelConfig} from './models.mjs';
import {buildPrompt,buildSynthesisPrompt} from './prompts.mjs';
import {detailedSchema,synthesisSchema,validateDetailed,validateSynthesis} from './review-schema.mjs';
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
   const attempt=repo.attempt(task.id,stage,input);let outputPath=null,raw='';
   try{
    raw=await model(current,dir,task.request.model_config,schema);if(typeof raw!=='string')raw=JSON.stringify(raw);
    outputPath=stem+'.result.json';await fs.writeFile(outputPath,raw,'utf8');
    let value;try{value=JSON.parse(raw);}catch{throw Object.assign(Error('模型未输出有效 JSON'),{validation:true});}
    const result=validate(value);repo.finishAttempt(attempt.id,'succeeded',outputPath);return result;
   }catch(error){
    repo.finishAttempt(attempt.id,'failed',outputPath,safeError(error));
    if(error.validation&&!corrected){corrected=true;current=prompt+'\n\n上一次输出未通过校验：'+safeError(error)+'\n请完整重新输出，修正结构和引用，不改变原有证据规则。上一次输出仅用于纠错：\n'+raw;continue;}
    if(transient(error)&&transientCount<2){await sleep(1000*2**transientCount++);continue;}
    throw error;
   }
  }
 }
 async function execute(taskId){
  const task=repo.task(taskId);if(!task||task.status!=='queued')return;
  const dir=path.join(dataDir,'runs',task.id);
  repo.updateTask(taskId,{status:'running',started_at:task.started_at||new Date().toISOString(),error:null});
  try{
   await fs.mkdir(dir,{recursive:true});
   const version=repo.version(task.paper_version_id);if(!version)throw Error('提交文件不存在，请重新上传');
   let parsed=task.checkpoint?.parse_id?repo.parse(task.checkpoint.parse_id):repo.latestParse(version.id);
   if(!parsed){
    repo.updateTask(taskId,{stage:'parsing',message:'正在解析论文',progress:10});
    let result;for(let attempt=0;;attempt++){try{result=await parse(version.storage_path,dir);break;}catch(error){if(!transient(error)||attempt>=2)throw error;await sleep(1000*2**attempt);}}
    if(!result.blocks?.length)throw Error('解析未得到可评审的文本块；文件已保留，请检查 PDF 或重新上传');
    parsed=repo.saveParse(version.id,result,dir);
   }
   if(!parsed.blocks.length)throw Error('没有可用于评审的解析文本');
   let detailed=task.checkpoint?.detailed;
   if(!detailed){
    repo.updateTask(taskId,{stage:'reviewing',message:'正在进行六维度详细评审',progress:35});
    const prompt=buildPrompt(task.request.snapshots,parsed.blocks,task.request);
    detailed=await stageCall(task,'reviewing',prompt,detailedSchema,value=>validateDetailed(value,parsed.blocks,task.request,task.id),dir);
    repo.updateTask(taskId,{checkpoint_json:JSON.stringify({parse_id:parsed.id,detailed})});
   }
   repo.updateTask(taskId,{stage:'synthesizing',message:'正在生成综合评议与修改清单',progress:75});
   const synthesis=await stageCall(task,'synthesizing',buildSynthesisPrompt(detailed,task.request),synthesisSchema,value=>validateSynthesis(value,detailed),dir);
   repo.transaction(()=>{repo.saveRun(task.id,parsed.id,{...detailed,...synthesis});repo.updateTask(task.id,{status:'succeeded',stage:'completed',message:'评审完成，报告正在生成',progress:100,finished_at:new Date().toISOString()});});
   reports.request(task.id).catch(error=>console.error('report queue:',safeError(error)));
  }catch(error){repo.updateTask(taskId,{status:'failed',message:'评审未完成，可从已完成阶段重试',error:safeError(error),finished_at:new Date().toISOString()});}
 }
 async function pump(){while(queue.length){const taskId=queue.shift();try{await execute(taskId);}finally{scheduled.delete(taskId);}}}
 function enqueue(taskId){if(!scheduled.has(taskId)){scheduled.add(taskId);queue.push(taskId);}if(!pumping)pumping=pump().catch(error=>console.error('review queue:',safeError(error))).finally(()=>{pumping=null;if(queue.length)enqueue(queue[0]);});return pumping;}
 function retry(taskId,owner){return repo.transaction(()=>{const task=repo.task(taskId,owner);if(!task)throw Object.assign(Error('任务不存在'),{status:404});if(!['failed','interrupted'].includes(task.status))throw Object.assign(Error('仅失败或中断的任务可以重试'),{status:409});if(!task.paper_version_id||!task.request.metadata||!task.request.model_config)throw Object.assign(Error('历史任务缺少可恢复参数，请重新提交'),{status:400});if(repo.tasks(owner).filter(t=>['queued','running'].includes(t.status)).length>=10)throw Object.assign(Error('待处理任务已达 10 个'),{status:429});// A preflight rejection made no paid calls. Keep its immutable snapshot and create a linked retry with the corrected budget.
  if(task.stage==='reviewing'&&task.error?.startsWith('完整论文输入超出配置的上下文预算')&&!repo.db.prepare('SELECT 1 FROM review_attempts WHERE task_id=? LIMIT 1').get(taskId)){
   const previous=task.request.model_config,next=currentConfig(previous.selection_id||task.provider);
   if(next.model===previous.model&&next.base_url===previous.base_url&&next.context_tokens>previous.context_tokens){
    const request=structuredClone(task.request);request.model_config.context_tokens=next.context_tokens;request.retry_of_task_id=taskId;
    const fresh=repo.createTask({id:crypto.randomUUID(),owner_id:task.owner_id,paper_version_id:task.paper_version_id,parent_run_id:task.parent_run_id,provider:task.provider,model:task.model,request,message:'已使用更新后的上下文预算重试，复用原论文解析'});
    return fresh.id;
   }
  }
  repo.updateTask(taskId,{status:'queued',error:null,message:'已加入重试队列',finished_at:null});return taskId;});}
 return {enqueue,retry,idle:async()=>{while(pumping)await pumping;},execute};
}
