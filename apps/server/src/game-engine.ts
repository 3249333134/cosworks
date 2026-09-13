import { randomUUID } from 'node:crypto';
import { ensureStoryGame, storyState, storyPrivate, storyOverview, storyPublic, handleStoryAction, advanceStory, finishStory } from './story-engine.js';
import { ensureShoppingGame, handleShoppingAction, previousAuctionWallets, refreshShoppingPublic, shoppingPrivate, shoppingResults, shoppingState } from './shopping-engine.js';
import { abortUndercover, ensureUndercover, handleUndercover, undercoverState, undercoverView } from './undercover-engine.js';
export { ensureStoryGame } from './story-engine.js';
import { buildChallenge, GAME_DEFINITIONS, validateChallenge, type AuctionBidOverview, type AuctionLotOverview, type Challenge, type GameAction, type GameId, type GameOverview, type GameSnapshot, type IpRole, type Mbti, type RoomSnapshot, type StorySegmentOverview } from '@ruxiju/shared';

interface Runtime { challenges:Record<string,Challenge>; completed:Set<string>; processed:Set<string>; usedDontContents:Set<string>; dontWordCounts:Record<string,number>; dontWordHistory:Record<string,string[]>; mustTriggerCounts:Record<string,number>; mustCardChanges:Record<string,number>; mustChallengeHistory:Record<string,string[]> }
export interface PersistedRuntime { challenges:Record<string,Challenge>; completed:string[]; usedDontContents:string[]; dontWordCounts:Record<string,number>; dontWordHistory:Record<string,string[]>; mustTriggerCounts:Record<string,number>; mustCardChanges:Record<string,number>; mustChallengeHistory:Record<string,string[]> }
const runtimes = new Map<string,Runtime>();

/** Fisher–Yates 洗牌，返回新数组（不修改入参） */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface WitchDeposit { cell:number; punishment:string; buriedAt:number }
interface WitchReveal { cell:number; hit:boolean; investigatedByAccountId:string; investigatedByName:string; investigatedAt:number; buriedByAccountId?:string; buriedByName?:string; punishment?:string }
interface WitchState { boardSize:number; currentRound:number; deposits:Record<string,WitchDeposit>; investigations:Record<string,WitchReveal[]>; lastActionAt:Record<string,number> }
interface TruthSubmission { statements:[string,string,string]; falseIndex:number; submittedAt:number }
interface TruthVote { statementIndex:number; votedAt:number }
interface TruthRound { speakerAccountId:string; statements:[string,string,string]; falseIndex:number; votes:Record<string,TruthVote>; revealedAt:number }
interface TruthState { stage:'setup'|'voting'|'reveal'|'complete'; submissions:Record<string,TruthSubmission>; order:string[]; speakerIndex:number; votes:Record<string,TruthVote>; rounds:TruthRound[]; points:Record<string,number> }

interface DrawState { aliases?:string[]; correct?:boolean; word:string; order:string[]; currentIndex:number; drawing:string|null; drawings:string[]; liveDrawing:string|null; stage:'drawing'|'guessing'|'reveal'; guess:string|null; }
const DRAW_WORDS=['猫','狗','飞机','火锅','手机','雨伞','太阳','月亮','树','鱼','蛋糕','自行车','电视','眼镜','帽子','鞋子','钥匙','手表','电脑','吉他'];

interface AuctionBid { bidId:string; accountId:string; price:number; bidAt:number }
interface AuctionLot { lotId:string; sellerAccountId:string; title:string; story:string; assetId:string; imageUrl:string; thumbUrl:string; submittedAt:number; bidHistory:AuctionBid[]; winnerAccountId:string|null; soldPrice:number|null; soldAt:number|null; sold:boolean }
interface AuctionState { stage:'init'|'setup'|'preview'|'bidding'|'complete'; budgets:Record<string,number>; wallets:Record<string,number>; lots:AuctionLot[]; lotOrder:string[]; currentLotIndex:number|null; topBid:AuctionBid|null; budgetSubmitted:Record<string,true>; itemSubmitted:Record<string,true>; itemsByAccount:Record<string,string[]>; processedActions?:Record<string,true> }
const PRICE_INCREMENT = 0.1;

function runtime(room:RoomSnapshot):Runtime { let value=runtimes.get(room.id); if(!value){value={challenges:{},completed:new Set(),processed:new Set(),usedDontContents:new Set(),dontWordCounts:{},dontWordHistory:{},mustTriggerCounts:{},mustCardChanges:{},mustChallengeHistory:{}};runtimes.set(room.id,value);} return value; }

export function startGame(room:RoomSnapshot, gameId:GameId, profiles:Map<string,{mbti:Mbti;role:IpRole}>, generatedChallenges:Map<string,Challenge>=new Map(), planItemId:string|null=null, shoppingWallets:Record<string,number>|null=null, options?:{rounds?:number;boardSize?:number}):RoomSnapshot {
  const definition=GAME_DEFINITIONS[gameId]; const active=room.members.filter(member=>member.ready);const auctionWallets=gameId==='shopping'?(shoppingWallets??previousAuctionWallets(room)):null;
  if(active.length<definition.minPlayers)throw new Error(`至少需要 ${definition.minPlayers} 位已准备玩家`);
  
  const state=runtime(room);state.challenges={};state.completed.clear();state.processed.clear();state.usedDontContents.clear();state.dontWordCounts={};state.dontWordHistory={};state.mustTriggerCounts={};state.mustCardChanges={};state.mustChallengeHistory={};
  active.forEach(member=>{const profile=profiles.get(member.accountId);if(profile&&gameId!=='truth'&&gameId!=='story'&&gameId!=='undercover')state.challenges[member.accountId]=generatedChallenges.get(member.accountId)??buildChallenge({gameId,mbti:profile.mbti,role:profile.role,playerCount:active.length,cameraAvailable:false});});
  if(gameId==='dont')active.forEach(member=>{const challenge=state.challenges[member.accountId];if(challenge){state.usedDontContents.add(challenge.content);state.dontWordCounts[member.accountId]=1;state.dontWordHistory[member.accountId]=[challenge.content];}});
  if(gameId==='must')active.forEach(member=>{const challenge=state.challenges[member.accountId];state.mustTriggerCounts[member.accountId]=0;state.mustCardChanges[member.accountId]=0;state.mustChallengeHistory[member.accountId]=challenge?[challenge.content]:[];});
  const config=normalizeGameConfig(gameId,options);
  room.currentGame=gameId;room.status='running';room.game={sessionId:randomUUID(),planItemId,gameId,phase:'playing',round:1,prompt:definition.shortRule,primaryAction:definition.primaryAction,endsAt:Date.now()+definition.durationMinutes*60_000,scores:Object.fromEntries(active.map(member=>[member.accountId,member.score])),publicState:{completed:0,total:active.length,lastActionAt:Date.now()},config};
  ensureWitchGame(room);
  ensureTruthGame(room);
  ensureDrawGame(room);
  ensureAuctionGame(room);
  ensureStoryGame(room);
  ensureShoppingGame(room,auctionWallets);
  ensureUndercover(room);
  if(gameId==='story'){const story=storyState(room)!;story.participants.forEach(p=>{const role=profiles.get(p.accountId)?.role;if(role)p.persona=[role.personaTags.join('、'),role.quote,role.signatureAction,role.ability].filter(Boolean).join('；')||role.name;});ensureStoryGame(room);}
  return room;
}

function normalizeGameConfig(gameId:GameId,options?:{rounds?:number;boardSize?:number}):{rounds?:number;boardSize?:number}{
  const config:{rounds?:number;boardSize?:number}={};
  const rounds=Number(options?.rounds);
  if(Number.isInteger(rounds)&&rounds>=1)config.rounds=Math.min(rounds,99);
  if(gameId==='witch'){const size=Number(options?.boardSize);if(Number.isInteger(size)&&size>=3&&size<=10)config.boardSize=size;else config.boardSize=5;}
  return config;
}

export function ensureTruthGame(room:RoomSnapshot):RoomSnapshot {
  if(room.currentGame!=='truth'||!room.game)return room;
  if(room.game.privateState?.truth)return room;
  const active=room.members.filter(member=>member.ready);
  room.game.primaryAction='提交三条角色描述';
  room.game.publicState={stage:'setup',submittedCount:0,total:active.length,lastActionAt:Date.now()};
  room.game.privateState={truth:{stage:'setup',submissions:{},order:shuffle(active.map(m=>m.accountId)),speakerIndex:0,votes:{},rounds:[],points:{}} satisfies TruthState};
  return room;
}

