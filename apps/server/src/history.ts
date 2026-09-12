import { GAME_DEFINITIONS, type GameHistory, type GameHistoryEvent, type GameOverview, type GamePlanItem, type PartyTimeline, type PartyTimelineItem, type PlayerLegend, type RoomSnapshot, type TimelineItemStatus, type WitchHistoryCell } from '@ruxiju/shared';
import { gameOverview, restoreRuntime, type PersistedRuntime } from './game-engine.js';
import type { StoryState } from './story-engine.js';
import { shoppingResults, type ShoppingState } from './shopping-engine.js';
import { undercoverView } from './undercover-engine.js';
import type { GameEventRecord, GameSessionRecord } from './store.js';

const PLAYER_COLORS=['#4CC9F0','#F72585','#B8E986','#FF9F1C','#9B8AFB','#2EC4B6','#FF6B6B','#FFD166','#6EA8FE','#E07A5F','#80ED99','#C77DFF'];

type PersistedSessionState={game?:RoomSnapshot['game'];runtime?:PersistedRuntime};
type WitchDeposit={cell:number;punishment:string;buriedAt?:number};
type WitchReveal={cell:number;hit:boolean;investigatedByAccountId?:string;investigatedByName?:string;investigatedAt?:number};
type WitchState={deposits?:Record<string,WitchDeposit>;investigations?:Record<string,WitchReveal[]>};
type TruthState={submissions?:Record<string,{statements:[string,string,string];falseIndex:number}>;rounds?:Array<{speakerAccountId:string;statements:[string,string,string];falseIndex:number;votes:Record<string,{statementIndex:number}>}>;points?:Record<string,number>};

export function playerLegend(room:RoomSnapshot):PlayerLegend[]{return room.members.map((member,index)=>({accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,color:PLAYER_COLORS[index%PLAYER_COLORS.length],initial:Array.from(member.displayName.trim())[0]??'玩'}));}

export function buildTimeline(room:RoomSnapshot,sessions:GameSessionRecord[]):PartyTimeline {
  const byPlan=new Map<string,GameSessionRecord[]>();const extras:GameSessionRecord[]=[];const unbound:GameSessionRecord[]=[];
  for(const session of sessions){if(session.planItemId){byPlan.set(session.planItemId,[...(byPlan.get(session.planItemId)??[]),session]);}else unbound.push(session);}
  for(const plan of room.gamePlan){if(byPlan.has(plan.id))continue;const index=unbound.findIndex(session=>session.gameId===plan.gameId);if(index>=0)byPlan.set(plan.id,[unbound.splice(index,1)[0]]);}
  extras.push(...unbound);
  const groups:Array<{startIndex:number;plans:GamePlanItem[]}>=[];
  for(let i=0;i<room.gamePlan.length;i++){
    const plan=room.gamePlan[i];const last=groups[groups.length-1];
    if(last&&last.plans[last.plans.length-1].gameId===plan.gameId)last.plans.push(plan);
    else groups.push({startIndex:i,plans:[plan]});
  }
  const items:PartyTimelineItem[]=groups.map(group=>{
    const allSessions=group.plans.flatMap(p=>byPlan.get(p.id)??[]);
    const totalRounds=group.plans.reduce((sum,p)=>sum+(p.rounds??1),0);
    const currentSession=allSessions.find(s=>s.id===room.game?.sessionId&&room.game?.phase!=='settled')??allSessions.at(-1)??null;
    const completedSessions=allSessions.filter(s=>Boolean(s.endedAt)||sessionState(s)?.game?.phase==='settled');
    const playedRounds=currentSession?completedSessions.length+(currentSession.id===room.game?.sessionId?1:0):completedSessions.length;
    const hasCurrent=allSessions.some(s=>s.id===room.game?.sessionId&&room.game?.phase!=='settled');
    const allDone=playedRounds>=totalRounds&&allSessions.length>0&&!hasCurrent;
    const firstPlanIndex=group.startIndex;
    const status:TimelineItemStatus=allDone?'completed':hasCurrent?'current':firstPlanIndex===room.planCursor?'next':'upcoming';
    const sessionIds=allSessions.map(s=>s.id);
    const roundLabel=totalRounds>1?` · ${playedRounds}/${totalRounds} 轮`:'';
    return {planItemId:group.plans[0].id,gameId:group.plans[0].gameId,position:firstPlanIndex+1,status,sessionId:currentSession?.id??null,startedAt:allSessions[0]?.startedAt??null,endedAt:allSessions.at(-1)?.endedAt??null,summary:timelineSummary(group.plans[0].gameId,status,currentSession)+roundLabel,rounds:totalRounds,currentRound:Math.min(playedRounds,totalRounds),sessionIds};
  });
  const sortWeight=(s:TimelineItemStatus)=>s==='current'?0:s==='next'?3:s==='upcoming'?10:1;
  items.sort((a,b)=>{const wa=sortWeight(a.status),wb=sortWeight(b.status);if(wa!==wb)return wa-wb;if(a.status==='completed'&&b.status==='completed'){const ta=a.endedAt?new Date(a.endedAt).getTime():0;const tb=b.endedAt?new Date(b.endedAt).getTime():0;if(ta!==tb)return tb-ta;return b.position-a.position;}return a.position-b.position;});
  return {items,extras:extras.map((session,index)=>({planItemId:session.planItemId??`legacy-${session.id}`,gameId:session.gameId,position:room.gamePlan.length+index+1,status:session.endedAt?'completed':'current',sessionId:session.id,startedAt:session.startedAt,endedAt:session.endedAt,summary:session.endedAt?'旧场次记录':'进行中的旧场次',legacy:true})),players:playerLegend(room)};
}

