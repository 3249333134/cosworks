import type { IpRole, UserProfile } from '@ruxiju/shared';
import type { Store } from './store.js';
import { newJob, startWorker, type BackgroundJob } from './jobs.js';
import { generatePoolCommit, prepareRoom, scheduleAccount } from './content-pools.js';
import { researchRole, type RoleResearch } from './role-research.js';
import { config } from './config.js';

export async function saveUserRole(store:Store,accountId:string,input:Omit<IpRole,'id'>&{id?:string},generate=false){
  return store.atomic(async tx=>{
    const profile=await tx.getProfile(accountId);const previous=input.id?profile.roles.find(r=>r.id===input.id):undefined;
    if(input.id&&!previous)throw new Error('角色不存在或无权修改');
    if(previous&&input.version!==undefined&&input.version!==(previous.version??1))throw new Error('角色资料已更新，请刷新后再保存');
    const sameIdentity=previous?.ipTheme===input.ipTheme&&previous?.name===input.name;
    let role=await tx.saveRole(accountId,{...input,version:(previous?.version??0)+1,generation:sameIdentity?previous?.generation:undefined});
    if(generate){
      const job=await tx.enqueueJob(newJob(`role:${role.id}:${role.version}`,'role',{role},accountId));
      role={...role,generation:{status:'queued',taskId:job.id,message:'已保存，资料补全中'}};await tx.saveRole(accountId,role);
    }
    return role;
  });
}
export async function profileWithJobs(store:Store,accountId:string):Promise<UserProfile>{
  const profile=await store.getProfile(accountId);
  for(const role of profile.roles){if(!role.generation)continue;const job=await store.getJob(role.generation.taskId);if(job&&['queued','running','failed'].includes(job.status))role.generation={...role.generation,status:job.status as 'queued'|'running'|'failed',message:job.error??'已保存，资料补全中'};}
  return profile;
}
export async function applyRoleResearch(tx:Store,job:BackgroundJob,result:RoleResearch){
  const before=job.payload.role as unknown as IpRole;
  const profile=await tx.getProfile(job.accountId!);const current=profile.roles.find(r=>r.id===before.id);
  if(!current||current.generation?.taskId!==job.id||current.ipTheme!==before.ipTheme||current.name!==before.name)return;
  const updated={...current};
  for(const field of ['personaTags','quote','signatureAction','ability'] as const){
    if(JSON.stringify(current[field])===JSON.stringify(before[field])&&result[field].length){
      if(field==='personaTags')updated.personaTags=result.personaTags;else updated[field]=result[field];
    }
  }
  const complete=Boolean(updated.personaTags.length&&updated.quote&&updated.signatureAction&&updated.ability);
  updated.version=(current.version??1)+1;
  updated.generation={taskId:job.id,status:complete?'complete':'partial',message:complete?'资料已自动补全':'已保存可核实资料，其余可手动补充',sources:result.sources,evidence:result.evidence};
  await tx.saveRole(job.accountId!,updated);await scheduleAccount(tx,job.accountId!);
}
export async function handleBackgroundJob(store:Store,job:BackgroundJob):Promise<(tx:Store)=>Promise<void>>{
  if(job.kind==='prepare')return async tx=>{await prepareRoom(tx,String(job.payload.code));};
  if(job.kind==='pool')return generatePoolCommit(store,job);
  const before=job.payload.role as unknown as IpRole;
  const profile=await store.getProfile(job.accountId!);const current=profile.roles.find(r=>r.id===before.id);
  if(!current||current.generation?.taskId!==job.id||current.ipTheme!==before.ipTheme||current.name!==before.name)return async()=>{};
  const {key,result}=await researchRole(store,{ipTheme:before.ipTheme,name:before.name});
  return async tx=>{
    await tx.saveGeneratedContent({cacheKey:key,accountId:null,gameId:'role',content:result,rulesVersion:1});
    await applyRoleResearch(tx,job,result);
  };
}
export function startBackground(store:Store){return startWorker(store,job=>handleBackgroundJob(store,job),config.ai.concurrency);}