export function ensureDrawGame(room:RoomSnapshot):RoomSnapshot {
  if(room.currentGame!=='draw'||!room.game)return room;
  if(room.game.privateState?.draw)return room;
  const active=room.members.filter(member=>member.ready);
  const order=shuffle(active.map(m=>m.accountId));
  const word=DRAW_WORDS[Math.floor(Math.random()*DRAW_WORDS.length)];
  room.game.primaryAction='接龙作画中';
  room.game.publicState={stage:'drawing',currentIndex:0,total:order.length,drawing:null,drawings:[],liveDrawing:null,lastActionAt:Date.now()};
  room.game.privateState={draw:{word,order,currentIndex:0,drawing:null,drawings:[],liveDrawing:null,stage:'drawing',guess:null} satisfies DrawState};
  return room;
}

export function restartDrawGame(room:RoomSnapshot):RoomSnapshot {
  if(room.currentGame!=='draw'||!room.game)throw new Error('当前不是你画我猜');
  const active=room.members.filter(member=>member.ready);
  const order=shuffle(active.map(m=>m.accountId));
  const word=DRAW_WORDS[Math.floor(Math.random()*DRAW_WORDS.length)];
  room.game.phase='playing';room.game.endsAt=Date.now()+GAME_DEFINITIONS.draw.durationMinutes*60_000;
  room.game.primaryAction='接龙作画中';
  room.game.publicState={stage:'drawing',currentIndex:0,total:order.length,drawing:null,drawings:[],liveDrawing:null,lastActionAt:Date.now()};
  room.game.privateState={draw:{word,order,currentIndex:0,drawing:null,drawings:[],liveDrawing:null,stage:'drawing',guess:null} satisfies DrawState};
  return room;
}

export function ensureWitchGame(room:RoomSnapshot):RoomSnapshot {
  if(room.currentGame!=='witch'||!room.game)return room;
  const boardSize=room.game.config?.boardSize??5;
  if(room.game.privateState?.witch){const witch=witchState(room);const reveals=allWitchReveals(witch);const {revealedCells:_revealed,currentTurnAccountId:_turnId,currentTurnName:_turnName,lastReveal:_lastReveal,completedInvestigators:_completed,...safePublicState}=room.game.publicState;room.game.publicState={...safePublicState,foundPoisonCount:foundWitchOwners(reveals).size,revealedCellCount:new Set(reveals.map(item=>item.cell)).size,boardSize};return room;}
  room.game.primaryAction='埋下这个惩罚';
  room.game.publicState={stage:'bury',buriedCount:0,total:room.members.filter(member=>member.ready).length,foundPoisonCount:0,revealedCellCount:0,boardSize,lastActionAt:Date.now()};
  room.game.privateState={witch:{boardSize,currentRound:1,deposits:{},investigations:{},lastActionAt:{}} satisfies WitchState};
  return room;
}

export function ensureAuctionGame(room:RoomSnapshot):RoomSnapshot{
  if(room.currentGame!=='auction'||!room.game)return room;
  if(room.game.privateState?.auction){refreshAuctionPublicState(room,auctionState(room)!,room.members.filter(m=>m.ready));return room;}
  const active=room.members.filter(m=>m.ready);
  const wallets:Record<string,number>={};active.forEach(m=>{wallets[m.accountId]=0;});
  room.game.primaryAction='输入你的初始资金';
  const budgets:Record<string,number>={};active.forEach(m=>{budgets[m.accountId]=0;});
  const aucState:AuctionState={stage:'init',budgets,wallets,lots:[],lotOrder:[],currentLotIndex:null,topBid:null,budgetSubmitted:{},itemSubmitted:{},itemsByAccount:{}};
  room.game.privateState={auction:aucState};
  room.game.publicState={};
  refreshAuctionPublicState(room,aucState,active);
  return room;
}

export function handleGameAction(room:RoomSnapshot, accountId:string, input:GameAction):RoomSnapshot {
  if(!room.game||room.currentGame!==input.gameId)throw new Error('当前没有这款游戏'); if(room.status!=='running')throw new Error('游戏当前不可操作');
  if(input.gameId==='auction'){const auc=auctionState(room);if(auc?.processedActions?.[input.actionId])throw new Error('重复请求，请勿重复提交');const result=handleAuctionAction(room,accountId,input);if(auc){auc.processedActions??={};auc.processedActions[input.actionId]=true;}return result;}
  if(input.gameId==='story'){const result=handleStoryAction(room,accountId,input);if(storyState(room)?.stage==='complete')settleGame(room);return result;}
  if(input.gameId==='shopping'){const result=handleShoppingAction(room,accountId,input);if(shoppingState(room)?.stage==='complete')settleGame(room);return result;}
  if(input.gameId==='undercover'){const result=handleUndercover(room,accountId,input);if(undercoverState(room)?.stage==='complete')settleGame(room);return result;}
  const state=runtime(room); if(state.processed.has(input.actionId))return room; state.processed.add(input.actionId);
  const member=room.members.find(item=>item.accountId===accountId);if(!member)throw new Error('你不在这个房间');
  if(input.gameId==='witch')return handleWitchAction(room,accountId,input);
  if(input.gameId==='truth')return handleTruthAction(room,accountId,input);
  if(input.gameId==='draw')return handleDrawAction(room,accountId,input);


  if(input.gameId==='must'&&(input.action==='must-triggered'||input.action==='primary'||input.action==='complete')){state.mustTriggerCounts[accountId]=(state.mustTriggerCounts[accountId]??0)+1;room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};return room;}
  if(input.action==='complete'||input.action==='primary'){if(!state.completed.has(accountId)){state.completed.add(accountId);member.score+=10;room.game.scores[accountId]=member.score;}}
  room.game.publicState={...room.game.publicState,completed:state.completed.size,total:room.members.filter(item=>item.ready).length,lastActionAt:Date.now()};
  return room;
}

export function playerSnapshot(room:RoomSnapshot,accountId:string):RoomSnapshot {
  const copy=structuredClone(room);
  if(copy.game){
    const state=runtime(room),challenge=state.challenges[accountId],witch=witchState(room),deposit=witch?.deposits[accountId],revealedCells=allWitchReveals(witch),truth=truthState(room),submission=truth?.submissions[accountId],auc=auctionState(room),story=storyState(room),shopping=shoppingState(room),undercover=undercoverState(room);
    if(story)copy.game.publicState={...storyPublic(story),lastActionAt:room.game?.publicState.lastActionAt};
    copy.game.privateState={
      ...(auc?{auction:{hasBudget:Boolean(auc.budgetSubmitted[accountId]),budget:auc.budgetSubmitted[accountId]?auc.budgets[accountId]:null,itemSubmitted:Boolean(auc.itemsByAccount[accountId]),lastActionAt:Number(copy.game.publicState.lastActionAt)||null}}:{}),
      ...(challenge?{challenge}:{}),...(copy.currentGame==='dont'?{dont:{wordCount:state.dontWordCounts[accountId]??1}}:{}),...(copy.currentGame==='must'?{must:{triggerCount:state.mustTriggerCounts[accountId]??0,cardChangeCount:state.mustCardChanges[accountId]??0}}:{}),
      ...(witch?{witch:{hasBuried:Boolean(deposit),ownCell:deposit?.cell??null,punishment:deposit?.punishment??null,revealedCells,completed:copy.game.phase==='settled',lastActionAt:Number(copy.game.publicState.lastActionAt)||null}}:{}),
      ...(truth?{truth:{hasSubmitted:Boolean(submission),submission:submission?.statements??null,falseIndex:submission?.falseIndex??null,ownVote:truth.votes[accountId]?.statementIndex??null,points:truth.points[accountId]??0}}:{}),
      ...(story?{story:storyPrivate(room,accountId)}:{}),...(shopping?{shopping:shoppingPrivate(room,accountId)}:{}),...(undercover?{undercover:undercoverView(room,accountId)}:{}),
      ...(drawState(room)?(()=>{const draw=drawState(room)!;const orderIndex=draw.order.indexOf(accountId);const isHostDrawer=orderIndex===0;const isGuesser=orderIndex===draw.order.length-1;const isReveal=draw.stage==='reveal';const isGuessing=draw.stage==='guessing';const canSeeLive=isReveal||isGuessing||orderIndex<=draw.currentIndex;const canSeeSubmitted=isReveal||isGuessing||orderIndex<=draw.currentIndex;const visibleDrawings=isReveal||isGuessing?draw.drawings:(orderIndex<=draw.currentIndex?draw.drawings.slice(0,draw.currentIndex):[]);return {draw:{stage:draw.stage,order:draw.order,currentIndex:draw.currentIndex,drawing:canSeeSubmitted?draw.drawing:null,drawings:visibleDrawings,liveDrawing:canSeeLive?draw.liveDrawing:null,word:(draw.stage==='reveal'||isHostDrawer)?draw.word:null,guess:draw.guess,correct:draw.stage==='reveal'?draw.correct??false:null,isHostDrawer,isGuesser,isCurrentDrawer:draw.stage==='drawing'&&orderIndex===draw.currentIndex}};})():{})
    };
  }
  return copy;
}