export function buildHistory(room:RoomSnapshot,session:GameSessionRecord,events:GameEventRecord[],requesterAccountId:string):GameHistory {
  const persisted=sessionState(session);const sessionGame=persisted?.game;const settled=Boolean(session.endedAt)||sessionGame?.phase==='settled';const legends=playerLegend(room);
  const eventHistory:GameHistoryEvent[]=events.filter(()=>session.gameId!=='story'||settled).filter(event=>event.visibility==='public'||(event.visibility==='private'&&event.actorAccountId===requesterAccountId)||(settled&&event.visibility==='public_after_settle')).map(event=>({id:event.id,actorAccountId:event.actorAccountId,actorName:room.members.find(member=>member.accountId===event.actorAccountId)?.displayName??null,eventType:event.eventType,payload:event.payload,createdAt:event.createdAt}));
  let overview:GameOverview|null=null;
  if(!settled&&session.id===room.game?.sessionId){restoreRuntime(room,persisted?.runtime);overview=gameOverview(room,requesterAccountId);}
  const history:GameHistory={sessionId:session.id,planItemId:session.planItemId,gameId:session.gameId,phase:sessionGame?.phase??(settled?'settled':'playing'),startedAt:session.startedAt,endedAt:session.endedAt,summary:historySummary(session.gameId,persisted,settled),players:legends,overview,events:eventHistory,legacy:!session.planItemId};
  if(settled&&session.gameId==='dont'){const counts=persisted?.runtime?.dontWordCounts??{};const minimum=Math.min(...Object.values(counts));history.dont={players:room.members.map(member=>{const words=persisted?.runtime?.dontWordHistory?.[member.accountId]??[];const currentWord=persisted?.runtime?.challenges?.[member.accountId]?.content??words.at(-1)??null;return {accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,words,currentWord,usedWords:currentWord?words.slice(0,-1):words,wordCount:counts[member.accountId]??words.length,winner:counts[member.accountId]!==undefined&&counts[member.accountId]===minimum};})};}
  if(session.gameId==='draw'&&settled){const draw=sessionGame?.privateState?.draw as {word?:string;order?:string[];drawings?:string[];guess?:string|null;correct?:boolean|null}|undefined;if(draw){const order=draw.order??[];const drawings=draw.drawings??[];history.draw={word:draw.word??'',guess:draw.guess??null,correct:draw.correct??null,turns:order.slice(0,drawings.length).map((accountId,i)=>{const member=room.members.find(m=>m.accountId===accountId);return {accountId,displayName:member?.displayName??'已离开玩家',playerRole:member?.playerRole??'',drawing:drawings[i]};})};}}
  if(settled&&session.gameId!=='dont'&&session.gameId!=='witch'&&session.gameId!=='draw'){const winners=new Set(Array.isArray(sessionGame?.publicState.winnerAccountIds)?sessionGame.publicState.winnerAccountIds as string[]:[]);history.challenges=room.members.flatMap(member=>{const challenge=persisted?.runtime?.challenges?.[member.accountId];return challenge?[{accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,title:challenge.title,content:challenge.content,completed:Boolean(persisted?.runtime?.completed?.includes(member.accountId)||(persisted?.runtime?.mustTriggerCounts?.[member.accountId]??0)>0),...(session.gameId==='must'?{triggerCount:persisted?.runtime?.mustTriggerCounts?.[member.accountId]??0,cardChangeCount:persisted?.runtime?.mustCardChanges?.[member.accountId]??0,challengeHistory:persisted?.runtime?.mustChallengeHistory?.[member.accountId]??[challenge.content],winner:winners.has(member.accountId)}:{})}]:[];});}
  if(session.gameId==='witch'&&settled)history.witch=buildWitchHistory(room,sessionGame??null,legends);
  if(session.gameId==='truth'&&settled){
    const truth=sessionGame?.privateState?.truth as TruthState|undefined;
    const points=truth?.points??{};
    const best=Math.max(0,...Object.values(points));
    const rounds=(truth?.rounds??[]).map(round=>{
      const speaker=room.members.find(member=>member.accountId===round.speakerAccountId);
      return {speakerAccountId:round.speakerAccountId,speakerName:speaker?.displayName??'已离开玩家',playerRole:speaker?.playerRole??'未知角色',statements:round.statements,falseIndex:round.falseIndex,votes:Object.entries(round.votes).map(([accountId,vote])=>{const member=room.members.find(item=>item.accountId===accountId);return {accountId,displayName:member?.displayName??'已离开玩家',statementIndex:vote.statementIndex,correct:vote.statementIndex===round.falseIndex};})};
    });
    const results=room.members.filter(member=>member.ready).map(member=>({accountId:member.accountId,displayName:member.displayName,points:points[member.accountId]??0,winner:(points[member.accountId]??0)===best}));
    history.truth={rounds,results};
    history.challenges=rounds.map(round=>({accountId:round.speakerAccountId,displayName:round.speakerName,playerRole:round.playerRole,title:`第 ${round.falseIndex+1} 条是虚构描述`,content:round.statements.map((statement,index)=>`${index+1}. ${statement}${index===round.falseIndex?'（虚构）':'（原作）'}`).join('；'),completed:true,winner:results.some(result=>result.accountId===round.speakerAccountId&&result.winner)}));
  }
  if(session.gameId==='auction'&&settled)history.auction=buildAuctionHistory(room,sessionGame??null);
  if(session.gameId==='story'&&settled)history.story=buildStoryHistory(room,sessionGame??null);
  if(session.gameId==='shopping'&&settled){const shopping=sessionGame?.privateState?.shopping as ShoppingState|undefined;if(shopping)history.shopping={ipTheme:shopping.ipTheme,results:shoppingResults(shopping)};}
  if(session.gameId==='undercover'&&settled&&sessionGame?.privateState?.undercover){const historyRoom={...room,currentGame:'undercover' as const,game:sessionGame};history.undercover=undercoverView(historyRoom);const spies=new Set(history.undercover.reveal?.spies??[]);history.challenges=history.undercover.participants.map(p=>({accountId:p.accountId,displayName:p.displayName,playerRole:p.playerRole,title:spies.has(p.accountId)?'卧底':'平民',content:spies.has(p.accountId)?history.undercover!.reveal?.words?.undercover??'词语未记录':history.undercover!.reveal?.words?.civilian??'词语未记录',completed:true,winner:history.undercover!.winner===(spies.has(p.accountId)?'undercover':'civilian')}));}
  return history;
}

