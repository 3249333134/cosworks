import { randomInt } from 'node:crypto';
import type { GameAction, RoomSnapshot, UndercoverView } from '@ruxiju/shared';

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export interface UndercoverState {
  version:1; stage:'setup'|'speaking'|'voting'|'result'|'complete'; ipTheme:string;
  participants:Array<{accountId:string;displayName:string;playerRole:string}>;
  count:number; words:{civilian:string;undercover:string}|null; spies:string[];
  alive:string[]; order:string[]; speakerIndex:number; round:number;
  votes:Record<string,string>; rounds:Array<{round:number;votes:Record<string,string>;eliminated:string|null;tied:string[]}>;
  winner:'civilian'|'undercover'|null; aborted:boolean; processed:Record<string,true>;
}
export function undercoverState(room:RoomSnapshot){return room.currentGame==='undercover'?room.game?.privateState?.undercover as UndercoverState|undefined:undefined;}
export function ensureUndercover(room:RoomSnapshot){
  if(room.currentGame!=='undercover'||!room.game)return;
  if(!undercoverState(room)){
    const participants=room.members.filter(m=>m.ready).map(({accountId,displayName,playerRole})=>({accountId,displayName,playerRole}));
    const ids=participants.map(p=>p.accountId);
    room.game.privateState={undercover:{version:1,stage:'setup',ipTheme:room.ipTheme,participants,count:recommendedSpies(ids.length),words:null,spies:[],alive:ids,order:shuffle(ids),speakerIndex:0,round:1,votes:{},rounds:[],winner:null,aborted:room.game.phase==='settled',processed:{}} satisfies UndercoverState};
    if(room.game.phase==='settled')undercoverState(room)!.stage='complete';
  }
  refreshUndercover(room);
}
export function recommendedSpies(total:number){return Math.max(1,Math.min(Math.floor((total-1)/2),Math.round(total/4)));}
export function validateWordPair(value:unknown){
  const raw=value as {civilian?:unknown;undercover?:unknown};
  const valid=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=30;
  if(!valid(raw?.civilian)||!valid(raw?.undercover)||raw.civilian.trim()===raw.undercover.trim())throw new Error('未能生成两组不同的 IP 词语，请重试');
  return {civilian:raw.civilian.trim(),undercover:raw.undercover.trim()};
}
export function beginUndercover(room:RoomSnapshot,accountId:string,value:unknown){
  const s=undercoverState(room);if(!s||s.stage!=='setup'||room.status!=='running')throw new Error('当前不能发词');
  requireHost(room,accountId);
  if(s.participants.length<4||s.participants.some(p=>!room.members.find(m=>m.accountId===p.accountId)?.ready))throw new Error('至少 4 人且全员准备后才能发词');
  const words=validateWordPair(value),ids=s.participants.map(p=>p.accountId);
  for(let i=ids.length-1;i>0;i--){const j=randomInt(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
  s.words=words;s.spies=ids.slice(0,s.count);s.stage='speaking';refreshUndercover(room);
}
function requireHost(room:RoomSnapshot,id:string){if(!room.members.some(m=>m.accountId===id&&m.hostRole))throw new Error('只有主持可以设置或推进');}
export function undercoverView(room:RoomSnapshot,accountId?:string):UndercoverView{
  const s=undercoverState(room)!;const complete=s.stage==='complete';
  return {stage:s.stage,ipTheme:s.ipTheme,participants:s.participants,count:s.count,recommended:recommendedSpies(s.participants.length),maxCount:Math.max(1,Math.floor((s.participants.length-1)/2)),alive:s.alive,round:s.round,speakerId:s.stage==='speaking'?s.order[s.speakerIndex]??null:null,votedCount:Object.keys(s.votes).length,totalVoters:s.alive.length,ownVote:accountId?s.votes[accountId]??null:null,ownWord:accountId&&s.words?(s.spies.includes(accountId)?s.words.undercover:s.words.civilian):null,lastResult:s.rounds.at(-1)??null,winner:s.winner,aborted:s.aborted,...(complete?{reveal:{words:s.words,spies:s.spies,rounds:s.rounds}}:{})};
}
export function refreshUndercover(room:RoomSnapshot){
  const s=undercoverState(room)!;
  const winners=s.winner==='undercover'?s.spies:s.winner==='civilian'?s.participants.filter(p=>!s.spies.includes(p.accountId)).map(p=>p.accountId):[];
  room.game!.publicState={...undercoverView(room),...(s.stage==='complete'?{winnerAccountIds:winners}:{}),lastActionAt:Date.now()};room.game!.round=s.round;room.game!.endsAt=null;
  if(s.stage==='complete'){room.status='settled';room.game!.phase='settled';}
}
export function abortUndercover(room:RoomSnapshot){const s=undercoverState(room)!;if(s.stage!=='complete'){s.stage='complete';s.aborted=true;}refreshUndercover(room);}
function endVote(room:RoomSnapshot){
  const s=undercoverState(room)!;const counts:Record<string,number>={};Object.values(s.votes).forEach(id=>counts[id]=(counts[id]??0)+1);
  const best=Math.max(0,...Object.values(counts));const tied=Object.keys(counts).filter(id=>counts[id]===best);
  const eliminated=tied.length===1?tied[0]:null;
  if(eliminated)s.alive=s.alive.filter(id=>id!==eliminated);
  s.rounds.push({round:s.round,votes:{...s.votes},eliminated,tied:eliminated?[]:tied});
  const spies=s.alive.filter(id=>s.spies.includes(id)).length;
  const winner:UndercoverState['winner']=spies===0?'civilian':spies>=s.alive.length-spies?'undercover':null;
  s.winner=winner;
  if(winner){s.stage='complete';}else{s.round++;s.order=shuffle(s.alive);s.speakerIndex=0;s.votes={};s.stage='speaking';}
  refreshUndercover(room);
}
export function handleUndercover(room:RoomSnapshot,id:string,input:GameAction){
  const s=undercoverState(room);if(!s)throw new Error('游戏尚未初始化');
  if(!s.participants.some(p=>p.accountId===id))throw new Error('你不是本场参与者');
  if(input.payload?.sessionId!==room.game!.sessionId||input.payload?.round!==s.round)throw new Error('场次或轮次已更新，请刷新后重试');
  if(s.processed[input.actionId])throw new Error('请勿重复提交');
  if(input.action==='undercover-count'){
    requireHost(room,id);if(s.stage!=='setup')throw new Error('发词后不能修改卧底人数');
    const count=input.payload?.count;if(typeof count!=='number'||!Number.isInteger(count)||count<1||count>Math.floor((s.participants.length-1)/2))throw new Error('卧底人数必须至少 1 人，且少于平民人数');s.count=count;
  }else if(input.action==='undercover-spoke'){
    if(s.stage!=='speaking'||s.order[s.speakerIndex]!==id)throw new Error('还没有轮到你发言');
    s.speakerIndex++;if(s.speakerIndex>=s.order.length)s.stage='voting';
  }else if(input.action==='undercover-vote'){
    if(s.stage!=='voting'||!s.alive.includes(id))throw new Error('当前不能投票');if(s.votes[id])throw new Error('你已经投过票');
    const target=input.payload?.target;if(typeof target!=='string'||target===id||!s.alive.includes(target))throw new Error('只能投给其他存活玩家');s.votes[id]=target;
    if(s.alive.every(a=>s.votes[a]))endVote(room);
  }else if(input.action==='undercover-next'){
    requireHost(room,id);if(s.stage!=='result')throw new Error('请先完成本轮投票');s.round++;s.order=shuffle(s.alive);s.speakerIndex=0;s.votes={};s.stage='speaking';
  }else if(input.action==='undercover-skip'){
    requireHost(room,id);if(s.stage!=='speaking'||input.payload?.speakerId!==s.order[s.speakerIndex])throw new Error('发言者已更新');s.speakerIndex++;if(s.speakerIndex>=s.order.length)s.stage='voting';
  }else if(input.action==='undercover-close-vote'){
    requireHost(room,id);if(s.stage!=='voting')throw new Error('当前不在投票阶段');endVote(room);
  }else throw new Error('不支持的卧底游戏操作');
  s.processed[input.actionId]=true;refreshUndercover(room);return room;
}