export function usedDontContents(room:RoomSnapshot){return [...runtime(room).usedDontContents];}
export function usedMustContents(room:RoomSnapshot){const state=runtime(room);return [...new Set(Object.values(state.mustChallengeHistory).flat())];}
export function replacePlayerChallenge(room:RoomSnapshot,accountId:string,challenge:Challenge,countMustChange=false){const state=runtime(room);state.challenges[accountId]=challenge;if(room.currentGame==='dont'){state.usedDontContents.add(challenge.content);state.dontWordCounts[accountId]=(state.dontWordCounts[accountId]??1)+1;state.dontWordHistory[accountId]=[...(state.dontWordHistory[accountId]??[]),challenge.content];}if(room.currentGame==='must'){state.mustChallengeHistory[accountId]=[...(state.mustChallengeHistory[accountId]??[]),challenge.content];if(countMustChange)state.mustCardChanges[accountId]=(state.mustCardChanges[accountId]??0)+1;}if(room.game)room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};}

export function setPlayerChallenge(room:RoomSnapshot,accountId:string,content:string){const state=runtime(room);const current=state.challenges[accountId];if(!current)throw new Error('该玩家没有当前词牌');const challenge={...current,id:randomUUID(),content:content.trim()};if(!validateChallenge(challenge))throw new Error('词汇不符合安全规则');replacePlayerChallenge(room,accountId,challenge);}
export function setDontWordCount(room:RoomSnapshot,accountId:string,value:number){const state=runtime(room);if(!state.challenges[accountId])throw new Error('该玩家没有当前词牌');state.dontWordCounts[accountId]=Math.max(1,Math.min(999,Math.trunc(value)));if(room.game)room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};}
export function advanceGameStage(room:RoomSnapshot){
  if(!room.game)throw new Error('没有进行中的游戏');
  if(room.currentGame==='witch')throw new Error('女巫毒药只能按棋盘规则推进');
  if(room.currentGame==='draw')throw new Error('你画我猜按接龙顺序自动推进，无需手动推进');
  if(room.currentGame==='truth'){
    const truth=truthState(room);if(!truth)throw new Error('两真一假尚未初始化');
    const active=room.members.filter(member=>member.ready);
    if(truth.stage==='setup'){
      if(Object.keys(truth.submissions).length===0)throw new Error('还没有人提交角色描述，至少先完成自己的三条描述');
      beginTruthRound(room,truth,active);
    }else if(truth.stage==='voting'){
      revealTruthRound(room,truth,active);
    }else if(truth.stage==='reveal'){
      truth.speakerIndex+=1;truth.votes={};room.game.round=truth.speakerIndex+1;
      const totalRounds=active.length*(room.game.config?.rounds??1);
      if(truth.speakerIndex>=totalRounds){truth.stage='complete';settleGame(room);}else beginTruthRound(room,truth,active);
      room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};
      return;
    }
    room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};
    return;
  }
  if(room.currentGame==='auction'){
    const auc=auctionState(room);if(!auc)throw new Error('拍卖会尚未初始化');
    const active=room.members.filter(m=>m.ready);
    if(auc.stage==='init'){auc.stage='setup';room.game!.primaryAction='上传你的随身物品';refreshAuctionPublicState(room,auc,active);}
    else if(auc.stage==='setup'){if(auc.lots.length===0)throw new Error('还没有人上传物品');auc.stage='preview';refreshAuctionPublicState(room,auc,active);}
    else if(auc.stage==='preview'){beginAuctionLot(room,auc,active,0);}
    else if(auc.stage==='bidding'){throw new Error('请由当前拍品的出售人担任拍卖师，选择落锤或流拍');}
    else if(auc.stage==='complete')throw new Error('拍卖会已经结束');
    room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};
    return;
  }
  if(room.currentGame==='story'){advanceStory(room);if(storyState(room)?.stage==='complete')settleGame(room);return;}
  if(room.currentGame==='shopping')throw new Error('等待所有人登记采购结果，或由主持直接结束本场');
  if(room.currentGame==='undercover')throw new Error('请在卧底舞台中完成发言、投票或结束投票');
  const totalRounds=room.game.config?.rounds??1;
  room.game.round+=1;
  if(room.game.round>totalRounds){settleGame(room);}
  else {room.game.phase=room.game.phase==='playing'?'review':'playing';room.game.publicState={...room.game.publicState,lastActionAt:Date.now()};}
}

export function serializeRuntime(room:RoomSnapshot):PersistedRuntime {const state=runtime(room);return {challenges:structuredClone(state.challenges),completed:[...state.completed],usedDontContents:[...state.usedDontContents],dontWordCounts:structuredClone(state.dontWordCounts),dontWordHistory:structuredClone(state.dontWordHistory),mustTriggerCounts:structuredClone(state.mustTriggerCounts),mustCardChanges:structuredClone(state.mustCardChanges),mustChallengeHistory:structuredClone(state.mustChallengeHistory)};}
export function restoreRuntime(room:RoomSnapshot,value:PersistedRuntime|undefined){if(!value)return;const state=runtime(room);state.challenges=structuredClone(value.challenges??{});state.completed=new Set(value.completed??[]);state.usedDontContents=new Set(value.usedDontContents??[]);state.dontWordCounts=structuredClone(value.dontWordCounts??{});state.dontWordHistory=structuredClone(value.dontWordHistory??{});state.mustTriggerCounts=structuredClone(value.mustTriggerCounts??{});state.mustCardChanges=structuredClone(value.mustCardChanges??{});state.mustChallengeHistory=structuredClone(value.mustChallengeHistory??{});const story=storyState(room);if(story?.source==='legacy')for(const p of story.participants)story.tasks[p.accountId]??=state.challenges[p.accountId]?.content??'';}

