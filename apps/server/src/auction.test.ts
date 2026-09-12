import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RoomSnapshot } from '@ruxiju/shared';
import { createApp } from './app.js';
import { MemoryStore } from './store.js';
import { signSession } from './auth.js';
import { gameOverview, handleGameAction, playerSnapshot, startGame } from './game-engine.js';

const files:string[]=[];
afterAll(async()=>{await Promise.allSettled(files.map(file=>unlink(resolve('data',file))));});
describe('auction API and persistence',()=>{
  let store:MemoryStore;let app:ReturnType<typeof createApp>;let room:RoomSnapshot;let ids:string[];
  const auth=(id:string)=>({Authorization:`Bearer ${signSession(id)}`});
  const act=(id:string,action:string,payload:Record<string,unknown>={},actionId=randomUUID())=>request(app).post(`/api/rooms/${room.code}/actions`).set(auth(id)).send({gameId:'auction',actionId,action,payload});
  const advance=()=>request(app).post(`/api/rooms/${room.code}/host-actions`).set(auth(ids[0])).send({action:'advance-stage',reason:'测试主持推进'});
  beforeEach(async()=>{
    store=new MemoryStore();app=createApp(store);ids=[];
    for(let i=0;i<3;i++)ids.push((await store.createUser(`auction${i}`,'unused',`玩家${i}`)).id);
    room={id:randomUUID(),code:'ABCD23',name:'拍卖验证',ipTheme:'测试',status:'waiting',ownerAccountId:ids[0],members:ids.map((id,i)=>({id:randomUUID(),accountId:id,displayName:`玩家${i}`,isOwner:i===0,hostRole:i===0?'owner':null,playerRole:'收藏家',ipRoleId:null,team:'队',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[{id:randomUUID(),gameId:'auction',createdAt:new Date().toISOString()}],planCursor:0,planRound:1,closedAt:null};
    await store.createRoom(room);
    const started=await request(app).post(`/api/rooms/${room.code}/host-actions`).set(auth(ids[0])).send({action:'start'});expect(started.status).toBe(200);
    room=(await store.getRoom(room.code))!;
  });
  async function image(id=ids[0],roomId=room.id){
    const bytes=await sharp({create:{width:2400,height:1200,channels:3,background:'#bb8844'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const response=await request(app).post('/api/media/upload').set(auth(id)).field('roomId',roomId).attach('file',bytes,{filename:'photo.jpg',contentType:'image/jpeg'});
    expect(response.status).toBe(201);const asset=await store.getAsset(response.body.data.assetId);files.push(asset!.imagePath!,asset!.thumbPath!);return response.body.data;
  }
  async function setup(){for(const id of ids)expect((await act(id,'auction-set-budget',{initialBudget:100})).status).toBe(200);}
  it('accepts multipart, normalizes orientation and strips EXIF, authenticates reads',async()=>{
    const asset=await image();expect(asset).toMatchObject({mime:'image/webp',width:960,height:1920});expect(asset.asset).toBeUndefined();
    expect((await request(app).get(asset.url)).status).toBe(401);
    const main=await request(app).get(asset.url).set(auth(ids[1]));expect(main.status).toBe(200);
    const meta=await sharp(main.body).metadata();expect(meta.exif).toBeUndefined();expect(meta.orientation).toBeUndefined();expect(meta.format).toBe('webp');
    const thumb=await request(app).get(asset.thumb).set(auth(ids[2]));const small=await sharp(thumb.body).metadata();expect(Math.max(small.width!,small.height!)).toBe(320);
    expect((await store.getAsset(asset.assetId))!.dataUrl).toBeNull();
    for(const type of ['image/gif','text/html'])expect((await request(app).post('/api/media/upload').set(auth(ids[0])).attach('file',Buffer.from('bad'),{filename:'bad',contentType:type})).status).toBe(400);
    const huge=await request(app).post('/api/media/upload').set(auth(ids[0])).attach('file',Buffer.alloc(8*1024*1024+1),{filename:'huge.jpg',contentType:'image/jpeg'});expect(huge.status).toBe(400);expect(huge.body.error).toContain('8 MB');
    const heic=await request(app).post('/api/media/upload').set(auth(ids[0])).attach('file',Buffer.from('invalid'),{filename:'camera.heic',contentType:'image/heic'});expect(heic.status).toBe(400);expect(heic.body.error).toContain('HEIC');
  });
  it('restores zero budget locks through JSON and migrates legacy nonzero budgets',async()=>{
    expect((await act(ids[0],'auction-set-budget',{initialBudget:0})).status).toBe(200);
    const restored=JSON.parse(JSON.stringify(await store.getRoom(room.code))) as RoomSnapshot;
    expect(playerSnapshot(restored,ids[0]).game?.privateState?.auction).toMatchObject({hasBudget:true,budget:0});
    expect(()=>handleGameAction(restored,ids[0],{gameId:'auction',actionId:randomUUID(),action:'auction-set-budget',payload:{initialBudget:20}})).toThrow('已经');
    const state=restored.game!.privateState!.auction as any;state.budgetSubmitted={};state.budgets[ids[1]]=25;
    expect(playerSnapshot(restored,ids[1]).game?.privateState?.auction).toMatchObject({hasBudget:true,budget:25});
    expect(playerSnapshot(restored,ids[0]).game?.privateState?.auction).toMatchObject({hasBudget:false,budget:null});
    for(const value of [-1,1000001,0.001,0.100000000001,'1',null])expect((await act(ids[1],'auction-set-budget',{initialBudget:value})).status).toBe(400);
  });
  it('rejects foreign, wrong-room, used and forged assets; binds once on success',async()=>{
    await setup();const own=await image();const foreign=await image(ids[1]);const other=await image(ids[0],randomUUID());
    for(const assetId of [foreign.assetId,other.assetId,'forged'])expect((await act(ids[0],'auction-submit-item',{assetId,title:'怀表',story:'故事'})).status).toBe(400);
    expect((await act(ids[0],'auction-submit-item',{assetId:own.assetId,title:'怀表',story:'故事'})).status).toBe(200);
    expect(await store.getAsset(own.assetId)).toMatchObject({usedInSessionId:room.game!.sessionId});
    const used=await store.getAsset(foreign.assetId);await store.saveAsset({...used!,usedInSessionId:'previous'});
    expect((await act(ids[1],'auction-submit-item',{assetId:foreign.assetId,title:'怀表',story:'故事'})).status).toBe(400);
  });
  it('serializes bids and rotating seller settlement, preserves events and wallet totals after reload',async()=>{
    await setup();for(const id of ids){const asset=await image(id);expect((await act(id,'auction-submit-item',{assetId:asset.assetId,title:'怀表',story:'完整故事'})).status).toBe(200);}
    expect((await advance()).status).toBe(200);
    const id=randomUUID();const responses=await Promise.all([act(ids[1],'auction-bid',{price:10},id),act(ids[2],'auction-bid',{price:20}),act(ids[1],'auction-bid',{price:15}),act(ids[1],'auction-bid',{price:10},id)]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,200,400,400]);
    const current=JSON.parse(JSON.stringify(await store.getRoom(room.code))) as RoomSnapshot;
    expect(gameOverview(current,ids[0])?.auction?.topBid?.price).toBe(20);
    expect((await act(ids[0],'auction-bid',{price:30})).status).toBe(400);
    expect((await act(ids[1],'auction-bid',{price:100.01})).status).toBe(400);
    expect((await act(ids[1],'auction-bid',{price:20.001})).status).toBe(400);
    expect((await act(ids[1],'auction-sold')).status).toBe(400);
    expect((await act(ids[0],'auction-sold')).status).toBe(200);
    expect((await act(ids[0],'auction-pass-lot')).status).toBe(400);
    expect((await advance()).status).toBe(400);
    expect((await act(ids[1],'auction-bid',{price:1})).status).toBe(400);
    expect((await act(ids[1],'auction-pass-lot',{lotId:'stale-lot'})).status).toBe(400);
    expect((await act(ids[1],'auction-pass-lot')).status).toBe(200);
    expect((await act(ids[1],'auction-sold')).status).toBe(400);
    expect((await act(ids[2],'auction-sold')).status).toBe(200);
    const done=(await store.getRoom(room.code))!;const overview=gameOverview(done,ids[0])!.auction!;
    expect(overview).toMatchObject({stage:'complete',currentLot:null,topBid:null,soldCount:1});expect(Object.values(overview.wallets).reduce((a,b)=>a+b,0)).toBe(300);expect(overview.wallets[ids[0]]).toBe(120);expect(overview.wallets[ids[2]]).toBe(80);
    const history=await request(app).get(`/api/rooms/${room.code}/sessions/${room.game!.sessionId}/history`).set(auth(ids[1]));
    expect(history.body.data.history.auction.lots[0].bidHistory).toHaveLength(2);expect(history.body.data.history.auction.auctionRanking).toHaveLength(1);
    const events=await store.listGameEvents(room.game!.sessionId);expect(events.filter(e=>e.eventType==='auction-bid')).toHaveLength(2);
    const scores=done.members.map(m=>m.score);await request(app).post(`/api/rooms/${room.code}/host-actions`).set(auth(ids[0])).send({action:'settle'});expect((await store.getRoom(room.code))!.members.map(m=>m.score)).toEqual(scores);
  });
  it('requires every member ready and permits forced zero budgets and skipped sellers',async()=>{
    const waiting=structuredClone(room);waiting.members[2].ready=false;expect(()=>startGame(waiting,'auction',new Map())).toThrow('所有');
    expect((await advance()).status).toBe(200);expect((await advance()).status).toBe(400);
    const asset=await image();expect((await act(ids[0],'auction-submit-item',{assetId:asset.assetId,title:'笔',story:'故事'})).status).toBe(200);expect((await advance()).status).toBe(200);expect((await advance()).status).toBe(200);
    expect((await act(ids[1],'auction-bid',{price:0.1})).status).toBe(400);
  });
  it('rolls back an interrupted commit so action IDs can be retried',async()=>{
    await expect(store.atomic(async tx=>{await tx.markAction('rollback-id',room.id,ids[0],'auction','test',{});const copy=(await tx.getRoom(room.code))!;copy.name='must rollback';await tx.saveRoom(copy);throw new Error('disk error');})).rejects.toThrow('disk error');
    expect((await store.getRoom(room.code))!.name).toBe('拍卖验证');expect(store.actions.has('rollback-id')).toBe(false);
  });
});
