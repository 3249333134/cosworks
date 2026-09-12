import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoomSnapshot } from '@ruxiju/shared';
import { createApp } from './app.js';
import { MemoryStore, autoPersist } from './store.js';
import { signSession } from './auth.js';
import { advanceGameStage, gameOverview, handleGameAction, playerSnapshot, restoreRuntime, serializeRuntime, settleGame, startGame } from './game-engine.js';
import { defaultStoryRuling, storyState, validateStoryBundle } from './story-engine.js';
import * as content from './content-service.js';
import { config } from './config.js';

function fixture():RoomSnapshot{return {id:randomUUID(),code:'STARY2',name:'故事测试',ipTheme:'同一房间',status:'waiting',ownerAccountId:'a',members:['a','b','c'].map((id,i)=>({id,accountId:id,displayName:`玩家${id}`,isOwner:i===0,hostRole:i===0?'owner':null,playerRole:`角色${id}`,ipRoleId:null,team:'未分队',ready:true,online:true,score:10})),currentGame:null,game:null,gamePlan:[{id:randomUUID(),gameId:'story',createdAt:new Date().toISOString()}],planCursor:0,planRound:1,closedAt:null};}
const bundle={endingHint:'小镇的困境会迎来转机，大家的关系也将改变。',opening:'小镇的灵泉忽然停止涌出，三人来到泉眼。',ending:'秘密结局：灵泉恢复，众人围坐分享食物。',tasks:{a:'秘密甲：找到水流的声音',b:'秘密乙：安抚担忧的村民',c:'秘密丙：找到古老地图'}};
const auth=(id:string)=>({Authorization:`Bearer ${signSession(id)}`});
describe('story lifecycle, privacy and concurrency',()=>{
  let room:RoomSnapshot,store:MemoryStore,app:ReturnType<typeof createApp>;
  const act=(id:string,action:string,payload:Record<string,unknown>={},actionId=randomUUID())=>request(app).post(`/api/rooms/${room.code}/actions`).set(auth(id)).send({gameId:'story',actionId,action,payload});
  const read=async()=>{room=(await store.getRoom(room.code))!;return storyState(room)!;};
  const next=async()=>{const s=await read();return act('a','story-next',{expectedStage:s.stage,expectedSpeakerId:s.order[s.currentSpeakerIndex]});};
  const start=async()=>{expect((await act('a','story-set-story',bundle)).status).toBe(200);expect((await next()).status).toBe(200);};
  const writeAll=async()=>{await start();const s=await read();for(const id of s.order)expect((await act(id,'story-submit-segment',{content:`角色${id}来到泉眼。他向大家展示自己的线索。`})).status).toBe(200);expect((await read()).stage).toBe('reveal');};
  beforeEach(async()=>{vi.restoreAllMocks();room=fixture();store=new MemoryStore();app=createApp(store);startGame(room,'story',new Map());await store.createRoom(room);});
  it('requires two participants and everyone ready; snapshots independent personas and order',async()=>{
    const waiting=fixture();waiting.members[2].ready=false;expect(()=>startGame(waiting,'story',new Map())).toThrow('所有');waiting.members=waiting.members.slice(0,1);expect(()=>startGame(waiting,'story',new Map())).toThrow('至少');
    await act('a','story-set-story',bundle);
    expect((await act('b','story-set-character',{playerRole:'跨 IP 自定义侦探',persona:'沉着冷静，善于推理'})).status).toBe(200);
    const s=await read();expect(s.participants[1].playerRole).toBe('跨 IP 自定义侦探');expect(room.members[1].playerRole).toBe('角色b');expect(s.tasks).toEqual({});
    expect((await next()).status).toBe(400);expect((await act('b','story-reorder',{order:['c','b','a']})).status).toBe(400);
    expect((await act('a','story-reorder',{order:['a','a','c']})).status).toBe(400);
    expect((await act('a','story-reorder',{order:['c','b','a']})).status).toBe(200);await start();expect((await read()).order).toEqual(['c','b','a']);
    expect((await act('b','story-set-character',{playerRole:'新',persona:'新'})).status).toBe(400);
  });
  it('filters endings and tasks from snapshots, overview, events and live history',async()=>{
    await start();await read();
    for(const id of ['b','c'] as const){
      const snapshot=playerSnapshot(room,id);expect(snapshot.game!.publicState.endingHint).toBe(bundle.endingHint);expect(snapshot.game!.publicState.ending).toBeUndefined();expect(JSON.stringify(snapshot)).not.toContain(bundle.ending);expect(JSON.stringify(snapshot)).not.toContain(bundle.tasks.a);
      const overview=gameOverview(room,id)!.story!;expect(overview.ending).toBeUndefined();expect(overview.ownTask).toBe(bundle.tasks[id]);
      const history=await request(app).get(`/api/rooms/${room.code}/sessions/${room.game!.sessionId}/history`).set(auth(id));expect(history.status).toBe(200);expect(JSON.stringify(history.body)).not.toContain(bundle.ending);expect(JSON.stringify(history.body)).not.toContain(bundle.tasks.a);
    }
    expect(gameOverview(room,'a')!.story!.ending).toBe(bundle.ending);
    // Legacy public snapshots must not leak through the snapshot reader.
    room.game!.publicState.ending=bundle.ending;expect(playerSnapshot(room,'b').game!.publicState.ending).toBeUndefined();
  });
  it('validates all task identities atomically and retains setup on AI failure',async()=>{
    expect(()=>validateStoryBundle({...bundle,tasks:{a:'only'}},storyState(room)!.participants)).toThrow('每位');
    expect((await act('a','story-set-story',{...bundle,tasks:{a:'one',b:'two',fake:'three'}})).status).toBe(400);expect((await read()).opening).toBe('');
    vi.spyOn(content,'generateStoryBundle').mockRejectedValueOnce(new Error('AI 未能生成完整故事')).mockResolvedValueOnce(bundle);
    expect((await act('b','story-generate')).status).toBe(400);expect((await act('a','story-generate')).status).toBe(400);expect((await read()).stage).toBe('setup');
    expect((await act('a','story-generate')).status).toBe(200);expect((await read()).tasks).toEqual(bundle.tasks);
  });
  it('serializes simultaneous submit/skip and rejects stale, duplicate and oversized requests',async()=>{
    await start();const s=await read();const first=s.order[0];const second=s.order[1];s.turnStartedAt=Date.now()-120000;await store.saveGameSession(room,{game:room.game});await store.saveRoom(room);
    expect((await act(first,'story-submit-segment',{content:'x'.repeat(501)})).status).toBe(400);
    expect((await act(second,'story-submit-segment',{content:'越权'})).status).toBe(400);
    const results=await Promise.all([act(first,'story-submit-segment',{content:`角色${first}出现。线索找到。`}),act('a','story-next',{expectedStage:'relay',expectedSpeakerId:first})]);
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect((await read()).currentSpeakerIndex).toBe(1);
    const actionId=randomUUID();expect((await act(second,'story-submit-segment',{content:`角色${second}出现。`},actionId)).status).toBe(200);await act(second,'story-submit-segment',{content:`角色${second}出现。`},actionId);expect((await read()).currentSpeakerIndex).toBe(2);
    expect((await act(s.order[2],'story-submit-segment',{content:'内容',sessionId:'stale-session'})).status).toBe(400);
  });
  it('reveals the ending before voting; hides totals until voting closes',async()=>{
    await writeAll();expect((await act('b','story-vote',{targetAccountId:'a'})).status).toBe(400);expect(gameOverview(room,'b')!.story!.ending).toBeUndefined();
    await next();expect(gameOverview(await store.getRoom(room.code) as RoomSnapshot,'b')!.story!.ending).toBe(bundle.ending);
    expect((await act('a','story-vote',{targetAccountId:'a'})).status).toBe(400);
    await act('a','story-vote',{targetAccountId:'b'});await read();expect(gameOverview(room,'b')!.story!.segments.every(seg=>seg.voteCount===0)).toBe(true);
    expect((await act('a','story-vote',{targetAccountId:'c'})).status).toBe(400);
    await act('b','story-vote',{targetAccountId:'a'});await act('c','story-vote',{targetAccountId:'a'});expect((await read()).stage).toBe('review');expect(storyState(room)!.points).toEqual({a:7,b:2,c:0});
  });
  it('requires unanimous other-player approval and reasons; applies overrides and negative totals once',async()=>{
    await writeAll();await next();await next();expect((await read()).stage).toBe('review');
    expect((await act('a','story-approve-task',{targetAccountId:'a',approved:true})).status).toBe(400);
    await act('b','story-approve-task',{targetAccountId:'a',approved:true});expect((await read()).points.a).toBe(0);
    await act('c','story-approve-task',{targetAccountId:'a',approved:true});expect((await read()).points.a).toBe(2);
    const rule={...defaultStoryRuling(),characterPresent:false,ooc:true,disconnected:true,endingConnection:true};
    expect((await act('a','story-rule',{targetAccountId:'a',...rule})).status).toBe(400);
    expect((await act('b','story-rule',{targetAccountId:'a',...rule,reason:'越权'})).status).toBe(400);
    await act('a','story-rule',{targetAccountId:'a',...rule,reason:'人设偏离且剧情断层，但衔接了结尾'});expect((await read()).points.a).toBe(-2);
    await act('a','story-rule',{targetAccountId:'b',...defaultStoryRuling(),spoiler:true,reason:'段落直接泄露预设结局'});expect((await read()).points.b).toBe(0);
    expect((await next()).status).toBe(400);await act('a','story-rule',{targetAccountId:'c',...defaultStoryRuling()});expect((await next()).status).toBe(200);
    await read();expect(room.members.map(m=>m.score)).toEqual([8,10,10]);settleGame(room);expect(room.members.map(m=>m.score)).toEqual([8,10,10]);
    expect(playerSnapshot(room,'b').game!.publicState.loserAccountIds).toEqual(['a']);
    const history=await request(app).get(`/api/rooms/${room.code}/sessions/${room.game!.sessionId}/history`).set(auth('b'));expect(history.body.data.history.story.details.a.total).toBe(-2);expect(history.body.data.history.story.ending).toBe(bundle.ending);
  });
  it('handles all skipped, zero eligible voters, and equal scores without punishment',async()=>{
    await start();await next();await next();await next();await next();expect((await read()).stage).toBe('review');await next();await read();expect(storyState(room)!.points).toEqual({a:-2,b:-2,c:-2});expect(room.game!.publicState.loserAccountIds).toEqual([]);
  });
  it('awards tied best votes and excludes only voters without candidates',async()=>{
    await writeAll();await next();await act('a','story-vote',{targetAccountId:'b'});await act('b','story-vote',{targetAccountId:'c'});await act('c','story-vote',{targetAccountId:'a'});expect((await read()).points).toEqual({a:5,b:5,c:5});
  });
  it('uses the same host progression and rejects repeated host skip',async()=>{
    await start();const s=await read();const current=s.order[s.currentSpeakerIndex];const url=`/api/rooms/${room.code}/host-actions`,body={action:'advance-stage',reason:'跳过当前玩家',expectedStage:'relay',expectedSpeakerId:current};
    expect((await request(app).post(url).set(auth('a')).send(body)).status).toBe(200);expect((await request(app).post(url).set(auth('a')).send(body)).status).toBe(400);expect((await read()).currentSpeakerIndex).toBe(1);
  });
  it('lets the sole author abstain automatically and still counts every other voter',async()=>{
    await start();const s=await read();const first=s.order[0];const others=s.order.filter(id=>id!==first);
    await act(first,'story-submit-segment',{content:'泉眼守护者发现线索。'});await next();await next();await next();
    expect((await read()).stage).toBe('voting');expect(gameOverview(room,first)!.story!.voterCount).toBe(2);
    await act(others[0],'story-vote',{targetAccountId:first});await act(others[1],'story-vote',{targetAccountId:first});expect((await read()).stage).toBe('review');
    const pts=storyState(room)!.points;expect(pts[first]).toBe(7);expect(pts[others[0]]).toBe(-2);expect(pts[others[1]]).toBe(-2);
  });
  it('reads legacy completed records without rescoring and migrates legacy reveal to review',()=>{
    room.game!.privateState={story:{stage:'reveal',opening:bundle.opening,ending:bundle.ending,segments:[{accountId:'a',content:'旧段落',task:'旧任务',submittedAt:Date.now(),taskCompleted:false}],votes:{},points:{a:3}}};
    expect(storyState(room)!.stage).toBe('review');expect(storyState(room)!.tasks.a).toBe('旧任务');
    const runtime=serializeRuntime(room);runtime.challenges.b={id:'legacy-task',gameId:'story',title:'旧任务',content:'旧玩家尚未完成的秘密任务'} as typeof runtime.challenges[string];restoreRuntime(room,runtime);expect(gameOverview(room,'b')!.story!.ownTask).toBe('旧玩家尚未完成的秘密任务');
    room.game!.phase='settled';const scores=room.members.map(m=>m.score);settleGame(room);expect(room.members.map(m=>m.score)).toEqual(scores);expect(storyState(room)!.points.a).toBe(3);
  });
});