export function gameOverview(room:RoomSnapshot,accountId:string):GameOverview|null {if(!room.game||!room.currentGame)return null;const state=runtime(room);const actor=room.members.find(member=>member.accountId===accountId);if(!actor)return null;const isHost=Boolean(actor.hostRole);const total=room.members.filter(member=>member.ready).length;const completed=state.completed.size;const base:GameOverview={gameId:room.currentGame,phase:room.game.phase,round:room.game.round,endsAt:room.game.endsAt,isHost,progressLabel:`${completed}/${total} 人已完成`,players:room.members.filter(member=>member.ready).map(member=>({accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,completed:state.completed.has(member.accountId)}))};
  if(room.currentGame==='dont'){base.progressLabel=`本轮共使用 ${Object.values(state.dontWordCounts).reduce((sum,value)=>sum+value,0)} 个词汇`;base.players=base.players.map(player=>{const own=player.accountId===accountId;const history=state.dontWordHistory[player.accountId]??[];return {...player,wordCount:state.dontWordCounts[player.accountId]??1,currentWord:isHost||!own?state.challenges[player.accountId]?.content??null:null,currentWordHidden:!isHost&&own,usedWords:history.slice(0,-1)};});}
  if(room.currentGame==='must'){base.progressLabel='按换卡少、成功触发多排名';base.players=base.players.map(player=>({...player,triggerCount:state.mustTriggerCounts[player.accountId]??0,cardChangeCount:state.mustCardChanges[player.accountId]??0}));}
  if(room.currentGame==='witch'){const witch=witchState(room);const boardSize=witch?.boardSize??5;const cellCount=boardSize*boardSize;const revealed=allWitchReveals(witch);const ownDeposit=witch?.deposits[accountId];const stage=String(room.game.publicState.stage||'bury');const totalRounds=room.game.config?.rounds??1;const roundLabel=totalRounds>1?` · 第 ${witch?.currentRound??1}/${totalRounds} 轮`:'';base.progressLabel=(stage==='bury'?`${Number(room.game.publicState.buriedCount)||0}/${total} 人已埋好`:`已采到 ${Number(room.game.publicState.foundPoisonCount)||0}/${Number(room.game.publicState.buriedCount)||total} 份毒药`)+roundLabel;base.witch={stage,buriedCount:Number(room.game.publicState.buriedCount)||0,total,currentTurnName:null,cells:Array.from({length:cellCount},(_,cell)=>{const cellReveals=revealed.filter(item=>item.cell===cell);const hit=cellReveals.find(item=>item.hit);if(cellReveals.length)return {cell,state:hit?'hit':'safe',...(hit?{buriedByName:hit.buriedByName,punishment:hit.punishment}:{})};if(ownDeposit?.cell===cell&&stage==='bury')return {cell,state:'own',punishment:ownDeposit.punishment};return {cell,state:'hidden'};})};}
  if(room.currentGame==='truth'){const truth=truthState(room);const roundsPerPlayer=room.game.config?.rounds??1;const totalRounds=total*roundsPerPlayer;const stage=(truth?.stage??'setup') as 'setup'|'voting'|'reveal'|'complete';const submittedCount=Object.keys(truth?.submissions??{}).length;const roundNumber=Math.min((truth?.speakerIndex??0)+1,totalRounds);const speakerAccountId=truth&&truth.order.length?truth.order[truth.speakerIndex%truth.order.length]:undefined;const speaker=speakerAccountId?room.members.find(m=>m.accountId===speakerAccountId):undefined;const statements=(truth?room.game.publicState.statements as string[]|undefined:undefined)??null;const votesByStatement=[0,0,0];Object.values(truth?.votes??{}).forEach(v=>{if(v.statementIndex>=0&&v.statementIndex<=2)votesByStatement[v.statementIndex]+=1;});const ps=room.game.publicState;base.progressLabel=stage==='setup'?`${submittedCount}/${total} 人已写好角色描述`:stage==='complete'?`全员已完成 ${roundsPerPlayer} 轮人设推理`:`第 ${roundNumber}/${totalRounds} 位 · ${String(ps.speakerName||'当前玩家')} 陈述中`;base.players=base.players.map(player=>({...player,completed:Boolean(truth?.submissions[player.accountId])}));base.truth={stage,submittedCount,total,roundNumber,totalRounds,speakerName:speaker?.displayName??String(ps.speakerName||null),speakerRole:speaker?.playerRole??String(ps.speakerRole||null),statements,falseIndex:stage==='reveal'||stage==='complete'?(Number(ps.falseIndex)>=0?Number(ps.falseIndex):null):null,votedCount:Number(ps.votedCount)||0,voterCount:Number(ps.voterCount)||Math.max(0,total-1),points:structuredClone(truth?.points??{}),votesByStatement};}
  if(room.currentGame==='auction'){const auc=auctionState(room);const ps=room.game.publicState as Record<string,unknown>;const stage=(auc?.stage??'init') as 'init'|'setup'|'preview'|'bidding'|'complete';const budgetsSubmitted=Number(ps.budgetsSubmitted)||0;const itemsSubmitted=Number(ps.itemsSubmitted)||0;const roundNumber=Number(ps.roundNumber)||0;const totalRounds=Number(ps.totalRounds)||auc?.lots.length||0;const psLots=Array.isArray(ps.lots)?(ps.lots as Array<Record<string,unknown>>):[];const psLot=ps.currentLot as Record<string,unknown>|null|undefined;const psBid=ps.topBid as Record<string,unknown>|null|undefined;const psWallets=ps.wallets as Record<string,number>|null|undefined;const psPreview=ps.rankingsPreview as {richRanking?:Array<{accountId:string;displayName:string;wallet:number}>;auctionRanking?:Array<{lotId:string;title:string;soldPrice:number|null;sellerName:string;winnerName:string|null}>}|null|undefined;const psOrder=Array.isArray(ps.lotOrder)?(ps.lotOrder as string[]):[];const psBidHistory=Array.isArray(ps.bidHistory)?(ps.bidHistory as Array<Record<string,unknown>>):[];const psItemsByAccount=ps.itemsByAccount as Record<string,string>|null|undefined;const wallets:Record<string,number>={};base.players.forEach(player=>{wallets[player.accountId]=round2(Number(psWallets?.[player.accountId]??auc?.wallets?.[player.accountId]??0));});const toLotOverview=(o:Record<string,unknown>|null|undefined):AuctionLotOverview|null=>o?{lotId:String(o.lotId),sellerAccountId:String(o.sellerAccountId),sellerName:o.sellerName!=null?String(o.sellerName):null,sellerRole:o.sellerRole!=null?String(o.sellerRole):null,title:o.title!=null?String(o.title):null,story:o.story!=null?String(o.story):null,assetId:o.assetId!=null?String(o.assetId):null,imageUrl:o.imageUrl!=null?String(o.imageUrl):null,thumbUrl:o.thumbUrl!=null?String(o.thumbUrl):null,submittedAt:o.submittedAt!=null?String(o.submittedAt):null,bidCount:Number(o.bidCount)||0,soldPrice:o.soldPrice!=null?Number(o.soldPrice):null,winnerAccountId:o.winnerAccountId?String(o.winnerAccountId):null,winnerName:o.winnerName?String(o.winnerName):null,sold:Boolean(o.sold)}:null;const lots:AuctionLotOverview[]=psLots.map(l=>toLotOverview(l)!).filter(Boolean);const currentLot:AuctionLotOverview|null=toLotOverview(psLot);const topBid:AuctionBidOverview|null=psBid?{accountId:String(psBid.accountId),displayName:psBid.displayName!=null?String(psBid.displayName):null,price:Number(psBid.price)||0,bidAt:psBid.bidAt!=null?String(psBid.bidAt):null}:null;const richRanking=(psPreview?.richRanking??[]).map(item=>({accountId:String(item.accountId),displayName:String(item.displayName),wallet:Number(item.wallet)||0}));const auctionRanking=(psPreview?.auctionRanking??[]).map(item=>({lotId:String(item.lotId),title:String(item.title),soldPrice:item.soldPrice!=null?Number(item.soldPrice):null,sellerName:String(item.sellerName),winnerName:item.winnerName?String(item.winnerName):null}));const bidHistory=psBidHistory.map(b=>({accountId:String(b.accountId),displayName:String(b.displayName),price:Number(b.price)||0,bidAt:String(b.bidAt)}));const itemsByAccount:Record<string,string>={};if(psItemsByAccount)for(const [k,v] of Object.entries(psItemsByAccount))itemsByAccount[String(k)]=String(v);base.players=base.players.map(player=>({...player,completed:stage==='init'?auc?.budgetSubmitted[player.accountId]??false:stage==='setup'?Boolean(auc?.itemsByAccount[player.accountId]):stage==='complete'}));type AuctionStage='init'|'setup'|'preview'|'bidding'|'complete';const labels:Record<AuctionStage,string>={init:`${budgetsSubmitted}/${total} 人已输入初始金额`,setup:`${itemsSubmitted}/${total} 人已上传随身物品`,preview:`待拍 ${totalRounds} 件 · 主持开始第一件`,bidding:currentLot?`第 ${roundNumber}/${totalRounds} 件 · ${currentLot.sellerName??''}正在介绍`:`出价中`,complete:`拍卖会结束 · 共成交 ${auctionRanking.filter(item=>item.soldPrice!=null).length}/${totalRounds||0} 件`};base.progressLabel=labels[stage];base.auction={stage,budgetsSubmitted,itemsSubmitted,total,roundNumber,totalRounds,currentLotIndex:ps.currentLotIndex!=null?Number(ps.currentLotIndex):null,currentLot,lots,lotOrder:psOrder,topBid,priceIncrement:Number(ps.priceIncrement)||0.1,wallets,bidHistory,itemsByAccount,soldCount:Number(ps.soldCount)||0,lastActionAt:ps.lastActionAt!=null?Number(ps.lastActionAt):null,rankingsPreview:{richRanking,auctionRanking}};}
  if(room.currentGame==='story'){const view=storyOverview(room,accountId);base.story=view;base.ownContent=view.ownTask??undefined;base.progressLabel=({setup:'本场选角与故事准备',relay:'按顺序接龙',reveal:'等待主持公布结局',voting:'投票选出最佳段落',review:'任务认可与规则裁定',complete:'故事已结算'})[view.stage];base.players=base.players.map(p=>({...p,completed:view.segments.some(seg=>seg.accountId===p.accountId)}));}
  if(room.currentGame==='shopping'){const shop=shoppingState(room)!;const own=shoppingPrivate(room,accountId)!;base.shopping={stage:shop.stage,completedCount:Object.keys(shop.purchases).length,total:shop.participants.length,budget:own.budget,remaining:own.remaining,ownTask:own.task,ownPurchase:own.purchase,results:shop.stage==='complete'?shoppingResults(shop):[]};base.progressLabel=shop.stage==='complete'?'全员采购完成':`${Object.keys(shop.purchases).length}/${shop.participants.length} 人已登记`;base.players=base.players.map(p=>({...p,completed:Boolean(shop.purchases[p.accountId])}));}
  if(room.currentGame==='undercover'){const view=undercoverView(room,accountId);base.undercover=view;base.ownContent=view.ownWord??undefined;base.progressLabel=view.stage==='setup'?`卧底人数 ${view.count} · 等待发词`:view.stage==='speaking'?`第 ${view.round} 轮 · 依次描述`:view.stage==='voting'?`${view.votedCount}/${view.totalVoters} 人已投票`:view.stage==='result'?'本轮投票结果':'身份已揭晓';base.players=base.players.map(p=>({...p,completed:!view.alive.includes(p.accountId)}));}
  if(room.currentGame==='draw'){const draw=drawState(room)!;const orderIndex=draw.order.indexOf(accountId);const isHostDrawer=orderIndex===0;const isGuesser=orderIndex===draw.order.length-1;const isCurrentDrawer=draw.stage==='drawing'&&orderIndex===draw.currentIndex;const turnName=draw.stage==='drawing'?(room.members.find(m=>m.accountId===draw.order[draw.currentIndex])?.displayName??'—'):(room.members.find(m=>m.accountId===draw.order[draw.order.length-1])?.displayName??'—');const _isReveal=draw.stage==='reveal';const _isGuess=draw.stage==='guessing';const _canSeeLive=_isReveal||_isGuess||orderIndex<=draw.currentIndex;const _canSeeDrawn=_isReveal||_isGuess||orderIndex<=draw.currentIndex;const _visibleDrawings=_isReveal||_isGuess?draw.drawings:draw.drawings.slice(0,Math.min(draw.currentIndex,orderIndex+1));base.draw={stage:draw.stage,currentIndex:draw.currentIndex,total:draw.order.length,turnName,order:draw.order,drawing:_canSeeDrawn?draw.drawing:null,drawings:_visibleDrawings,liveDrawing:_canSeeLive?draw.liveDrawing:null,word:draw.stage==='reveal'||isHostDrawer?draw.word:null,guess:draw.guess,correct:draw.stage==='reveal'?draw.correct??false:null,isHostDrawer,isGuesser,isCurrentDrawer};base.progressLabel=draw.stage==='drawing'?`第 ${draw.currentIndex+1}/${draw.order.length-1} 棒 · ${turnName} 作画中`:draw.stage==='guessing'?`${turnName} 猜词中`:'已揭晓';base.players=base.players.map(p=>({...p,completed:draw.stage==='reveal'}));base.ownContent=isHostDrawer?draw.word:undefined;}
  if(room.currentGame!=='dont'&&room.currentGame!=='witch'&&room.currentGame!=='auction'&&room.currentGame!=='truth'&&room.currentGame!=='story'&&room.currentGame!=='shopping'&&room.currentGame!=='undercover'&&room.currentGame!=='draw')base.ownContent=state.challenges[accountId]?.content;
  return base;
}

