import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MemoryStore, autoPersist } from './store.js';
import { startGame, handleGameAction, playerSnapshot, advanceGameStage, gameOverview } from './game-engine.js';
import type { RoomSnapshot } from '@ruxiju/shared';
it('recovers auction state and asset bindings from the actual memory snapshot file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'auction-snapshot-'));const file=join(dir,'store.json');let close:(()=>void)|undefined;
  try{
    let store=new MemoryStore();close=autoPersist(store,file).close;
    const room:RoomSnapshot={id:'restart-room',code:'ABCD23',name:'restart',ipTheme:'test',status:'waiting',ownerAccountId:'a',members:['a','b'].map((id,i)=>({id,accountId:id,displayName:id,isOwner:i===0,hostRole:i===0?'owner':null,playerRole:'收藏家',ipRoleId:null,team:'队',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[],planCursor:0,planRound:1,closedAt:null};
    startGame(room,'auction',new Map());handleGameAction(room,'a',{gameId:'auction',actionId:'budget-a',action:'auction-set-budget',payload:{initialBudget:0}});
    await store.atomic(async tx=>{await tx.createRoom(room);await tx.saveAsset({id:'image',accountId:'a',roomId:room.id,filename:'test.webp',mimeType:'image/webp',size:100,width:10,height:10,thumbSize:100,createdAt:new Date().toISOString(),dataUrl:null,imagePath:'media/image.webp',thumbPath:'media/image.thumb.webp',usedInSessionId:room.game!.sessionId,usedAt:new Date().toISOString()});});
    close();store=new MemoryStore();close=autoPersist(store,file).close;
    const loaded=(await store.getRoom(room.code))!;expect(playerSnapshot(loaded,'a').game?.privateState?.auction).toMatchObject({budget:0,hasBudget:true});
    handleGameAction(loaded,'b',{gameId:'auction',actionId:'budget-b',action:'auction-set-budget',payload:{initialBudget:25.55}});
    handleGameAction(loaded,'a',{gameId:'auction',actionId:'submit-a',action:'auction-submit-item',payload:{assetId:'image',title:'笔',story:'故事'}});advanceGameStage(loaded);advanceGameStage(loaded);
    handleGameAction(loaded,'b',{gameId:'auction',actionId:'bid-b',action:'auction-bid',payload:{price:12.34}});
    await store.atomic(async tx=>{await tx.saveRoom(loaded);await tx.saveGameSession(loaded,{game:loaded.game});});const before=gameOverview(loaded,'a')!.auction!;
    close();store=new MemoryStore();close=autoPersist(store,file).close;const after=gameOverview((await store.getRoom(room.code))!,'a')!.auction!;
    expect(after).toEqual(before);expect(await store.getAsset('image')).toMatchObject({usedInSessionId:room.game!.sessionId,imagePath:'media/image.webp'});expect((await store.getGameSession(room.game!.sessionId)) as any).toEqual({game:loaded.game});
  }finally{close?.();await rm(dir,{recursive:true,force:true});}
});
