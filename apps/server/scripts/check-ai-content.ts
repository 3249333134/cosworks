// Explicit opt-in smoke check: uses the server's private environment, never prints credentials.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { config } from '../src/config.js';
import { aiJson } from '../src/ai-client.js';
import { generatePoolCommit, poolSpecs, type ContentPool } from '../src/content-pools.js';
import { newJob } from '../src/jobs.js';
import { researchRole } from '../src/role-research.js';
import type { RoomSnapshot } from '@ruxiju/shared';

const report:Array<Record<string,unknown>>=[];
config.ai.timeout=60000;
console.log('Checking Agnes model availability');
try{const ping=await aiJson('返回 {"ok":true}',{task:'连接验证'},100);console.log('Model response:',JSON.stringify(ping));}catch(e){console.log(e instanceof Error?e.message:'API unavailable');process.exitCode=1;}
if(!process.exitCode){
for(const [ip,...names] of [['罗小黑战记','无限','罗小黑'],['原神','钟离','温迪'],['火影忍者','漩涡鸣人','旗木卡卡西']]){
  const store=new MemoryStore();const members:RoomSnapshot['members']=[];
  for(const name of names){
    const user=await store.createUser(name,'unused',name);await store.updateProfile(user.id,{mbti:members.length?'ENFP':'INFP'});
    let role={id:randomUUID(),ipTheme:ip,name,personaTags:[] as string[],quote:'',signatureAction:'',ability:'',isDefault:true,version:1};
    try{const research=await researchRole(store,role);role={...role,...research.result};report.push({kind:'role',ip,name,result:research.result});console.log(`Research ${ip}/${name}: ${research.result.sources.length} sources`);}catch(e){report.push({kind:'role',ip,name,error:e instanceof Error?e.message:'failed'});console.log(`Research ${ip}/${name}: unavailable`);}
    await store.saveRole(user.id,role);members.push({id:randomUUID(),accountId:user.id,displayName:name,isOwner:!members.length,hostRole:members.length?null:'owner',playerRole:name,ipRoleId:role.id,team:'队',ready:true,online:true,score:0});
  }
  const room:RoomSnapshot={id:randomUUID(),code:'ABCD23',name:ip,ipTheme:ip,status:'waiting',ownerAccountId:members[0].accountId,members,currentGame:null,game:null,gamePlan:[],planCursor:0,planRound:1,closedAt:null};await store.createRoom(room);
  for(const spec of await poolSpecs(store,room)){
    try{await store.atomic(await generatePoolCommit(store,newJob(spec.key,'pool',{spec})));const pool=(await store.getGeneratedContent(spec.key))?.content as ContentPool;report.push({kind:spec.gameId,ip,name:spec.context?.role.name,items:pool?.items.map(i=>i.value)});console.log(`${ip}/${spec.gameId}/${spec.context?.role.name??'room'}: ${pool?.items.length??0} accepted`);}catch(e){report.push({kind:spec.gameId,ip,name:spec.context?.role.name,error:e instanceof Error?e.message:'failed'});console.log(`${ip}/${spec.gameId}: generation unavailable`);}
    writeFileSync('../../.local/ai-content-report.json',JSON.stringify(report,null,2));
  }
}
}
