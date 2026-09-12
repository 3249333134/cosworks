import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { actionSchema, credentialsSchema, GAME_DEFINITIONS, GAME_IDS, isDistinctSecretMission, isLowCorrelationSecretMission, mbtiSchema, roleSchema, roomCodeSchema, type Challenge, type GameId, type GamePlanItem, type GameSnapshot, type IpRole, type Mbti, type RoomMember, type RoomSnapshot } from '@ruxiju/shared';
import { config } from './config.js';
import { requireAuth, signSession } from './auth.js';
import { createStore, type Store, type AssetRecord } from './store.js';
import { advanceGameStage, ensureAuctionGame, ensureTruthGame, ensureWitchGame, gameOverview, handleGameAction, playerSnapshot, replacePlayerChallenge, restartDrawGame, restoreRuntime, serializeRuntime, setDontWordCount, setPlayerChallenge, settleGame, startGame, usedDontContents, type PersistedRuntime } from './game-engine.js';
import { applyStoryBundle, ensureStoryGame, storyState } from './story-engine.js';
import { ensureShoppingGame } from './shopping-engine.js';
import { generateStoryBundle, generateUndercoverWords, generateContent, generateRoleDetails, judgeGuess, prewarmDontPool, takeDontChallenge } from './content-service.js';
import { abortUndercover, beginUndercover, ensureUndercover, undercoverState } from './undercover-engine.js';
import { prewarmMustPool, takeMustChallenge } from './secret-mission-pool.js';
import { broadcast } from './hub.js';
import { buildHistory, buildTimeline } from './history.js';
import { createMediaRoutes } from './media.js';


// Keep room mutations serialized so planning and live game actions cannot overwrite each other.
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode=()=>Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
const memberFor=(accountId:string,displayName:string,isOwner=false):RoomMember=>({id:randomUUID(),accountId,displayName,isOwner,hostRole:isOwner?'owner':null,playerRole:'',ipRoleId:null,team:'未分队',ready:false,online:true,score:0});
const createPlanItem=(gameId:GameId):GamePlanItem=>({id:randomUUID(),gameId,createdAt:new Date().toISOString()});

// Rough genre buckets to avoid stacking all speech games together.
const SPEECH:GameId[]=['dont','must','truth','undercover'];
const CREATIVE:GameId[]=['draw','story','witch'];
const ACTION:GameId[]=['imitate','camera'];
const ECONOMY:GameId[]=['auction','shopping'];

/** Build a game plan from total minutes + expected players. */
function planFor(durationMinutes:number,playerCount:number):GamePlanItem[]{
  const dur=Math.max(15,Math.min(120,durationMinutes));
  const players=Math.max(2,Math.min(30,playerCount));
  // Quick path: preserve original default ordering for the standard 30-minute plan, filtering out games that need more players than available.
  if(dur===30){return (['dont','must','truth'] as GameId[]).filter(id=>players>=GAME_DEFINITIONS[id].minPlayers).map(createPlanItem);}
  const eligible=(ids:GameId[])=>ids.filter(id=>{const g=GAME_DEFINITIONS[id];return players>=g.minPlayers&&players<=g.maxPlayers;});
  const speech=eligible(SPEECH),creative=eligible(CREATIVE),action=eligible(ACTION),economy=eligible(ECONOMY);
  if(speech.length+creative.length+action.length+economy.length===0){
    return GAME_IDS.filter(id=>players>=GAME_DEFINITIONS[id].minPlayers&&players<=GAME_DEFINITIONS[id].maxPlayers).map(createPlanItem).slice(0,3);
  }
  const buckets=[speech,creative,economy,action].filter(b=>b.length>0);
  const chosen=new Set<GameId>();const picks:GameId[]=[];let spent=0;let safety=12;const slack=Math.min(8,Math.floor(dur*0.2));
  while(spent<dur&&safety--){
    let added=false;
    for(const bucket of buckets){
      const pick=bucket.find(id=>!chosen.has(id)&&spent+GAME_DEFINITIONS[id].durationMinutes<=dur+slack);
      if(!pick) continue;
      picks.push(pick);chosen.add(pick);spent+=GAME_DEFINITIONS[pick].durationMinutes;added=true;
      if(spent>=dur) break;
    }
    if(!added) break;
  }
  if(picks.length===0){const fallback=[...speech,...creative,...economy,...action][0]??GAME_IDS[0];return [createPlanItem(fallback)];}
  return picks.map(createPlanItem);
}

const defaultGamePlan=()=>planFor(30,4);