it('restores story from a real memory snapshot across relay and review',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'story-restart-')),file=join(dir,'state.json');let stop:(()=>void)|undefined;
  try{
    let store=new MemoryStore();stop=autoPersist(store,file).close;const room=fixture();startGame(room,'story',new Map());
    const action=(id:string,action:string,payload:Record<string,unknown>)=>handleGameAction(room,id,{gameId:'story',actionId:randomUUID(),action,payload});
    action('a','story-set-story',bundle);advanceGameStage(room);const order=storyState(room)!.order;action(order[0],'story-submit-segment',{content:`角色${order[0]}出现。`});
    await store.atomic(async tx=>{await tx.createRoom(room);await tx.saveGameSession(room,{game:room.game});});const before=structuredClone(storyState(room));stop();store=new MemoryStore();stop=autoPersist(store,file).close;expect(storyState((await store.getRoom(room.code))!)).toEqual(before);
    action(order[1],'story-submit-segment',{content:`角色${order[1]}出现。`});action(order[2],'story-submit-segment',{content:`角色${order[2]}出现。`});advanceGameStage(room);action(order[0],'story-vote',{targetAccountId:order[1]});advanceGameStage(room);action(order[1],'story-approve-task',{targetAccountId:order[0],approved:true});action('a','story-rule',{targetAccountId:order[0],...defaultStoryRuling()});
    await store.atomic(async tx=>{await tx.saveRoom(room);await tx.saveGameSession(room,{game:room.game});});stop();store=new MemoryStore();stop=autoPersist(store,file).close;const restored=(await store.getRoom(room.code))!;expect(storyState(restored)).toEqual(storyState(room));expect(gameOverview(restored,order[1])).toEqual(gameOverview(room,order[1]));
  }finally{stop?.();await rm(dir,{recursive:true,force:true});}
});

it('validates real AI response structure and handles provider failure without fallback',async()=>{
  const original={...config.ai};Object.assign(config.ai,{provider:'test',key:'test',url:'https://invalid.test',model:'test'});
  try{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(bundle)}}]})}).mockResolvedValueOnce({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({...bundle,tasks:{}})}}]})}).mockResolvedValueOnce({ok:false}));
    const participants=fixture().members.map(m=>({...m,persona:m.playerRole}));expect(await content.generateStoryBundle(participants)).toEqual(bundle);await expect(content.generateStoryBundle(participants)).rejects.toThrow('完整故事');await expect(content.generateStoryBundle(participants)).rejects.toThrow('完整故事');
  }finally{Object.assign(config.ai,original);vi.unstubAllGlobals();}
});