export function settleGame(room:RoomSnapshot):RoomSnapshot {if(!room.game)throw new Error('没有可结算游戏');if(room.game.phase==='settled')return room;const state=runtime(room);if(room.currentGame==='dont'){const results=room.members.filter(member=>member.ready).map(member=>({accountId:member.accountId,displayName:member.displayName,wordCount:state.dontWordCounts[member.accountId]??1})).sort((a,b)=>a.wordCount-b.wordCount);room.game.publicState={...room.game.publicState,results,winnerAccountIds:results.filter(item=>item.wordCount===results[0]?.wordCount).map(item=>item.accountId)};}if(room.currentGame==='must'){const results=room.members.filter(member=>member.ready).map(member=>({accountId:member.accountId,displayName:member.displayName,cardChangeCount:state.mustCardChanges[member.accountId]??0,triggerCount:state.mustTriggerCounts[member.accountId]??0})).sort((a,b)=>a.cardChangeCount-b.cardChangeCount||b.triggerCount-a.triggerCount);const best=results[0];room.game.publicState={...room.game.publicState,results,winnerAccountIds:results.filter(item=>item.cardChangeCount===best?.cardChangeCount&&item.triggerCount===best?.triggerCount).map(item=>item.accountId)};}if(room.currentGame==='truth'){const truth=truthState(room);const ready=room.members.filter(member=>member.ready);ready.forEach(member=>{const earned=truth?.points[member.accountId]??0;if(earned>0){member.score+=earned;}});const results=ready.map(member=>({accountId:member.accountId,displayName:member.displayName,playerRole:member.playerRole,points:truth?.points[member.accountId]??0})).sort((a,b)=>b.points-a.points);room.game.scores=Object.fromEntries(ready.map(member=>[member.accountId,member.score]));room.game.publicState={...room.game.publicState,stage:'complete',results,winnerAccountIds:results.filter(item=>item.points===results[0]?.points).map(item=>item.accountId)};}if(room.currentGame==='auction'){const auc=auctionState(room);if(auc){auc.stage='complete';auc.currentLotIndex=null;auc.topBid=null;refreshAuctionPublicState(room,auc,room.members.filter(m=>m.ready));}const ready=room.members.filter(m=>m.ready);const awardMap:Record<string,number>={};ready.forEach(m=>awardMap[m.accountId]=0);auc?.lots.forEach(lot=>{if(lot.sold){awardMap[lot.sellerAccountId]=(awardMap[lot.sellerAccountId]??0)+2;if(lot.winnerAccountId)awardMap[lot.winnerAccountId]=(awardMap[lot.winnerAccountId]??0)+1;}});const rich=[...ready].sort((a,b)=>(auc?.wallets[b.accountId]??0)-(auc?.wallets[a.accountId]??0));if(rich.length>=1)awardMap[rich[0].accountId]=(awardMap[rich[0].accountId]??0)+5;if(rich.length>=2)awardMap[rich[1].accountId]=(awardMap[rich[1].accountId]??0)+3;if(rich.length>=3)awardMap[rich[2].accountId]=(awardMap[rich[2].accountId]??0)+1;ready.forEach(m=>{const earned=awardMap[m.accountId]??0;if(earned>0)m.score+=earned;});const results=ready.map(m=>({accountId:m.accountId,displayName:m.displayName,playerRole:m.playerRole,wallet:round2(auc?.wallets[m.accountId]??0),delta:round2((auc?.wallets[m.accountId]??0)-(auc?.budgets[m.accountId]??0)),score:awardMap[m.accountId]??0})).sort((a,b)=>b.wallet-a.wallet);room.game.scores=Object.fromEntries(ready.map(m=>[m.accountId,m.score]));room.game.publicState={...room.game.publicState,stage:'complete',results,winnerAccountIds:results.filter(item=>item.wallet===results[0]?.wallet).map(item=>item.accountId),richRanking:results,auctionRanking:auc?auc.lots.filter(l=>l.sold&&l.soldPrice!=null).map(l=>({lotId:l.lotId,title:l.title,sellerAccountId:l.sellerAccountId,winnerAccountId:l.winnerAccountId,soldPrice:l.soldPrice})).sort((a,b)=>(b.soldPrice as number)-(a.soldPrice as number)):[]};}if(room.currentGame==='story'){const story=storyState(room)!;finishStory(room);for(const p of story.participants){const member=room.members.find(m=>m.accountId===p.accountId);if(member)member.score+=story.points[p.accountId]??0;}const results=story.participants.map(p=>({...p,points:story.points[p.accountId]??0})).sort((a,b)=>b.points-a.points);const best=results[0]?.points,worst=results.at(-1)?.points;room.game.scores=Object.fromEntries(room.members.map(m=>[m.accountId,m.score]));room.game.publicState={...room.game.publicState,results,winnerAccountIds:results.filter(p=>p.points===best).map(p=>p.accountId),loserAccountIds:best===worst?[]:results.filter(p=>p.points===worst).map(p=>p.accountId)};}if(room.currentGame==='shopping'){const shop=shoppingState(room);if(shop){shop.stage='complete';refreshShoppingPublic(room,shop);room.game.publicState={...room.game.publicState,results:shoppingResults(shop)};}}room.status='settled';room.game.phase='settled';room.game.endsAt=null;return room;}

