import type { GameAction, GameOverview, RoomSnapshot, StoryParticipant, StoryRuling, StoryScoreDetail, StoryStage } from '@ruxiju/shared';

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export interface StoryState {
  version: 2; stage: StoryStage; participants: StoryParticipant[]; order: string[];
  opening: string; endingHint: string; ending: string; tasks: Record<string,string>; source: 'ai'|'local'|'manual'|'legacy'|null;
  segments: Array<{accountId:string;content:string;task:string;submittedAt:number;taskCompleted:boolean}>;
  currentSpeakerIndex: number; currentRound: number; turnStartedAt: number|null; endingRevealed: boolean;
  votes: Record<string,{targetAccountId:string;votedAt:number}>;
  approvals: Record<string,Record<string,boolean>>; rulings: Record<string,StoryRuling>;
  points: Record<string,number>; details: Record<string,StoryScoreDetail>; processedActions: Record<string,true>;
}

export function storyState(room:RoomSnapshot):StoryState|undefined {
  if(room.currentGame!=='story'||!room.game)return;
  const raw=room.game.privateState?.story as Partial<StoryState>|undefined;
  const value=raw??{};
  const legacy=Boolean(raw&&raw.version!==2);
  value.participants??=room.members.filter(m=>m.ready).map(m=>({accountId:m.accountId,displayName:m.displayName,playerRole:m.playerRole,persona:m.playerRole}));
  value.order??=shuffle(value.participants.map(p=>p.accountId));
  value.stage??='setup';value.opening??='';value.ending??='';value.endingHint??='众人将迎来一次转变，眼前的难题会走向新的局面，具体答案留到最后揭晓。';value.tasks??={};value.source??=legacy?'legacy':null;
  value.segments??=[];value.currentSpeakerIndex??=0;value.currentRound??=1;value.turnStartedAt??=null;
  value.votes??={};value.approvals??={};value.rulings??={};value.points??={};value.details??={};value.processedActions??={};
  value.endingRevealed??=['voting','review','complete'].includes(value.stage)||legacy&&value.stage==='reveal';
  if(legacy&&value.stage==='reveal')value.stage='review';
  if(room.game.phase==='settled'){value.stage='complete';value.endingRevealed=true;}
  for(const segment of value.segments)value.tasks[segment.accountId]??=segment.task;
  value.version=2;room.game.privateState={...room.game.privateState,story:value};
  return value as StoryState;
}

export function ensureStoryGame(room:RoomSnapshot){const story=storyState(room);if(story){const lastActionAt=room.game!.publicState.lastActionAt;refreshStory(room,story);if(lastActionAt!==undefined)room.game!.publicState.lastActionAt=lastActionAt;}return room;}
export const defaultStoryRuling=():StoryRuling=>({characterPresent:true,ooc:false,disconnected:false,endingConnection:false,spoiler:false,reason:''});
const reviewing=(s:StoryState)=>s.stage==='review'||s.stage==='complete';
const eligibleVoters=(s:StoryState)=>s.participants.filter(p=>s.segments.some(seg=>seg.accountId!==p.accountId));