type AuctionState={stage?:'init'|'setup'|'preview'|'bidding'|'complete';budgets?:Record<string,number>;wallets?:Record<string,number>;lots?:Array<{lotId:string;sellerAccountId:string;title:string;story:string;assetId:string;imageUrl:string;thumbUrl:string;submittedAt?:number;bidHistory?:Array<{accountId:string;price:number;bidAt?:number}>;winnerAccountId:string|null;soldPrice:number|null;soldAt?:number|null;sold:boolean}>};
function buildAuctionHistory(room:RoomSnapshot,game:RoomSnapshot['game']|null){
  const auc=game?.privateState?.auction as AuctionState|undefined;
  const ready=room.members.filter(member=>member.ready);
  const nameOf=(accountId:string)=>room.members.find(member=>member.accountId===accountId)?.displayName??'已离开玩家';
  const roleOf=(accountId:string)=>room.members.find(member=>member.accountId===accountId)?.playerRole??'未知角色';
  const initialBudgets:Record<string,number>={};const finalWallets:Record<string,number>={};ready.forEach(member=>{initialBudgets[member.accountId]=Number(auc?.budgets?.[member.accountId]??0);finalWallets[member.accountId]=Number(auc?.wallets?.[member.accountId]??0);});
  const lots=(auc?.lots??[]).map(lot=>({
    lotId:lot.lotId,
    sellerAccountId:lot.sellerAccountId,
    sellerName:nameOf(lot.sellerAccountId),
    sellerRole:roleOf(lot.sellerAccountId),
    title:lot.title,
    story:lot.story,
    assetId:lot.assetId,
    imageUrl:lot.imageUrl,
    thumbUrl:lot.thumbUrl,
    submittedAt:lot.submittedAt?new Date(lot.submittedAt).toISOString():new Date(0).toISOString(),
    bidHistory:(lot.bidHistory??[]).map(bid=>({accountId:bid.accountId,displayName:nameOf(bid.accountId),price:Number(bid.price)||0,bidAt:bid.bidAt?new Date(bid.bidAt).toISOString():new Date(0).toISOString()})),
    winnerAccountId:lot.winnerAccountId,
    winnerName:lot.winnerAccountId?nameOf(lot.winnerAccountId):null,
    soldPrice:lot.soldPrice!=null?Number(lot.soldPrice):null,
    soldAt:lot.soldAt?new Date(lot.soldAt).toISOString():null,
    sold:Boolean(lot.sold)
  }));
  const results=(game?.publicState.results??[]) as Array<{accountId:string;score?:number}>;
  const richSorted=[...ready].map(member=>({score:results.find(row=>row.accountId===member.accountId)?.score??0,accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,wallet:roundHistory2(finalWallets[member.accountId]??0),delta:roundHistory2((finalWallets[member.accountId]??0)-(initialBudgets[member.accountId]??0)),winner:false})).sort((a,b)=>b.wallet-a.wallet);
  const bestWallet=richSorted[0]?.wallet??0;richSorted.forEach(item=>{item.winner=item.wallet===bestWallet&&bestWallet>0;});
  const auctionRanking=lots.filter(lot=>lot.sold&&lot.soldPrice!=null).map(lot=>({lotId:lot.lotId,title:lot.title,sellerName:lot.sellerName,buyerName:lot.winnerName,soldPrice:lot.soldPrice as number})).sort((a,b)=>b.soldPrice-a.soldPrice);
  return {initialBudgets,finalWallets,lots,richRanking:richSorted,auctionRanking};
}
function roundHistory2(value:number){return Math.round((value+Number.EPSILON)*100)/100;}