export function createApp(store:Store=createStore()){
  const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use(cors({origin:(origin,cb)=>cb(null,config.isAllowedOrigin(origin)),credentials:true}));app.use(express.json({limit:'12mb'}));app.use(cookieParser());
  const media=createMediaRoutes(store);app.use(media.router);
  app.get('/api/health',(_req,res)=>res.json({ok:true,data:{service:'ruxiju-api',time:new Date().toISOString()}}));

  app.post('/api/auth/register',async(req,res,next)=>{try{const input=credentialsSchema.parse(req.body);const hash=await bcrypt.hash(input.password,12);const user=await store.createUser(input.account,hash,input.displayName??input.account);const token=signSession(user.id);setSession(res,token);res.status(201).json({ok:true,data:{user:{accountId:user.id,displayName:user.displayName},token}});}catch(error){next(error);}});
  app.post('/api/auth/login',async(req,res,next)=>{try{const input=credentialsSchema.pick({account:true,password:true}).parse(req.body);const user=await store.findUserByAccount(input.account);if(!user||!await bcrypt.compare(input.password,user.passwordHash))return res.status(401).json({ok:false,error:'账号或密码不正确'});const token=signSession(user.id);setSession(res,token);res.json({ok:true,data:{user:{accountId:user.id,displayName:user.displayName},token}});}catch(error){next(error);}});
  app.post('/api/auth/logout',(_req,res)=>{res.clearCookie('rxj_session');res.json({ok:true});});

  app.use('/api',requireAuth);
  app.get('/api/profile/me',async(req,res,next)=>{try{res.json({ok:true,data:{profile:await store.getProfile(req.auth!.accountId)}});}catch(error){next(error);}});
  app.put('/api/profile/me',async(req,res,next)=>{try{const patch:{displayName?:string;mbti?:Mbti}={};if(req.body.displayName)patch.displayName=String(req.body.displayName).slice(0,24);if(req.body.mbti)patch.mbti=mbtiSchema.parse(req.body.mbti);res.json({ok:true,data:{profile:await store.updateProfile(req.auth!.accountId,patch)}});}catch(error){next(error);}});
  app.post('/api/profile/me/roles',async(req,res,next)=>{try{const role=roleSchema.parse(req.body);res.status(201).json({ok:true,data:{role:await store.saveRole(req.auth!.accountId,role)}});}catch(error){next(error);}});
app.post('/api/roles/generate',requireAuth,async(req,res,next)=>{
  try{
    const ipTheme=String(req.body.ipTheme??'').trim();
    const name=String(req.body.name??'').trim();
    const tagsRaw=req.body.personaTags;
    const tags=Array.isArray(tagsRaw)?tagsRaw.map((t:unknown)=>String(t)).filter(Boolean):String(tagsRaw??'').split(/[\/,，]/).map(s=>s.trim()).filter(Boolean);
    if(!ipTheme||!name){res.status(400).json({ok:false,error:'IP 和角色名必填'});return;}
    if(ipTheme.length>40||name.length>20){res.status(400).json({ok:false,error:'字段过长'});return;}
    const result=await generateRoleDetails(ipTheme,name,tags);
    res.json({ok:true,data:result});
  }catch(error){next(error);}
});
  app.put('/api/profile/me/roles/:id',async(req,res,next)=>{try{const role=roleSchema.parse(req.body);res.json({ok:true,data:{role:await store.saveRole(req.auth!.accountId,{...role,id:req.params.id})}});}catch(error){next(error);}});
  app.delete('/api/profile/me/roles/:id',async(req,res,next)=>{try{await store.deleteRole(req.auth!.accountId,req.params.id);res.json({ok:true});}catch(error){next(error);}});

  const roomQueues=new Map<string,Promise<void>>();
  app.use('/api/rooms/:code',async(req,res,next)=>{
    const key=req.params.code.toUpperCase();const previous=roomQueues.get(key)??Promise.resolve();
    let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve;});roomQueues.set(key,current);
    await previous;
    let released=false;const finish=()=>{if(released)return;released=true;release();if(roomQueues.get(key)===current)roomQueues.delete(key);};
    const end=res.end;res.end=function(this:express.Response,...args:Parameters<typeof end>){try{return end.apply(this,args);}finally{finish();}} as typeof end;next();
  });
  app.post('/api/rooms',async(req,res,next)=>{try{const owner=await store.findUserById(req.auth!.accountId);if(!owner)throw new Error('账号不存在');let code=roomCode();while(await store.getRoom(code))code=roomCode();const durationMinutes=Math.max(15,Math.min(120,Number(req.body.durationMinutes)||30));const playerCount=Math.max(2,Math.min(30,Number(req.body.playerCount)||4));const room:RoomSnapshot={id:randomUUID(),code,name:String(req.body.name||'今晚入戏').slice(0,50),ipTheme:String(req.body.ipTheme||'罗小黑战记').slice(0,80),status:'waiting',ownerAccountId:owner.id,members:[memberFor(owner.id,owner.displayName,true)],currentGame:null,game:null,gamePlan:planFor(durationMinutes,playerCount),planCursor:0,planRound:1,closedAt:null};await store.createRoom(room);const profile=await store.getProfile(owner.id);const defaultRole=profile.roles.find(role=>role.ipTheme===room.ipTheme&&role.isDefault)??profile.roles.find(role=>role.ipTheme===room.ipTheme);if(profile.mbti&&defaultRole)void prewarmDontPool(room.code,owner.id,{gameId:'dont',mbti:profile.mbti,role:defaultRole,playerCount:1,cameraAvailable:false}).catch(()=>undefined);res.status(201).json({ok:true,data:{room}});}catch(error){next(error);}});
  app.get('/api/rooms/recent',async(req,res,next)=>{try{const limit=Math.max(1,Math.min(5,Number(req.query.limit)||3));res.json({ok:true,data:{rooms:await store.listRecentRooms(req.auth!.accountId,limit)}});}catch(error){next(error);}});
  app.get('/api/rooms/:code',async(req,res,next)=>{try{const room=await loadRoom(store,req.params.code);if(!room)return res.status(404).json({ok:false,error:'没有找到这个房间'});if(!room.members.some(member=>member.accountId===req.auth!.accountId))return res.status(403).json({ok:false,error:'请先加入房间'});res.json({ok:true,data:{room:playerSnapshot(room,req.auth!.accountId)}});}catch(error){next(error);}});
  app.get('/api/rooms/:code/overview',async(req,res,next)=>{try{const room=await roomForMember(store,req.params.code,req.auth!.accountId);res.json({ok:true,data:{overview:gameOverview(room,req.auth!.accountId)}});}catch(error){next(error);}});
  app.get('/api/rooms/:code/timeline',async(req,res,next)=>{try{const room=await loadRoom(store,req.params.code);if(!room)return res.status(404).json({ok:false,error:'没有找到这个房间'});if(!room.members.some(member=>member.accountId===req.auth!.accountId))return res.status(403).json({ok:false,error:'你不是这场聚会的成员'});const timeline=buildTimeline(room,await store.listGameSessions(room.id));res.json({ok:true,data:{timeline}});}catch(error){next(error);}});
  app.get('/api/rooms/:code/sessions/:sessionId/history',async(req,res,next)=>{try{const room=await loadRoom(store,req.params.code);if(!room)return res.status(404).json({ok:false,error:'没有找到这个房间'});if(!room.members.some(member=>member.accountId===req.auth!.accountId))return res.status(403).json({ok:false,error:'你不是这场聚会的成员'});const session=await store.getGameSessionRecord(req.params.sessionId);if(!session||session.roomId!==room.id)return res.status(404).json({ok:false,error:'没有找到这场游戏记录'});const history=buildHistory(room,session,await store.listGameEvents(session.id),req.auth!.accountId);res.json({ok:true,data:{history}});}catch(error){next(error);}});
  app.get('/api/rooms/:code/members/:accountId/history',async(req,res,next)=>{try{const room=await loadRoom(store,req.params.code);if(!room)return res.status(404).json({ok:false,error:'没有找到这个房间'});if(!room.members.some(member=>member.accountId===req.auth!.accountId))return res.status(403).json({ok:false,error:'你不是这场聚会的成员'});const target=room.members.find(item=>item.accountId===req.params.accountId);if(!target)return res.status(404).json({ok:false,error:'没有找到该成员'});const requesterIsTarget=req.auth!.accountId===target.accountId;const rawEvents=await store.getMemberEvents(room.id,target.accountId,80);const events=rawEvents.filter(e=>e.visibility==='public'||(e.visibility==='private'&&requesterIsTarget)||e.visibility==='public_after_settle').map(e=>({id:e.id,actorAccountId:e.actorAccountId,actorName:target.displayName,eventType:e.eventType,payload:e.payload,createdAt:e.createdAt}));const member={accountId:target.accountId,displayName:target.displayName,playerRole:target.playerRole,team:target.team,score:target.score,online:target.online,hostRole:target.hostRole,isOwner:target.isOwner,ready:target.ready};res.json({ok:true,data:{member,events}});}catch(error){next(error);}});
  app.post('/api/rooms/:code/rejoin',async(req,res,next)=>{try{const room=await roomForMember(store,req.params.code,req.auth!.accountId);ensureOpen(room);const member=room.members.find(item=>item.accountId===req.auth!.accountId)!;member.online=true;await store.saveRoom(room);broadcast(room.code,{type:'room:member-upsert',member});res.json({ok:true,data:{room:playerSnapshot(room,req.auth!.accountId)}});}catch(error){next(error);}});
  app.post('/api/rooms/:code/join',async(req,res,next)=>{try{const code=roomCodeSchema.parse(req.params.code.toUpperCase());const room=await loadRoom(store,code);if(!room)return res.status(404).json({ok:false,error:'没有找到这个房间'});ensureOpen(room);let member=room.members.find(item=>item.accountId===req.auth!.accountId);if(!member){const user=await store.findUserById(req.auth!.accountId);if(!user)throw new Error('账号不存在');member=memberFor(user.id,user.displayName);room.members.push(member);}member.online=true;await store.saveRoom(room);const profile=await store.getProfile(req.auth!.accountId);const defaultRole=profile.roles.find(role=>role.ipTheme===room.ipTheme&&role.isDefault)??profile.roles.find(role=>role.ipTheme===room.ipTheme)??null;if(profile.mbti&&defaultRole)void prewarmDontPool(room.code,req.auth!.accountId,{gameId:'dont',mbti:profile.mbti,role:defaultRole,playerCount:room.members.length,cameraAvailable:false}).catch(()=>undefined);broadcast(code,{type:'room:member-upsert',member});res.json({ok:true,data:{room:playerSnapshot(room,req.auth!.accountId),defaultRole}});}catch(error){next(error);}});
  app.put('/api/rooms/:code/role',async(req,res,next)=>{try{const room=await roomForMember(store,req.params.code,req.auth!.accountId);ensureOpen(room);const profile=await store.getProfile(req.auth!.accountId);const role=profile.roles.find(item=>item.id===req.body.ipRoleId&&item.ipTheme===room.ipTheme);if(!role)return res.status(400).json({ok:false,error:'请选择当前 IP 下的角色'});const member=room.members.find(item=>item.accountId===req.auth!.accountId)!;member.ipRoleId=role.id;member.playerRole=role.name;member.team=String(req.body.team||`${room.ipTheme}队`).slice(0,30);member.ready=false;if(profile.mbti){const context={gameId:'must' as const,mbti:profile.mbti,role,playerCount:room.members.length,cameraAvailable:false};await prewarmMustPool(store,room.id,req.auth!.accountId,context);void prewarmDontPool(room.code,req.auth!.accountId,{...context,gameId:'dont'}).catch(()=>undefined);}member.ready=Boolean(req.body.ready??true);await store.saveRoom(room);broadcast(room.code,{type:'room:member-upsert',member});res.json({ok:true,data:{room:playerSnapshot(room,req.auth!.accountId)}});}catch(error){next(error);}});
  app.post('/api/rooms/:code/actions',async(req,res,next)=>{try{
    const input=actionSchema.parse(req.body);let duplicate=false;
    const room=await store.atomic(async store=>{
      const room=await roomForMember(store,req.params.code,req.auth!.accountId);ensureOpen(room);
      if(input.gameId==='story'&&input.payload?.sessionId!==undefined&&input.payload.sessionId!==room.game?.sessionId)throw new Error('场次已更新，请刷新后重试');
      if(!await store.markAction(input.actionId,room.id,req.auth!.accountId,input.gameId,input.action,input.payload)){if(input.gameId==='auction')throw new Error('重复请求，请勿重复提交');duplicate=true;return room;}
      let asset:AssetRecord|null=null;
      if(input.gameId==='auction'&&input.action==='auction-submit-item'){
        asset=await store.getAsset(String(input.payload?.assetId??''));
        if(!asset)throw new Error('找不到该图片，请重新上传');
        if(asset.accountId!==req.auth!.accountId)throw new Error('只能提交自己上传的图片');
        if(asset.roomId!==room.id)throw new Error('图片不属于当前房间，请重新上传');
        if(asset.usedInSessionId)throw new Error('图片已经用于其他拍品，请重新上传');
      }
      if(input.gameId==='undercover'&&input.action==='undercover-deal'){
        const undercover=undercoverState(room);if(room.status!=='running'||!undercover||undercover.stage!=='setup')throw new Error('只能在卧底准备阶段生成词语');
        if(!room.members.some(m=>m.accountId===req.auth!.accountId&&m.hostRole))throw new Error('只有主持可以开始发牌');
        beginUndercover(room,req.auth!.accountId,await generateUndercoverWords(room.ipTheme,undercover.participants.map(p=>p.playerRole)));
      }else if(input.gameId==='story'&&input.action==='story-generate'){
        const story=storyState(room);if(room.status!=='running'||!story||story.stage!=='setup')throw new Error('只能在故事准备阶段生成');
        if(!room.members.some(m=>m.accountId===req.auth!.accountId&&m.hostRole))throw new Error('只有主持可以生成故事');
        applyStoryBundle(room,await generateStoryBundle(story.participants),'ai');
      }else if(input.gameId==='dont'&&input.action==='change-challenge'){
        const profile=await store.getProfile(req.auth!.accountId);const member=room.members.find(item=>item.accountId===req.auth!.accountId);const role=profile.roles.find(item=>item.id===member?.ipRoleId);if(!profile.mbti||!role)throw new Error('请先设置 MBTI 和角色');
        const challenge=await takeDontChallenge(room.code,req.auth!.accountId,{gameId:'dont',mbti:profile.mbti,role,playerCount:room.members.filter(item=>item.ready).length,cameraAvailable:false},usedDontContents(room));replacePlayerChallenge(room,req.auth!.accountId,challenge);
      }else if(input.gameId==='must'&&input.action==='must-forced-change'){
        const profile=await store.getProfile(req.auth!.accountId);const member=room.members.find(item=>item.accountId===req.auth!.accountId);const role=profile.roles.find(item=>item.id===member?.ipRoleId);if(!profile.mbti||!role)throw new Error('请先设置 MBTI 和角色');
        const challenge=await takeMustChallenge(store,room.id,req.auth!.accountId,{gameId:'must',mbti:profile.mbti,role,playerCount:room.members.filter(item=>item.ready).length,cameraAvailable:false},currentMustContents(room,req.auth!.accountId));replacePlayerChallenge(room,req.auth!.accountId,challenge,true);
      }else if(input.gameId==='draw'&&input.action==='draw-guess'){
        const draw=room.game?.privateState?.draw as {word?:string}|undefined;const word=draw?.word??'';const guess=String(input.payload?.guess||'').trim();
        const correct=word?await judgeGuess(word,guess):false;input.payload={...(input.payload as Record<string,unknown>),correct};handleGameAction(room,req.auth!.accountId,input);
      }else handleGameAction(room,req.auth!.accountId,input);
      if(asset)await store.saveAsset({...asset,usedInSessionId:room.game!.sessionId,usedAt:new Date().toISOString()});
      await persistRoom(store,room);
      if(room.game)await store.addGameEvent(room.game.sessionId,req.auth!.accountId,input.action,['witch','dont','must','truth','story','shopping','undercover'].includes(input.gameId)?'public_after_settle':'public',input.payload??{});
      return room;
    });
    if(!duplicate)broadcastRoom(room);res.json({ok:true,data:{...(duplicate?{duplicate:true}:{}),room:playerSnapshot(room,req.auth!.accountId)}});
  }catch(error){next(error);}});
  app.post('/api/rooms/:code/host-actions',async(req,res,next)=>{try{
    const result=await store.atomic(async store=>{
    const room=await roomForMember(store,req.params.code,req.auth!.accountId);ensureOpen(room);const actor=room.members.find(item=>item.accountId===req.auth!.accountId)!;
    const beforeAuction=room.currentGame==='auction'?structuredClone(room.game?.publicState.currentLot):null;
    if(!actor.hostRole)return {status:403,body:{ok:false,error:'没有主持权限'}};const action=String(req.body.action||'');
    const rawOptions=req.body.options as {rounds?:unknown;boardSize?:unknown}|undefined;const options:{rounds?:number;boardSize?:number}|undefined=rawOptions?{rounds:Number.isInteger(Number(rawOptions.rounds))?Number(rawOptions.rounds):undefined,boardSize:Number.isInteger(Number(rawOptions.boardSize))?Number(rawOptions.boardSize):undefined}:undefined;
    if(action==='set-plan'){
      const requested=normalizeRequestedPlan(req.body.gamePlan);const locked=room.gamePlan.slice(0,room.planCursor);const upcomingCount=requested.length-locked.length;if(upcomingCount<0||upcomingCount>12)return {status:400,body:{ok:false,error:'后续编排最多保留 12 场尚未开始的游戏'}};if(requested.length===0)return {status:400,body:{ok:false,error:'聚会编排至少需要保留一场游戏或历史经历'}};if(locked.some((item,index)=>requested[index]?.id!==item.id||requested[index]?.gameId!==item.gameId))return {status:409,body:{ok:false,error:'已开始或已完成的游戏经历不能删除、改序或覆盖'}};if(new Set(requested.map(item=>item.id)).size!==requested.length)return {status:400,body:{ok:false,error:'编排项标识不能重复'}};room.gamePlan=requested;
    }else if(action==='start'){
      if(room.game&&room.game.phase!=='settled')await settleBeforeStarting(store,room,actor.accountId,'主持跳过当前游戏');const requestedId=String(req.body.gameId||'') as GameId;if(!GAME_IDS.includes(requestedId))throw new Error('请先编排至少一场游戏');const planIdx=room.gamePlan.findIndex(p=>p.gameId===requestedId);if(planIdx<0)throw new Error('该游戏不在当前编排中');const targetPlan=room.gamePlan[planIdx];await prepareAndStartGame(store,room,requestedId,targetPlan.id,options);room.planCursor=Math.max(room.planCursor,planIdx+1);room.planRound=1;
    }else if(action==='start-next'){
      await settleBeforeStarting(store,room,actor.accountId,'提前开始下一场');const planned=room.gamePlan[room.planCursor];if(!planned)throw new Error('聚会编排中没有下一场游戏');await prepareAndStartGame(store,room,planned.gameId,planned.id,options);const total=planned.rounds??1;if(room.planRound<total)room.planRound++;else{room.planRound=1;room.planCursor=Math.min(room.planCursor+1,room.gamePlan.length);}
    }else if(action==='replay-game'){
      if(room.gamePlan.length-room.planCursor>=12)throw new Error('后续编排最多保留 12 场，请先调整尚未开始的项目');const sourceSessionId=String(req.body.sourceSessionId||'');const source=await store.getGameSessionRecord(sourceSessionId);const sourceGame=source?.state as {game?:GameSnapshot}|undefined;if(!source||source.roomId!==room.id||(source.endedAt===null&&sourceGame?.game?.phase!=='settled'))throw new Error('只能重玩本房间已经完成的游戏');await settleBeforeStarting(store,room,actor.accountId,'重玩历史游戏');const replayItem=createPlanItem(source.gameId);room.gamePlan.splice(room.planCursor,0,replayItem);room.planRound=1;await prepareAndStartGame(store,room,source.gameId,replayItem.id,options);room.planCursor=Math.min(room.planCursor+1,room.gamePlan.length);
    }else if(action==='pause')room.status='paused';
    else if(action==='resume')room.status='running';
    else if(action==='add-time'){if(room.game?.endsAt)room.game.endsAt+=300_000;}
    else if(action==='settle'){if(room.currentGame==='undercover'&&undercoverState(room)?.stage!=='complete')abortUndercover(room);settleGame(room);}
    else if(action==='restart-draw'){if(room.currentGame!=='draw'||!room.game)throw new Error('当前不是你画我猜');restartDrawGame(room);await store.addAudit(room.id,actor.accountId,'restart-draw','重新开始你画我猜',{});}
    else if(action==='advance-stage'){const reason=requiredReason(req.body.reason);const before=room.game?{phase:room.game.phase,round:room.game.round}:null;if(room.currentGame==='story'){const story=storyState(room)!;if(req.body.expectedStage!==story.stage||(story.stage==='relay'&&req.body.expectedSpeakerId!==story.order[story.currentSpeakerIndex]))throw new Error('进程已更新，请刷新后重试');}advanceGameStage(room);await store.addAudit(room.id,actor.accountId,'advance-stage',reason,{before,after:room.game?{phase:room.game.phase,round:room.game.round}:null});}
    else if(action==='replace-player-word'||action==='set-player-word'||action==='adjust-word-count'){
      if(room.currentGame!=='dont'||!room.game)throw new Error('当前不是不要做挑战');const reason=requiredReason(req.body.reason);const targetAccountId=String(req.body.targetAccountId||'');const target=room.members.find(item=>item.accountId===targetAccountId&&item.ready);if(!target)throw new Error('没有找到该玩家');const before=gameOverview(room,actor.accountId)?.players.find(item=>item.accountId===targetAccountId);
      if(action==='replace-player-word'){const profile=await store.getProfile(targetAccountId);const role=profile.roles.find(item=>item.id===target.ipRoleId);if(!profile.mbti||!role)throw new Error('该玩家尚未设置 MBTI 或角色');const challenge=await takeDontChallenge(room.code,targetAccountId,{gameId:'dont',mbti:profile.mbti,role,playerCount:room.members.filter(item=>item.ready).length,cameraAvailable:false},usedDontContents(room));replacePlayerChallenge(room,targetAccountId,challenge);}
      if(action==='set-player-word')setPlayerChallenge(room,targetAccountId,String(req.body.content||''));
      if(action==='adjust-word-count')setDontWordCount(room,targetAccountId,Number(req.body.wordCount));
      const after=gameOverview(room,actor.accountId)?.players.find(item=>item.accountId===targetAccountId);await store.addAudit(room.id,actor.accountId,action,reason,{targetAccountId,before,after});
    }else if(action==='close-room'){const reason=requiredReason(req.body.reason);room.closedAt=new Date().toISOString();room.status='stopped';await store.addAudit(room.id,actor.accountId,'close-room',reason);}
    else if(action==='emergency'){const reason=requiredReason(req.body.reason);room.status='stopped';await store.addAudit(room.id,actor.accountId,'emergency-stop',reason);}
    else if(action==='audit-view'){const reason=requiredReason(req.body.reason);await store.addAudit(room.id,actor.accountId,'private-audit',reason,{targetAccountId:req.body.targetAccountId});}
    else if(action==='remove-member'){const targetAccountId=String(req.body.targetAccountId||'');if(targetAccountId===actor.accountId)throw new Error('不能踢出自己');const target=room.members.find(item=>item.accountId===targetAccountId);if(!target)throw new Error('没有找到该成员');broadcast(room.code,{type:'room:kicked',roomCode:room.code},targetAccountId);room.members=room.members.filter(item=>item.accountId!==targetAccountId);if(room.game){const gs=room.game.privateState;if(gs){if(gs.order&&Array.isArray(gs.order))gs.order=(gs.order as string[]).filter(id=>id!==targetAccountId);if(gs.drawings&&Array.isArray(gs.drawings)&&gs.currentIndex!=null){gs.drawings=(gs.drawings as string[]).filter((_,i)=>i<=(gs.currentIndex as number));}if(gs.truth&&typeof gs.truth==='object'){(gs.truth as Record<string,unknown>).submissions=Object.fromEntries(Object.entries((gs.truth as {submissions?:Record<string,unknown>}).submissions??{}).filter(([k])=>k!==targetAccountId));}}}await store.addAudit(room.id,actor.accountId,'remove-member','踢出成员',{targetAccountId,displayName:target.displayName});}
    else if(action==='set-team'){const targetAccountId=String(req.body.targetAccountId||'');const team=String(req.body.team||'未分队').slice(0,30);const target=room.members.find(item=>item.accountId===targetAccountId);if(!target)throw new Error('没有找到该成员');target.team=team;await store.addAudit(room.id,actor.accountId,'set-team','调整队伍',{targetAccountId,displayName:target.displayName,team});}
    else if(action==='rename-team'){const oldName=String(req.body.oldName||'');const newName=String(req.body.newName||'').trim().slice(0,30);if(!oldName)throw new Error('原队名不能为空');if(!newName)throw new Error('新队名不能为空');if(newName==='未分队')throw new Error('"未分队"是保留名');if(oldName===newName)throw new Error('新旧队名相同');const affected=room.members.filter(m=>m.team===oldName);if(!affected.length)throw new Error('没有找到该队伍');affected.forEach(m=>m.team=newName);await store.addAudit(room.id,actor.accountId,'rename-team','重命名队伍',{oldName,newName,memberCount:affected.length});}
    else if(action==='delete-team'){const teamName=String(req.body.team||'');if(!teamName)throw new Error('队名不能为空');if(teamName==='未分队')throw new Error('不能删除保留队伍');const affected=room.members.filter(m=>m.team===teamName);affected.forEach(m=>m.team='未分队');await store.addAudit(room.id,actor.accountId,'delete-team','解散队伍',{team:teamName,memberCount:affected.length});}
    else if(action==='transfer-owner'){if(!actor.isOwner)throw new Error('只有房主可以转让');const targetAccountId=String(req.body.targetAccountId||'');if(targetAccountId===actor.accountId)throw new Error('不能转让给自己');const target=room.members.find(item=>item.accountId===targetAccountId);if(!target)throw new Error('没有找到该成员');actor.isOwner=false;actor.hostRole=null;target.isOwner=true;target.hostRole='owner';await store.addAudit(room.id,actor.accountId,'transfer-owner','转让房主',{targetAccountId,displayName:target.displayName});}
    else throw new Error('未知主持操作');
    await persistRoom(store,room,action==='settle'||action==='close-room');if(action==='advance-stage'&&beforeAuction&&room.game){const lot=(room.game.privateState?.auction as {lots:Array<{lotId:string;soldAt:number|null}>}).lots.find(l=>l.lotId===(beforeAuction as {lotId:string}).lotId);if(lot?.soldAt)await store.addGameEvent(room.game.sessionId,actor.accountId,'auction-sold','public',{...lot});}if(room.game){const visibility=action==='replace-player-word'||action==='set-player-word'||action==='adjust-word-count'?'public_after_settle':'public';await store.addGameEvent(room.game.sessionId,actor.accountId,action,visibility,eventPayload(action,req.body));}return {status:200,body:{ok:true,data:{room:playerSnapshot(room,req.auth!.accountId)}},room};
    });if(result.room)broadcastRoom(result.room);res.status(result.status).json(result.body);
  }catch(error){next(error);}});

  app.post('/api/reviews/:id/decision',async(req,res,next)=>{try{const ownerAccountId=String(req.body.ownerAccountId||'');if(ownerAccountId===req.auth!.accountId)return res.status(403).json({ok:false,error:'不能审核自己的提交'});await store.addAudit(String(req.body.roomId||''),req.auth!.accountId,'review-decision',String(req.body.reason||'审核处理'),{reviewId:req.params.id,decision:req.body.decision,ownerAccountId});res.json({ok:true});}catch(error){next(error);}});
  app.post('/api/content/generate',async(req,res,next)=>{try{const profile=await store.getProfile(req.auth!.accountId);const role=profile.roles.find(item=>item.id===req.body.ipRoleId);if(!profile.mbti||!role)return res.status(400).json({ok:false,error:'请先设置 MBTI 和角色'});const result=await generateContent({gameId:req.body.gameId,mbti:profile.mbti,role,playerCount:Math.max(2,Number(req.body.playerCount)||2),seenIds:req.body.seenIds,cameraAvailable:Boolean(req.body.cameraAvailable)});res.json({ok:true,data:result});}catch(error){next(error);}});

  app.get('/api/games',(_req,res)=>res.json({ok:true,data:{games:Object.values(GAME_DEFINITIONS)}}));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const message=error instanceof Error?error.message:'请求处理失败';res.status(400).json({ok:false,error:message});});
  return app;
}