function handleWitchAction(room:RoomSnapshot,accountId:string,input:GameAction):RoomSnapshot {
  const game=room.game!;const active=room.members.filter(member=>member.ready);const witch=witchState(room);
  if(!witch)throw new Error('毒药棋盘尚未初始化');
  const stage=String(game.publicState.stage||'bury');
  if(input.action==='witch-bury'){
    if(stage!=='bury')throw new Error('埋设阶段已经结束');
    if(witch.deposits[accountId])throw new Error('你已经埋好惩罚，请等待其他玩家');
    const cell=validCell(input.payload?.cell,witch.boardSize);const punishment=String(input.payload?.punishment||'').trim();
    if(punishment.length<2)throw new Error('请填写至少 2 个字的惩罚');
    if(punishment.length>60)throw new Error('惩罚最多填写 60 个字');
    witch.deposits[accountId]={cell,punishment,buriedAt:Date.now()};
    const buriedCount=Object.keys(witch.deposits).length;
    game.publicState={...game.publicState,buriedCount,lastActionAt:Date.now()};
    if(buriedCount===active.length){
      game.publicState={...game.publicState,stage:'investigate',foundPoisonCount:0,revealedCellCount:0};
      game.primaryAction='排查这个格子';
    }
    return room;
  }
  if(input.action==='witch-investigate'){
    if(stage!=='investigate')throw new Error('请等待所有玩家埋好惩罚');
    const cell=validCell(input.payload?.cell,witch.boardSize);const sharedRevealed=allWitchReveals(witch);
    if(sharedRevealed.some(item=>item.cell===cell))throw new Error('这个格子已经被大家排查过');
    const investigatedAt=Date.now();const investigatedByName=room.members.find(item=>item.accountId===accountId)?.displayName??'匿名玩家';
    const hits=Object.entries(witch.deposits).filter(([,deposit])=>deposit.cell===cell).map(([buriedByAccountId,deposit])=>({cell,hit:true,investigatedByAccountId:accountId,investigatedByName,investigatedAt,buriedByAccountId,buriedByName:room.members.find(item=>item.accountId===buriedByAccountId)?.displayName??'匿名玩家',punishment:deposit.punishment} satisfies WitchReveal));
    witch.investigations[accountId]=[...(witch.investigations[accountId]??[]),...(hits.length?hits:[{cell,hit:false,investigatedByAccountId:accountId,investigatedByName,investigatedAt} satisfies WitchReveal])];witch.lastActionAt[accountId]=investigatedAt;
    const allRevealed=allWitchReveals(witch);const foundPoisonCount=foundWitchOwners(allRevealed).size;const state=runtime(room);
    game.publicState={...game.publicState,foundPoisonCount,revealedCellCount:new Set(allRevealed.map(item=>item.cell)).size,lastActionAt:Date.now()};
    if(foundPoisonCount===Object.keys(witch.deposits).length){
      const totalRounds=game.config?.rounds??1;
      if(witch.currentRound<totalRounds){
        witch.currentRound+=1;witch.deposits={};witch.investigations={};witch.lastActionAt={};
        game.round=witch.currentRound;game.publicState={...game.publicState,stage:'bury',buriedCount:0,foundPoisonCount:0,revealedCellCount:0};
        game.primaryAction='埋下这个惩罚';
      }else{
        active.forEach(member=>state.completed.add(member.accountId));game.publicState={...game.publicState,stage:'complete'};game.primaryAction='全部毒药已采完';game.phase='settled';game.endsAt=null;room.status='settled';
      }
    }
    return room;
  }
  throw new Error('当前操作不适用于女巫毒药');
}

function handleTruthAction(room:RoomSnapshot,accountId:string,input:GameAction):RoomSnapshot {
  const game=room.game!;const truth=truthState(room);const active=room.members.filter(member=>member.ready);
  if(!truth)throw new Error('两真一假尚未初始化');
  if(input.action==='truth-submit'){
    if(truth.stage!=='setup')throw new Error('提交阶段已经结束');
    if(truth.submissions[accountId])throw new Error('你已经提交过角色描述');
    const values=Array.isArray(input.payload?.statements)?input.payload.statements:[];const statements=values.map(value=>String(value).trim());const falseIndex=Number(input.payload?.falseIndex);
    if(statements.length!==3)throw new Error('请填写三条角色描述');
    const invalidStatementIndex=statements.findIndex(value=>value.length<1||value.length>80);
    if(invalidStatementIndex>=0)throw new Error(`请填写描述 ${invalidStatementIndex+1}（最多 80 个字）`);
    if(new Set(statements).size!==3)throw new Error('三条角色描述不能重复');
    if(!Number.isInteger(falseIndex)||falseIndex<0||falseIndex>2)throw new Error('请选择哪一条是虚构描述');
    truth.submissions[accountId]={statements:statements as [string,string,string],falseIndex,submittedAt:Date.now()};
    game.publicState={stage:'setup',submittedCount:Object.keys(truth.submissions).length,total:active.length,lastActionAt:Date.now()};
    if(Object.keys(truth.submissions).length===active.length)beginTruthRound(room,truth,active);
    return room;
  }
  const speakerAccountId=truth.order[truth.speakerIndex%truth.order.length];const speaker=active.find(m=>m.accountId===speakerAccountId);
  if(input.action==='truth-vote'){
    if(truth.stage!=='voting')throw new Error('现在不能投票');
    if(!speaker||speaker.accountId===accountId)throw new Error('不能给自己的描述投票');
    if(truth.votes[accountId])throw new Error('你已经投过票');
    const statementIndex=Number(input.payload?.statementIndex);if(!Number.isInteger(statementIndex)||statementIndex<0||statementIndex>2)throw new Error('请选择一条虚构描述');
    truth.votes[accountId]={statementIndex,votedAt:Date.now()};
    const voters=active.filter(member=>member.accountId!==speaker.accountId);const votedCount=Object.keys(truth.votes).length;
    game.publicState={...game.publicState,votedCount,voterCount:voters.length,lastActionAt:Date.now()};
    if(votedCount===voters.length)revealTruthRound(room,truth,active);
    return room;
  }
  if(input.action==='truth-next'){
    if(truth.stage!=='reveal')throw new Error('请等待本轮投票完成');
    const member=active.find(item=>item.accountId===accountId);if(accountId!==speaker?.accountId&&!member?.hostRole)throw new Error('由当前陈述者或主持人推进下一位');
    truth.speakerIndex+=1;truth.votes={};game.round=truth.speakerIndex+1;
    const totalRounds=active.length*(game.config?.rounds??1);
    if(truth.speakerIndex>=totalRounds){truth.stage='complete';settleGame(room);}
    else beginTruthRound(room,truth,active);
    return room;
  }
  throw new Error('当前操作不适用于两真一假');
}

function handleDrawAction(room:RoomSnapshot,accountId:string,input:GameAction):RoomSnapshot {
  const game=room.game!;const draw=drawState(room);
  if(!draw)throw new Error('你画我猜尚未初始化');
  if(input.action==='draw-live'){
    if(draw.stage!=='drawing')throw new Error('绘画阶段已经结束');
    if(draw.order[draw.currentIndex]!==accountId)throw new Error('还没轮到你画');
    const live=String(input.payload?.drawing||'');
    if(live&&!live.startsWith('data:image/'))throw new Error('画作数据无效');
    draw.liveDrawing=live||null;
    game.publicState={...game.publicState,liveDrawing:draw.liveDrawing,lastActionAt:Date.now()};
    return room;
  }
  if(input.action==='draw-submit'){
    if(draw.stage!=='drawing')throw new Error('绘画阶段已经结束');
    if(draw.order[draw.currentIndex]!==accountId)throw new Error('还没轮到你画');
    const drawing=String(input.payload?.drawing||'');
    if(!drawing.startsWith('data:image/'))throw new Error('画作数据无效');
    draw.drawing=drawing;draw.drawings.push(drawing);draw.liveDrawing=null;draw.currentIndex+=1;
    if(draw.currentIndex>=draw.order.length-1){
      draw.stage='guessing';game.primaryAction='根据画作猜词';
    }else{
      const nextName=room.members.find(m=>m.accountId===draw.order[draw.currentIndex])?.displayName??'下一位玩家';
      game.primaryAction=`等待 ${nextName} 继续画`;
    }
    game.publicState={...game.publicState,stage:draw.stage,currentIndex:draw.currentIndex,drawing:draw.drawing,drawings:draw.drawings,liveDrawing:null,lastActionAt:Date.now()};
    return room;
  }
  if(input.action==='draw-guess'){
    if(draw.stage!=='guessing')throw new Error('猜测阶段尚未开始');
    if(draw.order[draw.order.length-1]!==accountId)throw new Error('只有最后一位玩家可以猜');
    const guess=String(input.payload?.guess||'').trim();
    if(guess.length<1)throw new Error('请输入你的猜测');
    draw.guess=guess;draw.stage='reveal';
    const correct=typeof input.payload?.correct==='boolean'?input.payload.correct:(guess.includes(draw.word)||draw.word.includes(guess));
    const guesser=room.members.find(m=>m.accountId===accountId);
    draw.correct=correct;
    if(correct&&guesser){guesser.score+=20;game.scores[accountId]=guesser.score;}
    game.primaryAction=correct?'猜中了！':'没有猜中';
    game.publicState={...game.publicState,stage:'reveal',word:draw.word,guess:draw.guess,correct,drawing:draw.drawing,drawings:draw.drawings,lastActionAt:Date.now()};
    game.phase='settled';game.endsAt=null;room.status='settled';
    return room;
  }
  throw new Error('当前操作不适用于你画我猜');
}