function buildStoryHistory(room:RoomSnapshot,game:RoomSnapshot['game']|null){
  const story=game?.privateState?.story as Partial<StoryState>|undefined;
  const ready=story?.participants??room.members.filter(m=>m.ready);
  const nameOf=(id:string)=>ready.find(m=>m.accountId===id)?.displayName??'已离开玩家';
  const roleOf=(id:string)=>ready.find(m=>m.accountId===id)?.playerRole??'未知角色';
  const voteCounts:Record<string,number>={};Object.values(story?.votes??{}).forEach(v=>{voteCounts[v.targetAccountId]=(voteCounts[v.targetAccountId]??0)+1;});
  const segments=(story?.segments??[]).map(seg=>({...seg,displayName:nameOf(seg.accountId),playerRole:roleOf(seg.accountId),taskCompleted:Boolean(seg.taskCompleted),voteCount:voteCounts[seg.accountId]??0,score:story?.points?.[seg.accountId]??0,submittedAt:seg.submittedAt?new Date(seg.submittedAt).toISOString():null}));
  const votes=Object.entries(story?.votes??{}).map(([voterAccountId,vote])=>({voterAccountId,voterName:nameOf(voterAccountId),targetAccountId:vote.targetAccountId,targetName:nameOf(vote.targetAccountId)}));
  const scores=ready.map(p=>story?.points?.[p.accountId]??0),best=Math.max(...scores),worst=Math.min(...scores);
  const results=ready.map(p=>({accountId:p.accountId,displayName:p.displayName,playerRole:p.playerRole,points:story?.points?.[p.accountId]??0,winner:(story?.points?.[p.accountId]??0)===best,loser:best!==worst&&(story?.points?.[p.accountId]??0)===worst})).sort((a,b)=>b.points-a.points);
  return {opening:story?.opening??'',endingHint:story?.endingHint,ending:story?.ending??'',segments,votes,results,participants:story?.participants,order:story?.order,tasks:story?.tasks,approvals:story?.approvals,rulings:story?.rulings,details:story?.details};
}