function setSession(res:express.Response,token:string){res.cookie('rxj_session',token,{httpOnly:true,sameSite:'lax',secure:config.cookieSecure,maxAge:7*24*60*60*1000});}
async function loadRoom(store:Store,codeInput:string){const code=roomCodeSchema.parse(codeInput.toUpperCase());const found=await store.getRoom(code);if(!found)return null;const room=normalizeRoom(found);if(room.game?.sessionId){const saved=await store.getGameSession(room.game.sessionId) as {game?:GameSnapshot;runtime?:PersistedRuntime}|null;if(saved?.game)room.game=saved.game;if(saved?.runtime)restoreRuntime(room,saved.runtime);ensureStoryGame(room);ensureShoppingGame(room);ensureUndercover(room);await upgradeRunningSecretMissions(store,room);}return room;}
async function roomForMember(store:Store,codeInput:string,accountId:string){const room=await loadRoom(store,codeInput);if(!room)throw new Error('没有找到这个房间');if(!room.members.some(member=>member.accountId===accountId))throw new Error('请先加入房间');return room;}
function normalizeRoom(room:RoomSnapshot){const raw=(Array.isArray(room.gamePlan)&&room.gamePlan.length?room.gamePlan:planFor(30,4)) as unknown[];room.gamePlan=raw.map((value,index)=>{if(typeof value==='string')return {id:`legacy-${room.id}-${index}-${value}`,gameId:value as GameId,createdAt:'1970-01-01T00:00:00.000Z',rounds:1};const item=value as GamePlanItem;const rawRounds=Number(item.rounds);const rounds=Number.isInteger(rawRounds)&&rawRounds>=1&&rawRounds<=99?rawRounds:1;return {...item,rounds};}).filter(item=>GAME_IDS.includes(item.gameId));room.planCursor=Number.isInteger(room.planCursor)?Math.max(0,Math.min(room.planCursor,room.gamePlan.length)):0;room.planRound=Number.isInteger(room.planRound)?Math.max(1,room.planRound):1;room.closedAt=room.closedAt??null;if(room.game&&!room.game.sessionId)room.game.sessionId=randomUUID();if(room.game&&room.game.planItemId===undefined)room.game.planItemId=room.gamePlan[Math.max(0,room.planCursor-1)]?.id??null;ensureWitchGame(room);ensureAuctionGame(room);ensureStoryGame(room);ensureShoppingGame(room);ensureUndercover(room);return ensureTruthGame(room);}
async function persistRoom(store:Store,room:RoomSnapshot,ended=false){await store.saveRoom(room);if(room.game)await store.saveGameSession(room,{game:room.game,runtime:serializeRuntime(room)},ended);}
async function settleBeforeStarting(store:Store,room:RoomSnapshot,actorAccountId:string,reason:string){if(!room.game||room.game.phase==='settled')return;const sessionId=room.game.sessionId;settleGame(room);await persistRoom(store,room,true);await store.addGameEvent(sessionId,actorAccountId,'settle','public',{reason});}
async function prepareAndStartGame(store:Store,room:RoomSnapshot,gameId:GameId,planItemId:string|null,options?:{rounds?:number;boardSize?:number}){const profiles=new Map<string,{mbti:Mbti;role:IpRole}>();for(const member of room.members.filter(item=>item.ready)){const profile=await store.getProfile(member.accountId);const role=profile.roles.find(item=>item.id===member.ipRoleId);if(profile.mbti&&role)profiles.set(member.accountId,{mbti:profile.mbti,role});}const challengeInputs=[...profiles].map(([accountId,profile])=>({accountId,context:{gameId,mbti:profile.mbti,role:profile.role,playerCount:profiles.size,cameraAvailable:false}}));let challenges:Map<string,Challenge>;if(gameId==='dont'){challenges=new Map();const raw=await Promise.all(challengeInputs.map(({accountId,context})=>takeDontChallenge(room.code,accountId,context,[])));raw.forEach((challenge,i)=>challenges.set(challengeInputs[i].accountId,challenge));}else if(gameId==='must'){challenges=new Map();const raw=await Promise.all(challengeInputs.map(({accountId,context})=>takeMustChallenge(store,room.id,accountId,context,[])));raw.forEach((challenge,i)=>challenges.set(challengeInputs[i].accountId,challenge));}else if(gameId==='truth'||gameId==='auction'||gameId==='story'||gameId==='shopping')challenges=new Map();else challenges=new Map(await Promise.all(challengeInputs.map(async({accountId,context})=>{const result=await generateContent(context);return [accountId,result.challenge] as const;})));let shoppingWallets:Record<string,number>|null=null;if(gameId==='shopping'){const sessions=await store.listGameSessions(room.id);const auction=[...sessions].reverse().find(session=>session.gameId==='auction'&&Boolean(session.endedAt));const saved=auction?.state as {game?:{privateState?:{auction?:{wallets?:Record<string,number>}}}}|undefined;shoppingWallets=saved?.game?.privateState?.auction?.wallets??null;}startGame(room,gameId,profiles,challenges,planItemId,shoppingWallets,options);}
async function upgradeRunningSecretMissions(store:Store,room:RoomSnapshot){if(room.currentGame!=='must'||!room.game||room.game.phase==='settled')return;room.game.prompt=GAME_DEFINITIONS.must.shortRule;room.game.primaryAction=GAME_DEFINITIONS.must.primaryAction;const active=room.members.filter(member=>member.ready);const used:string[]=[];let changed=false;for(const member of active){const existing=(playerSnapshot(room,member.accountId).game?.privateState?.challenge as {id?:string;content?:string}|undefined);if(existing?.id?.startsWith('must-v7-')&&isLowCorrelationSecretMission(existing.content??'')&&isDistinctSecretMission(existing.content??'',used)){used.push(existing.content??'');continue;}const profile=await store.getProfile(member.accountId);const role=profile.roles.find(item=>item.id===member.ipRoleId);if(!profile.mbti||!role)continue;const challenge=await takeMustChallenge(store,room.id,member.accountId,{gameId:'must',mbti:profile.mbti,role,playerCount:active.length,cameraAvailable:false},used);replacePlayerChallenge(room,member.accountId,challenge);used.push(challenge.content);changed=true;}if(changed)await persistRoom(store,room);}
function currentMustContents(room:RoomSnapshot,excludeAccountId?:string){return room.members.filter(member=>member.ready&&member.accountId!==excludeAccountId).map(member=>(playerSnapshot(room,member.accountId).game?.privateState?.challenge as {content?:string}|undefined)?.content).filter((content):content is string=>Boolean(content));}
function broadcastRoom(room:RoomSnapshot){broadcast(room.code,{type:'room:state',room:publicRoom(room)});for(const member of room.members)broadcast(room.code,{type:'game:private-state',room:playerSnapshot(room,member.accountId)},member.accountId);}
function requiredReason(value:unknown){const reason=String(value||'').trim();if(reason.length<4)throw new Error('请填写至少 4 个字的修改原因');return reason.slice(0,255);}
function ensureOpen(room:RoomSnapshot){if(room.closedAt)throw new Error('这场聚会已经结束，不能继续操作');}
function publicRoom(room:RoomSnapshot){const copy=structuredClone(room);if(copy.game)delete copy.game.privateState;return copy;}
function normalizeRequestedPlan(value:unknown):GamePlanItem[]{if(!Array.isArray(value))return [];const items=value.map(item=>{if(typeof item==='string'&&GAME_IDS.includes(item as GameId))return createPlanItem(item as GameId);if(item&&typeof item==='object'){const candidate=item as Partial<GamePlanItem>;if(typeof candidate.id==='string'&&candidate.id&&candidate.gameId&&GAME_IDS.includes(candidate.gameId)){const rawRounds=Number(candidate.rounds);const rounds=Number.isInteger(rawRounds)&&rawRounds>=1&&rawRounds<=99?rawRounds:1;return {id:candidate.id.slice(0,80),gameId:candidate.gameId,createdAt:typeof candidate.createdAt==='string'?candidate.createdAt:new Date().toISOString(),rounds};}}return null;});return items.some(item=>!item)?[]:items as GamePlanItem[];}
function eventPayload(action:string,body:Record<string,unknown>){if(action==='set-player-word')return {action,targetAccountId:body.targetAccountId,content:body.content};if(action==='replace-player-word'||action==='adjust-word-count')return {action,targetAccountId:body.targetAccountId,wordCount:body.wordCount};if(action==='replay-game')return {action,sourceSessionId:body.sourceSessionId};return {action};}