function beginTruthRound(room:RoomSnapshot,truth:TruthState,active:RoomSnapshot['members']){
  const roundsPerPlayer=room.game?.config?.rounds??1;const totalRounds=active.length*roundsPerPlayer;
  // 每一轮（全员循环一次）重新洗牌发言顺序
  if(truth.speakerIndex>0&&truth.speakerIndex%truth.order.length===0)truth.order=shuffle(truth.order);
  const speakerAccountId=truth.order[truth.speakerIndex%truth.order.length];const speaker=active.find(m=>m.accountId===speakerAccountId);const submission=speaker&&truth.submissions[speaker.accountId];if(!speaker||!submission)throw new Error('角色描述尚未准备完整');
  truth.stage='voting';truth.votes={};room.game!.primaryAction='投出你认为虚构的一条';room.game!.publicState={stage:'voting',speakerAccountId:speaker.accountId,speakerName:speaker.displayName,speakerRole:speaker.playerRole,statements:submission.statements,votedCount:0,voterCount:Math.max(0,active.length-1),round:truth.speakerIndex+1,totalRounds,lastActionAt:Date.now()};
}

function revealTruthRound(room:RoomSnapshot,truth:TruthState,active:RoomSnapshot['members']){
  const speakerAccountId=truth.order[truth.speakerIndex%truth.order.length];const speaker=active.find(m=>m.accountId===speakerAccountId);const submission=speaker&&truth.submissions[speaker.accountId];if(!speaker||!submission)throw new Error('没有找到当前陈述者');
  const votes=structuredClone(truth.votes);for(const [voterAccountId,vote] of Object.entries(votes)){if(vote.statementIndex===submission.falseIndex)truth.points[voterAccountId]=(truth.points[voterAccountId]??0)+1;else truth.points[speaker.accountId]=(truth.points[speaker.accountId]??0)+1;}
  truth.rounds.push({speakerAccountId:speaker.accountId,statements:submission.statements,falseIndex:submission.falseIndex,votes,revealedAt:Date.now()});truth.stage='reveal';room.game!.primaryAction='请下一位开始';room.game!.scores=Object.fromEntries(active.map(member=>[member.accountId,member.score+(truth.points[member.accountId]??0)]));room.game!.publicState={...room.game!.publicState,stage:'reveal',falseIndex:submission.falseIndex,votes:Object.fromEntries(Object.entries(votes).map(([id,vote])=>[id,vote.statementIndex])),points:structuredClone(truth.points),lastActionAt:Date.now()};
  const totalRounds=active.length*(room.game?.config?.rounds??1);
  if(truth.speakerIndex>=totalRounds-1){truth.stage='complete';settleGame(room);}
}

