// 评审任务的实时进度：各阶段在总进度条上的区间、默认预计耗时，以及模型阶段的时间插值。
export const stageRanges={queued:[0,2],parsing:[3,34],reviewing:[35,74],synthesizing:[75,98],completed:[100,100]};
// 没有历史耗时可参考时使用的保守估计（秒）。
const defaultSeconds={parsing:150,reviewing:420,synthesizing:120};
const median=values=>{if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b),mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
export function stageProgress(stage,fraction){const [start,end]=stageRanges[stage]||[0,0];return Math.round(start+(end-start)*Math.max(0,Math.min(1,fraction)));}
// 模型调用没有中间输出：按已用时间与历史中位耗时插值，超出预期后缓慢逼近但不到达阶段终点。
export function timedFraction(elapsed,expected){
 if(!(expected>0))return 0;
 return elapsed<=expected?0.9*elapsed/expected:0.9+0.08*(1-Math.exp(-(elapsed-expected)/expected));
}
export async function expectedSeconds(repo,stage,model){
 if(stage==='parsing')return defaultSeconds.parsing;
 return Math.round(median(await repo.stageDurations(stage,model))||defaultSeconds[stage]||0);
}
const seconds=(from,to)=>{const a=new Date(from).getTime(),b=new Date(to).getTime();return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.round((b-a)/1000)):null;};
// Extra live fields for one task row: interpolated progress, elapsed time and remaining-time estimate.
export async function liveProgress(repo,task,now=new Date()){
 const result={progress:Number(task.progress)||0,stage_started_at:task.stage_started_at||null,elapsed_seconds:null,stage_elapsed_seconds:null,eta_seconds:null,attempt_no:null,queue_position:null,server_time:now.toISOString()};
 if(task.started_at)result.elapsed_seconds=seconds(task.started_at,task.finished_at||now);
 if(task.status==='queued'){result.queue_position=await repo.queuePosition(task.id,task.created_at);return result;}
 if(task.status!=='running')return result;
 const attempt=await repo.runningAttempt(task.id),started=attempt?.stage===task.stage?attempt.started_at:task.stage_started_at;
 if(started)result.stage_elapsed_seconds=seconds(started,now);
 if(attempt?.stage===task.stage&&attempt.attempt_no>1)result.attempt_no=attempt.attempt_no;
 const order=['parsing','reviewing','synthesizing'],index=order.indexOf(task.stage);if(index<0)return result;
 const expected=await expectedSeconds(repo,task.stage,task.model),elapsed=result.stage_elapsed_seconds??0;
 if(task.stage!=='parsing'){result.progress=Math.max(result.progress,stageProgress(task.stage,timedFraction(elapsed,expected)));}
 // 解析阶段按 MinerU 返回的页数推进；剩余时间按该阶段已完成比例推算。
 const [start,end]=stageRanges[task.stage],done=Math.max(0,Math.min(1,(result.progress-start)/(end-start)));
 let remaining=task.stage==='parsing'&&done>0.05&&elapsed>0?elapsed*(1-done)/done:Math.max(0,expected-elapsed);
 for(const later of order.slice(index+1))remaining+=await expectedSeconds(repo,later,task.model);
 result.eta_seconds=Math.round(remaining);
 return result;
}
