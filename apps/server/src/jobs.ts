import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';

export interface BackgroundJob {
  id:string; key:string; kind:'role'|'prepare'|'pool'; accountId:string|null;
  payload:Record<string,unknown>; status:'queued'|'running'|'complete'|'failed';
  attempts:number; runAt:number; leaseUntil:number; leaseToken:string|null; error:string|null;
}
export function newJob(key:string,kind:BackgroundJob['kind'],payload:Record<string,unknown>,accountId:string|null=null,delay=0):BackgroundJob {
  return {id:randomUUID(),key,kind,accountId,payload,status:'queued',attempts:0,runAt:Date.now()+delay,leaseUntil:0,leaseToken:null,error:null};
}
export const JOB_SCHEMA=`CREATE TABLE IF NOT EXISTS background_jobs (
  id CHAR(36) PRIMARY KEY, job_key VARCHAR(255) NOT NULL UNIQUE, kind VARCHAR(20) NOT NULL,
  account_id CHAR(36) NULL, payload JSON NOT NULL, status VARCHAR(20) NOT NULL,
  attempts INT NOT NULL DEFAULT 0, run_at BIGINT NOT NULL, lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token CHAR(36) NULL, error VARCHAR(255) NULL, INDEX idx_jobs_ready(status,run_at,lease_until)
)`;

// Only the lease owner can commit a result. Network work runs outside this transaction.
export async function runOneJob(store:Store,handle:(job:BackgroundJob)=>Promise<(tx:Store)=>Promise<void>>,now=Date.now()) {
  const job=await store.claimJob(now,600_000);if(!job)return false;
  try {
    const commit=await handle(job);
    await store.atomic(async tx=>{
      if(!await tx.ownsJob(job.id,job.leaseToken!))return;
      await commit(tx);await tx.finishJob(job.id,job.leaseToken!,'complete',null,0);
    });
  } catch(error) {
    const permanent=error instanceof PermanentJobError;
    const failed=permanent||job.attempts>=3;
    await store.finishJob(job.id,job.leaseToken!,failed?'failed':'queued',error instanceof Error?error.message.slice(0,200):'后台生成失败',Date.now()+Math.min(60_000,5000*2**job.attempts));
  }
  return true;
}
export class PermanentJobError extends Error {}
export function startWorker(store:Store,handle:(job:BackgroundJob)=>Promise<(tx:Store)=>Promise<void>>,concurrency=2) {
  let stopped=false;const timers=new Set<NodeJS.Timeout>();
  const loop=async()=>{if(stopped)return;try{await runOneJob(store,handle);}catch{console.warn('[background] 暂无法处理队列，将重试');}if(!stopped){const timer=setTimeout(()=>{timers.delete(timer);void loop();},500);timer.unref();timers.add(timer);}};
  for(let i=0;i<Math.max(1,Math.min(8,concurrency));i++)void loop();
  return ()=>{stopped=true;for(const timer of timers)clearTimeout(timer);};
}