export function storyPublic(story:StoryState){
  const speaker=story.stage==='relay'?story.participants.find(p=>p.accountId===story.order[story.currentSpeakerIndex]):undefined;
  const visible=reviewing(story);
  const results=story.participants.map(p=>({...p,points:story.points[p.accountId]??0})).sort((a,b)=>b.points-a.points);
  const best=results[0]?.points,worst=results.at(-1)?.points;
  return {
    stage:story.stage,opening:story.opening,endingHint:story.endingHint,...(story.endingRevealed?{ending:story.ending}:{}),source:story.source,
    participants:story.participants,order:story.order,readyToStart:Boolean(story.opening&&story.ending&&story.participants.every(p=>story.tasks[p.accountId])),
    segments:story.segments.map(seg=>{const p=story.participants.find(p=>p.accountId===seg.accountId)!;return {accountId:seg.accountId,displayName:p?.displayName??'已离开玩家',playerRole:p?.playerRole??'',content:seg.content,submittedAt:new Date(seg.submittedAt).toISOString(),voteCount:visible?Object.values(story.votes).filter(v=>v.targetAccountId===seg.accountId).length:0};}),
    currentSpeakerId:speaker?.accountId??null,currentSpeakerName:speaker?.displayName??null,currentSpeakerRole:speaker?.playerRole??null,turnStartedAt:story.turnStartedAt,
    submittedCount:story.segments.length,total:story.participants.length,votedCount:Object.keys(story.votes).length,voterCount:eligibleVoters(story).length,
    points:visible?story.points:{},...(visible?{tasks:story.tasks,approvals:story.approvals,rulings:story.rulings,details:story.details}:{}),
    ...(story.stage==='complete'?{results,winnerAccountIds:results.filter(p=>p.points===best).map(p=>p.accountId),loserAccountIds:best===worst?[]:results.filter(p=>p.points===worst).map(p=>p.accountId)}:{}),
  };
}
export function refreshStory(room:RoomSnapshot,story=storyState(room)!){
  // Rebuild rather than merge: legacy public snapshots can contain the secret ending.
  room.game!.publicState={...storyPublic(story),lastActionAt:Date.now()};
  room.game!.endsAt=null;
  room.game!.primaryAction=({setup:'准备故事',relay:'提交这一段',reveal:'公布结局',voting:'投出最佳段落',review:'确认规则与计分',complete:'查看故事复盘'})[story.stage];
}
export function storyPrivate(room:RoomSnapshot,accountId:string){
  const s=storyState(room)!;const host=room.members.some(m=>m.accountId===accountId&&m.hostRole);
  return {hasSubmitted:s.segments.some(seg=>seg.accountId===accountId),ownTask:s.tasks[accountId]??null,ownVote:s.votes[accountId]?.targetAccountId??null,points:reviewing(s)?s.points[accountId]??0:0,...(host?{ending:s.ending}:{}),...(host&&s.source==='manual'&&s.stage==='setup'?{manualTasks:s.tasks}:{})};
}
export function storyOverview(room:RoomSnapshot,accountId:string):NonNullable<GameOverview['story']>{
  const s=storyState(room)!;const own=storyPrivate(room,accountId);
  return {...storyPublic(s),...(own.ending!==undefined?{ending:own.ending}:{}),ownTask:own.ownTask,ownVote:own.ownVote};
}
function text(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`${label}须为 1–${max} 字`);return value.trim();}
export function validateStoryBundle(value:unknown,participants:StoryParticipant[]){
  const input=value as Record<string,unknown>|null;
  const opening=text(input?.opening,'故事开篇',1000),ending=text(input?.ending,'既定结局',1000);
  const raw=input?.tasks as Record<string,unknown>|undefined;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==participants.length)throw new Error('必须为每位参与者填写一个秘密任务');
  const tasks=Object.fromEntries(participants.map(p=>[p.accountId,text(raw[p.accountId],'秘密任务',500)]));
  const endingHint=input?.endingHint===undefined?'众人将迎来一次转变，眼前的难题会走向新的局面，具体答案留到最后揭晓。':text(input.endingHint,'结局提示',200);
  if(endingHint===ending)throw new Error('结局提示应保留悬念，不能直接复制完整结局');
  return {opening,endingHint,ending,tasks};
}
export function applyStoryBundle(room:RoomSnapshot,value:unknown,source:'ai'|'local'|'manual'){
  const s=storyState(room);if(!s||s.stage!=='setup')throw new Error('只能在准备阶段生成或设置故事');
  const bundle=validateStoryBundle(value,s.participants);Object.assign(s,bundle,{source});refreshStory(room,s);
}
function nextTurn(room:RoomSnapshot,s:StoryState){
  if(s.currentSpeakerIndex>=s.order.length){
    const totalRounds=room.game?.config?.rounds??1;
    if(s.currentRound<totalRounds){
      s.currentRound+=1;s.currentSpeakerIndex=0;s.order=shuffle(s.order);s.stage='relay';s.turnStartedAt=Date.now();
    }else{s.stage='reveal';s.turnStartedAt=null;}
  }
  else {s.stage='relay';s.turnStartedAt=Date.now();}
  refreshStory(room,s);
}
export function advanceStory(room:RoomSnapshot){
  const s=storyState(room);if(!s)throw new Error('故事接龙尚未初始化');
  if(s.stage==='setup'){
    if(s.participants.length<2||room.members.some(m=>!m.ready))throw new Error('至少两人且全员准备后才能开始');
    validateStoryBundle(s,s.participants);s.currentSpeakerIndex=0;nextTurn(room,s);
  }else if(s.stage==='relay'){s.currentSpeakerIndex++;nextTurn(room,s);}
  else if(s.stage==='reveal'){s.endingRevealed=true;s.stage=eligibleVoters(s).length?'voting':'review';if(s.stage==='review')scoreStory(s);}
  else if(s.stage==='voting'){s.stage='review';scoreStory(s);}
  else if(s.stage==='review'){
    if(s.segments.some(seg=>!s.rulings[seg.accountId]))throw new Error('请先逐人确认规则裁定');
    finishStory(room);
  }else throw new Error('故事接龙已经结束');
  refreshStory(room,s);
}
export function scoreStory(s:StoryState){
  const counts=Object.fromEntries(s.participants.map(p=>[p.accountId,Object.values(s.votes).filter(v=>v.targetAccountId===p.accountId).length]));
  const best=Math.max(0,...Object.values(counts));
  for(const p of s.participants){
    const id=p.accountId,segment=s.segments.find(seg=>seg.accountId===id),r=s.rulings[id]??defaultStoryRuling();
    const taskCompleted=Boolean(segment&&s.participants.filter(other=>other.accountId!==id).every(other=>s.approvals[id]?.[other.accountId]===true));
    if(segment)segment.taskCompleted=taskCompleted;
    const detail:StoryScoreDetail={votes:counts[id]*2,best:best>0&&counts[id]===best?3:0,task:taskCompleted?2:0,connection:r.endingConnection?1:0,missingCharacter:r.characterPresent?0:-2,ooc:r.ooc?-2:0,disconnected:r.disconnected?-1:0,skipped:segment?0:-2,spoiler:Boolean(segment&&r.spoiler),total:0};
    detail.total=!segment?-2:r.spoiler?0:detail.votes+detail.best+detail.task+detail.connection+detail.missingCharacter+detail.ooc+detail.disconnected;
    if(!segment)Object.assign(detail,{votes:0,best:0,task:0,connection:0,missingCharacter:0,ooc:0,disconnected:0});
    s.details[id]=detail;s.points[id]=detail.total;
  }
}
export function finishStory(room:RoomSnapshot){
  const s=storyState(room)!;scoreStory(s);s.stage='complete';s.endingRevealed=true;s.turnStartedAt=null;
  refreshStory(room,s);
}
export function handleStoryAction(room:RoomSnapshot,accountId:string,input:GameAction){
  const s=storyState(room);if(!s)throw new Error('故事接龙尚未初始化');
  const participant=s.participants.find(p=>p.accountId===accountId);if(!participant)throw new Error('你不是本场参与者');
  if(s.processedActions[input.actionId])throw new Error('重复请求，请勿重复提交');
  const host=room.members.some(m=>m.accountId===accountId&&m.hostRole),payload=input.payload??{};
  const requireHost=()=>{if(!host)throw new Error('只有主持可以操作');};
  if(input.action==='story-set-character'){
    if(s.stage!=='setup')throw new Error('接龙开始后不能修改角色');
    const playerRole=text(payload.playerRole,'角色姓名',40),persona=text(payload.persona,'角色人设',500);
    Object.assign(participant,{playerRole,persona});s.opening='';s.ending='';s.tasks={};s.source=null;
  }else if(input.action==='story-reorder'){
    requireHost();if(s.stage!=='setup')throw new Error('接龙开始后不能调整顺序');
    const order=payload.order;if(!Array.isArray(order)||order.length!==s.participants.length||new Set(order).size!==order.length||order.some(id=>!s.participants.some(p=>p.accountId===id)))throw new Error('接龙顺序必须包含所有参与者且不重复');
    s.order=order as string[];
  }else if(input.action==='story-set-story'){requireHost();applyStoryBundle(room,payload,'manual');}
  else if(input.action==='story-submit-segment'){
    if(s.stage!=='relay'||s.order[s.currentSpeakerIndex]!==accountId)throw new Error('还没有轮到你接龙');
    if(s.segments.some(seg=>seg.accountId===accountId))throw new Error('你已经提交过段落');
    s.segments.push({accountId,content:text(payload.content,'接龙段落',500),task:s.tasks[accountId]??'',submittedAt:Date.now(),taskCompleted:false});
    s.currentSpeakerIndex++;nextTurn(room,s);
  }else if(input.action==='story-vote'){
    if(s.stage!=='voting')throw new Error('当前不在投票阶段');
    if(s.votes[accountId])throw new Error('你已经投过票');
    const target=payload.targetAccountId;if(typeof target!=='string'||target===accountId||!s.segments.some(seg=>seg.accountId===target))throw new Error('只能投给其他玩家已提交的段落');
    s.votes[accountId]={targetAccountId:target,votedAt:Date.now()};
    if(eligibleVoters(s).every(p=>s.votes[p.accountId])){s.stage='review';scoreStory(s);}
  }else if(input.action==='story-approve-task'){
    if(s.stage!=='review')throw new Error('当前不在评议阶段');
    const target=String(payload.targetAccountId??'');if(target===accountId||!s.segments.some(seg=>seg.accountId===target)||typeof payload.approved!=='boolean')throw new Error('只能认可其他玩家已提交段落的任务');
    s.approvals[target]??={};s.approvals[target][accountId]=payload.approved;scoreStory(s);
  }else if(input.action==='story-rule'){
    requireHost();if(s.stage!=='review')throw new Error('当前不在评议阶段');
    const target=String(payload.targetAccountId??'');if(!s.segments.some(seg=>seg.accountId===target))throw new Error('该玩家没有提交段落');
    const r=defaultStoryRuling();for(const key of ['characterPresent','ooc','disconnected','endingConnection','spoiler'] as const){if(typeof payload[key]!=='boolean')throw new Error('请完整填写规则裁定');r[key]=payload[key] as boolean;}
    r.reason=typeof payload.reason==='string'?payload.reason.trim():'';
    if(!r.characterPresent||r.ooc||r.disconnected||r.endingConnection||r.spoiler)r.reason=text(r.reason,'裁定理由',500);
    if(r.reason.length>500)throw new Error('裁定理由最多 500 字');s.rulings[target]=r;scoreStory(s);
  }else if(input.action==='story-next'){
    requireHost();if(payload.expectedStage!==s.stage||(s.stage==='relay'&&payload.expectedSpeakerId!==s.order[s.currentSpeakerIndex]))throw new Error('进程已更新，请刷新后重试');advanceStory(room);
  }else throw new Error('未知故事接龙操作');
  s.processedActions[input.actionId]=true;refreshStory(room,s);return room;
}