function buildWitchHistory(room:RoomSnapshot,game:RoomSnapshot['game'],legends:PlayerLegend[]){const witch=game?.privateState?.witch as WitchState|undefined;const deposits=witch?.deposits??{};const investigations=witch?.investigations??{};const cells:WitchHistoryCell[]=Array.from({length:25},(_,cell)=>{const burials=Object.entries(deposits).filter(([,deposit])=>deposit.cell===cell).map(([accountId,deposit])=>{const member=room.members.find(item=>item.accountId===accountId);return {accountId,displayName:member?.displayName??'已离开玩家',playerRole:member?.playerRole??'未知角色',punishment:deposit.punishment,buriedAt:timestamp(deposit.buriedAt)};});const clicks=Object.entries(investigations).flatMap(([accountId,reveals])=>{const matching=reveals.filter(reveal=>reveal.cell===cell);if(!matching.length)return [];const member=room.members.find(item=>item.accountId===accountId);const legend=legends.find(item=>item.accountId===accountId);return [{accountId,displayName:member?.displayName??matching[0].investigatedByName??'已离开玩家',playerRole:member?.playerRole??'未知角色',color:legend?.color??'#AAA9B2',initial:legend?.initial??'玩',clickedAt:timestamp(matching[0].investigatedAt),hit:matching.some(item=>item.hit)}];});return {cell,state:burials.length?'hit':clicks.length?'safe':'untouched',burials,clicks};});return {cells,buriedCount:Object.keys(deposits).length,investigatorCount:Object.keys(investigations).length};}

function sessionState(session:GameSessionRecord|null):PersistedSessionState|undefined{return session?.state as PersistedSessionState|undefined;}
function timestamp(value:number|undefined){return value?new Date(value).toISOString():null;}
function timelineSummary(gameId:PartyTimelineItem['gameId'],status:PartyTimelineItem['status'],session:GameSessionRecord|null){if(status==='completed')return `${GAME_DEFINITIONS[gameId].name}已完成 · 点击查看完整经历`;if(status==='current')return `${GAME_DEFINITIONS[gameId].name}正在进行 · 点击查看实时总览`;if(status==='next')return `${GAME_DEFINITIONS[gameId].minPlayers}+ 人 · ${GAME_DEFINITIONS[gameId].shortRule}`;return session?'等待继续':`${GAME_DEFINITIONS[gameId].minPlayers}+ 人 · ${GAME_DEFINITIONS[gameId].shortRule}`;}
function historySummary(gameId:PartyTimelineItem['gameId'],state:PersistedSessionState|undefined,settled:boolean){if(!settled)return `${GAME_DEFINITIONS[gameId].name}正在进行，当前内容已按你的身份过滤。`;if(gameId==='dont'){const counts=state?.runtime?.dontWordCounts??{};const total=Object.values(counts).reduce((sum,value)=>sum+value,0);return `本轮共使用 ${total} 个词汇。`;}if(gameId==='must'){const changes=Object.values(state?.runtime?.mustCardChanges??{}).reduce((sum,value)=>sum+value,0);const triggers=Object.values(state?.runtime?.mustTriggerCounts??{}).reduce((sum,value)=>sum+value,0);return `本轮共成功触发 ${triggers} 次，强制更换 ${changes} 张卡片。`;}if(gameId==='witch'){const witch=state?.game?.privateState?.witch as WitchState|undefined;const revealedCells=new Set(Object.values(witch?.investigations??{}).flat().map(item=>item.cell)).size;return `共埋下 ${Object.keys(witch?.deposits??{}).length} 个惩罚，共同翻开 ${revealedCells} 个格子并采完全部毒药。`;}if(gameId==='truth'){const truth=state?.game?.privateState?.truth as TruthState|undefined;return `全员完成 1 轮角色人设推理，共 ${truth?.rounds?.length??0} 人陈述。`;}if(gameId==='auction'){const auc=state?.game?.privateState?.auction as AuctionState|undefined;const soldCount=(auc?.lots??[]).filter(lot=>lot.sold).length;return `共上拍 ${auc?.lots?.length??0} 件随身物品，成交 ${soldCount} 件。`;}if(gameId==='story'){const story=state?.game?.privateState?.story as StoryState|undefined;const segCount=story?.segments?.length??0;return `全员完成 ${segCount} 段故事接龙，投票选出最佳段落。`;}if(gameId==='shopping'){const shop=state?.game?.privateState?.shopping as ShoppingState|undefined;return `共 ${Object.keys(shop?.purchases??{}).length} 人完成聚会采购任务。`;}return `${GAME_DEFINITIONS[gameId].name}已结算，点击记录可回看本场发生的事情。`;}