function witchState(room:RoomSnapshot):WitchState|undefined {const value=room.game?.privateState?.witch as Partial<WitchState>|undefined;if(!value)return undefined;value.boardSize??=room.game?.config?.boardSize??5;value.currentRound??=1;value.deposits??={};value.investigations??={};value.lastActionAt??={};for(const deposit of Object.values(value.deposits))deposit.buriedAt??=0;for(const [accountId,reveals] of Object.entries(value.investigations))for(const reveal of reveals){reveal.investigatedByAccountId??=accountId;reveal.investigatedByName??=room.members.find(item=>item.accountId===accountId)?.displayName??'匿名玩家';reveal.investigatedAt??=0;}return value as WitchState;}
function truthState(room:RoomSnapshot):TruthState|undefined {const value=room.game?.privateState?.truth as Partial<TruthState>|undefined;if(!value)return undefined;if(!Array.isArray(value.order))value.order=room.members.filter(m=>m.ready).map(m=>m.accountId);return value as TruthState;}
function drawState(room:RoomSnapshot):DrawState|undefined {const d=room.game?.privateState?.draw as Partial<DrawState>|undefined;if(!d)return undefined;d.order=d.order??[];d.currentIndex=d.currentIndex??0;d.drawings=d.drawings??[];d.liveDrawing=d.liveDrawing??null;return d as DrawState;}
function submissionRecord(value:unknown):Record<string,true>{
  if(value instanceof Set||Array.isArray(value))return Object.fromEntries([...value].map(id=>[String(id),true]));
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v===true)):{};
}
function auctionState(room:RoomSnapshot):AuctionState|undefined{
  const value=room.game?.privateState?.auction as Partial<AuctionState>|undefined;if(!value)return undefined;
  value.stage??='init';value.budgets??={};value.wallets??={};value.lots??=[];value.lotOrder??=[];value.topBid??=null;value.itemsByAccount??={};
  value.budgetSubmitted=submissionRecord(value.budgetSubmitted);value.itemSubmitted=submissionRecord(value.itemSubmitted);
  for(const [id,budget] of Object.entries(value.budgets))if(budget>0)value.budgetSubmitted[id]=true;
  for(const lot of value.lots){(value.itemsByAccount[lot.sellerAccountId]||=[]).push(lot.lotId);value.itemSubmitted[lot.sellerAccountId]=true;}
  return value as AuctionState;
}
function allWitchReveals(witch:WitchState|undefined){return witch?Object.values(witch.investigations).flat():[];}
function foundWitchOwners(reveals:WitchReveal[]){return new Set(reveals.filter(item=>item.hit&&item.buriedByAccountId).map(item=>item.buriedByAccountId!));}
function validCell(value:unknown,boardSize:number){const cell=Number(value);const max=boardSize*boardSize-1;if(!Number.isInteger(cell)||cell<0||cell>max)throw new Error(`请选择一个有效格子（0–${max}）`);return cell;}
function moneyInput(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||round2(value)!==value)throw new Error('金额必须是最多两位小数的有效数字');return value;}
function round2(value:number){return Math.round((value+Number.EPSILON)*100)/100;}
function refreshAuctionPublicState(room:RoomSnapshot,auc:AuctionState,active:RoomSnapshot['members']){
  const game=room.game!;const total=active.length;const sold=auc.lots.filter(l=>l.sold).length;const currentLotIndex=auc.currentLotIndex!=null?auc.currentLotIndex:null;const currentLot=currentLotIndex!=null?auc.lots.find(l=>l.lotId===auc.lotOrder[currentLotIndex])??null:null;
  const wallets=Object.fromEntries(active.map(m=>[m.accountId,round2(auc.wallets[m.accountId]??0)]));
  const richRanking=active.map(m=>({accountId:m.accountId,displayName:m.displayName,wallet:round2(auc.wallets[m.accountId]??0)})).sort((a,b)=>b.wallet-a.wallet);
  const auctionRanking=auc.lots.map(l=>({lotId:l.lotId,title:l.title,soldPrice:l.soldPrice,sellerName:active.find(a=>a.accountId===l.sellerAccountId)?.displayName??'',winnerName:l.winnerAccountId?active.find(a=>a.accountId===l.winnerAccountId)?.displayName??null:null})).sort((a,b)=>(b.soldPrice??-1)-(a.soldPrice??-1));
  const overviewOf=(lot:AuctionLot):AuctionLotOverview=>({lotId:lot.lotId,sellerAccountId:lot.sellerAccountId,sellerName:active.find(a=>a.accountId===lot.sellerAccountId)?.displayName??null,sellerRole:active.find(a=>a.accountId===lot.sellerAccountId)?.playerRole??null,title:lot.title,story:lot.story,assetId:lot.assetId,imageUrl:lot.imageUrl,thumbUrl:lot.thumbUrl,submittedAt:new Date(lot.submittedAt).toISOString(),bidCount:lot.bidHistory.length,soldPrice:lot.soldPrice,winnerAccountId:lot.winnerAccountId,winnerName:lot.winnerAccountId?active.find(a=>a.accountId===lot.winnerAccountId)?.displayName??null:null,sold:lot.sold});
  const ps=game.publicState as Record<string,unknown>;
  ps.stage=auc.stage;
  ps.budgetsSubmitted=active.filter(m=>auc.budgetSubmitted[m.accountId]).length;
  ps.itemsSubmitted=auc.lots.length;
  ps.total=total;
  ps.roundNumber=auc.lotOrder.length>0 && currentLotIndex!=null ? (currentLotIndex+1) : 0;
  ps.totalRounds=auc.lotOrder.length || auc.lots.length;
  ps.lotOrder=[...auc.lotOrder];
  ps.currentLotIndex=currentLotIndex;
  ps.lots=auc.lots.map(overviewOf);
  ps.currentLot=currentLot?overviewOf(currentLot):null;
  ps.topBid=auc.topBid?{accountId:auc.topBid.accountId,displayName:active.find(a=>a.accountId===auc.topBid!.accountId)?.displayName??null,price:round2(auc.topBid.price),bidAt:new Date(auc.topBid.bidAt).toISOString()}:null;
  ps.priceIncrement=PRICE_INCREMENT;
  ps.wallets=wallets;
  ps.rankingsPreview={richRanking,auctionRanking};
  ps.bidHistory=currentLot?currentLot.bidHistory.slice(-10).map(b=>({accountId:b.accountId,displayName:active.find(a=>a.accountId===b.accountId)?.displayName??'',price:round2(b.price),bidAt:new Date(b.bidAt).toISOString()})).reverse():[];
  ps.itemsByAccount={...auc.itemsByAccount};
  ps.soldCount=sold;
  ps.lastActionAt=Date.now();
}
function beginAuctionLot(room:RoomSnapshot,auc:AuctionState,active:RoomSnapshot['members'],index:number){
  if(auc.lotOrder.length===0)throw new Error('还没有可拍卖的物品');
  if(index<0||index>=auc.lotOrder.length)throw new Error('拍品序号超出范围');
  const lotId=auc.lotOrder[index];const lot=auc.lots.find(l=>l.lotId===lotId);if(!lot)throw new Error('找不到当前拍品');
  auc.currentLotIndex=index;auc.stage='bidding';auc.topBid=null;room.game!.round=index+1;room.game!.primaryAction=`自由出价：最少 +${PRICE_INCREMENT} 元`;
  refreshAuctionPublicState(room,auc,active);
}
function finalizeAuctionLot(room:RoomSnapshot,auc:AuctionState,active:RoomSnapshot['members']){
  if(auc.currentLotIndex==null)throw new Error('当前没有正在拍卖的物品');
  const lotId=auc.lotOrder[auc.currentLotIndex];const lot=auc.lots.find(l=>l.lotId===lotId);if(!lot)throw new Error('找不到当前拍品');
  if(auc.stage!=='bidding'||lot.soldAt!==null)throw new Error('当前不在出价阶段');
  const top=auc.topBid;
  if(top){
    const price=round2(top.price);
    const buyer=active.find(a=>a.accountId===top.accountId);const seller=active.find(a=>a.accountId===lot.sellerAccountId);
    if(!buyer)throw new Error('出价人不在房间');if(!seller)throw new Error('出售人不在房间');
    if(price>(auc.wallets[buyer.accountId]??0))throw new Error('余额不足');
    auc.wallets[buyer.accountId]=round2((auc.wallets[buyer.accountId]??0)-price);
    auc.wallets[seller.accountId]=round2((auc.wallets[seller.accountId]??0)+price);
    lot.winnerAccountId=buyer.accountId;lot.soldPrice=price;lot.soldAt=Date.now();lot.sold=true;
  }else{
    lot.winnerAccountId=null;lot.soldPrice=null;lot.soldAt=Date.now();lot.sold=false;
  }
  auc.topBid=null;
  const nextIndex=(auc.currentLotIndex??0)+1;
  if(nextIndex>=auc.lotOrder.length){
    auc.stage='complete';auc.currentLotIndex=null;settleGame(room);
    return;
  }
  beginAuctionLot(room,auc,active,nextIndex);
}
function handleAuctionAction(room:RoomSnapshot,accountId:string,input:GameAction):RoomSnapshot{
  const game=room.game!;const auc=auctionState(room);if(!auc)throw new Error('拍卖会尚未初始化');
  const active=room.members.filter(m=>m.ready);const member=active.find(m=>m.accountId===accountId);if(!member)throw new Error('只有已准备的玩家才能操作拍卖');
  const isHost=Boolean(member.hostRole)||room.ownerAccountId===accountId;
  if(input.action==='auction-set-budget'){
    if(auc.stage!=='init')throw new Error('初始金额只能在开始前输入');
    if(auc.budgetSubmitted[accountId])throw new Error('你已经输入过初始金额');
    const raw=moneyInput(input.payload?.initialBudget);
    const amount=round2(raw);
    if(amount<0||amount>1_000_000)throw new Error('初始金额必须在 0.00～1000000.00 元之间');
    auc.budgets[accountId]=amount;auc.wallets[accountId]=amount;auc.budgetSubmitted[accountId]=true;
    if(active.every(m=>auc.budgetSubmitted[m.accountId])){auc.stage='setup';game.primaryAction='上传你的随身物品';}
    refreshAuctionPublicState(room,auc,active);return room;
  }
  if(input.action==='auction-submit-item'){
    if(auc.stage!=='setup')throw new Error('物品只能在 setup 阶段上传');
    const myCount=(auc.itemsByAccount[accountId]||[]).length;if(myCount>=9)throw new Error('每人最多提交 9 件物品');
    const assetId=String(input.payload?.assetId||'').trim();
    const title=String(input.payload?.title||'').trim();
    const story=String(input.payload?.story||'').trim();
    const emoji=String(input.payload?.emoji||'').trim();
    if(title.length<1||title.length>20)throw new Error('物品名称需要 1～20 个字');
    if(story.length<1||story.length>200)throw new Error('物品介绍需要 1～200 个字');
    const hasPhoto=Boolean(assetId);
    const lotId='lot-'+randomUUID();const lot:AuctionLot={
      lotId,sellerAccountId:accountId,title,story,assetId,
      imageUrl:hasPhoto?`/api/media/${encodeURIComponent(assetId)}`:`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#2a2318'/><text x='50%' y='55%' font-size='90' text-anchor='middle' dominant-baseline='middle'>${emoji||'🎁'}</text></svg>`)}`,
      thumbUrl:hasPhoto?`/api/media/${encodeURIComponent(assetId)}?thumb=1`:'',
      submittedAt:Date.now(),bidHistory:[],winnerAccountId:null,soldPrice:null,soldAt:null,sold:false
    };
    auc.lots.push(lot);auc.lots.sort((a,b)=>a.submittedAt-b.submittedAt);auc.lotOrder=auc.lots.map(item=>item.lotId);(auc.itemsByAccount[accountId]||=[]).push(lotId);auc.itemSubmitted[accountId]=true;
    game.primaryAction=auc.lots.length>=1?'至少提交一件物品，由主持点"预览拍品"进入拍卖':'至少提交一件物品';
    refreshAuctionPublicState(room,auc,active);return room;
  }
  if(input.action==='auction-reorder'){
    if(auc.stage!=='preview')throw new Error('只有 preivew 阶段可重排拍品顺序');
    if(!isHost)throw new Error('只有主持能重排拍品顺序');
    const order=Array.isArray(input.payload?.lotOrder)?input.payload.lotOrder as string[]:[];
    if(order.length!==auc.lots.length)throw new Error('拍品顺序长度必须与已提交物品数一致');
    const set=new Set(order);if(set.size!==order.length)throw new Error('拍品顺序不能重复');
    for(const id of order)if(!auc.lots.some(l=>l.lotId===id))throw new Error(`顺序里存在未知拍品：${id}`);
    auc.lotOrder=order;refreshAuctionPublicState(room,auc,active);return room;
  }
  if(input.action==='auction-bid'){
    if(auc.stage!=='bidding')throw new Error('当前还不能出价');
    const currentLotIndex=auc.currentLotIndex;if(currentLotIndex==null)throw new Error('当前没有正在拍卖的物品');
    const lot=auc.lots.find(l=>l.lotId===auc.lotOrder[currentLotIndex]);if(!lot)throw new Error('找不到当前拍品');
    if(lot.sellerAccountId===accountId)throw new Error('出售人不能给自己的物品出价');
    const raw=moneyInput(input.payload?.price);
    const price=round2(raw);
    const wallet=round2(auc.wallets[accountId]??0);if(price>wallet)throw new Error('余额不足');
    const basePrice=auc.topBid?round2(auc.topBid.price):0;
    const minNext=round2(basePrice+PRICE_INCREMENT);
    if(price<minNext)throw new Error(`出价必须 ≥ 当前最高价 + 0.1 元（当前最低可出：${minNext.toFixed(2)} 元）`);
    const bid:AuctionBid={bidId:input.actionId,accountId,price,bidAt:Date.now()};
    auc.topBid=bid;lot.bidHistory.push(bid);
    refreshAuctionPublicState(room,auc,active);return room;
  }
  if(input.action==='auction-sold'||input.action==='auction-pass-lot'){
    if(auc.stage!=='bidding')throw new Error('当前不在出价阶段');
    const lot=auc.currentLotIndex==null?undefined:auc.lots.find(l=>l.lotId===auc.lotOrder[auc.currentLotIndex!]);
    if(!lot||lot.sellerAccountId!==accountId)throw new Error('只有当前拍品的出售人可以担任拍卖师，落锤或流拍');
    if(input.payload?.lotId!==undefined&&input.payload.lotId!==lot.lotId)throw new Error('拍品已更新，请刷新后重试');
    if(input.action==='auction-pass-lot')auc.topBid=null;
    finalizeAuctionLot(room,auc,active);return room;
  }
  throw new Error('当前操作不适用于物品拍卖会');
}
