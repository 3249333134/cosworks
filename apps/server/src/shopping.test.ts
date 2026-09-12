import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '@ruxiju/shared';
import { ensureShoppingGame, shoppingResults, shoppingState } from './shopping-engine.js';
import { handleGameAction, playerSnapshot, startGame } from './game-engine.js';

function auctionRoom():RoomSnapshot{return {id:'room-shop',code:'SHOP22',name:'采购测试',ipTheme:'罗小黑战记',status:'settled',ownerAccountId:'a',members:[{id:'ma',accountId:'a',displayName:'红橙',isOwner:true,hostRole:'owner',playerRole:'罗小黑',ipRoleId:'ra',team:'未分队',ready:true,online:true,score:0},{id:'mb',accountId:'b',displayName:'徐',isOwner:false,hostRole:null,playerRole:'无限',ipRoleId:'rb',team:'未分队',ready:true,online:true,score:0}],currentGame:'auction',game:{sessionId:'auction-session',planItemId:'auction-plan',gameId:'auction',phase:'settled',round:1,prompt:'',primaryAction:'',endsAt:null,scores:{a:0,b:0},publicState:{},privateState:{auction:{wallets:{a:88.88,b:20}}}},gamePlan:[{id:'shopping-plan',gameId:'shopping',createdAt:new Date().toISOString()}],planCursor:0,planRound:1,closedAt:null};}

describe('shopping game',()=>{
  it('uses one activity cap for a multi-item party list without requiring all funds spent',()=>{
    const room=auctionRoom();startGame(room,'shopping',new Map());
    const task=shoppingState(room)!.tasks.a;expect(task.brief).toContain('所有物品合计不能超支');expect(task.brief).toContain('无需花光');
    const itemName='果汁 2 瓶供大家饮用；饼干 1 包供大家分享；彩色纸杯一包呼应角色服装；餐巾纸一包供聚会使用';
    handleGameAction(room,'a',{actionId:randomUUID(),gameId:'shopping',action:'shopping-complete',payload:{itemName,price:25.5}});
    expect(shoppingResults(shoppingState(room)!)[0]).toMatchObject({budget:88.88,spent:25.5,remaining:63.38,purchase:{itemName}});
  });
  it('upgrades old budgets and supports ending before anyone sets a budget',()=>{
    const room=auctionRoom();startGame(room,'shopping',new Map());const state=shoppingState(room)!;
    delete state.budgetSources;delete state.auctionWallets;delete state.taskVersion;
    state.tasks.a.purpose='错误用途';ensureShoppingGame(room);
    expect(playerSnapshot(room,'a').game?.privateState?.shopping).toMatchObject({auctionBudget:88.88});
    expect(state.tasks.a.purpose).not.toBe('错误用途');
    state.budgets={};state.tasks={};expect(shoppingResults(state)[0].task.suggestion).toBe('尚未领取任务');
  });
  it('switches budgets, restores auction amount, and locks after purchase',()=>{
    const room=auctionRoom();startGame(room,'shopping',new Map());
    const act=(action:string,payload:Record<string,unknown>)=>handleGameAction(room,'a',{actionId:randomUUID(),gameId:'shopping',action,payload});
    act('shopping-set-budget',{source:'manual',amount:'12.50'});
    expect(shoppingState(room)!.budgets.a).toBe(12.5);
    act('shopping-set-budget',{source:'auction'});expect(shoppingState(room)!.budgets.a).toBe(88.88);
    act('shopping-complete',{itemName:'纸杯',price:5});
    expect(()=>act('shopping-set-budget',{source:'manual',amount:2})).toThrow('不能修改预算');
  });
  it('inherits auction wallets, keeps tasks private and rejects overspending',()=>{
    const room=auctionRoom();startGame(room,'shopping',new Map(),new Map(),'shopping-plan');
    const a=playerSnapshot(room,'a'),b=playerSnapshot(room,'b');
    expect(a.game?.privateState?.shopping).toMatchObject({budget:88.88,purchase:null});
    expect(b.game?.privateState?.shopping).toMatchObject({budget:20,purchase:null});
    expect(a.game?.publicState.results).toEqual([]);
    expect(()=>handleGameAction(room,'b',{actionId:randomUUID(),gameId:'shopping',action:'shopping-complete',payload:{itemName:'桌面装饰',price:20.001}})).toThrow('最多保留两位小数');
    expect(()=>handleGameAction(room,'b',{actionId:randomUUID(),gameId:'shopping',action:'shopping-complete',payload:{itemName:'桌面装饰',price:20.01}})).toThrow('不能超过');
  });

  it('settles once everyone has registered and publishes the full list',()=>{
    const room=auctionRoom();startGame(room,'shopping',new Map(),new Map(),'shopping-plan');
    handleGameAction(room,'a',{actionId:'one',gameId:'shopping',action:'shopping-complete',payload:{itemName:'金色纸杯',price:12.5,note:'供大家使用'}});
    handleGameAction(room,'b',{actionId:'two',gameId:'shopping',action:'shopping-complete',payload:{itemName:'黑色桌布',price:20}});
    expect(room.status).toBe('settled');expect(room.game?.phase).toBe('settled');
    const results=room.game?.publicState.results as Array<{remaining:number}>;
    expect(results.map(row=>row.remaining)).toEqual([76.38,0]);
    expect(()=>handleGameAction(room,'a',{actionId:'one',gameId:'shopping',action:'shopping-complete',payload:{itemName:'重复',price:1}})).toThrow('游戏当前不可操作');
  });

  it('requires a preceding auction wallet snapshot',()=>{
    const room=auctionRoom();room.currentGame='story';room.game!.gameId='story';
    startGame(room,'shopping',new Map(),new Map(),'shopping-plan');
    expect(playerSnapshot(room,'a').game?.privateState?.shopping).toMatchObject({hasBudget:false,task:null});
    handleGameAction(room,'a',{actionId:'budget',gameId:'shopping',action:'shopping-set-budget',payload:{source:'manual',amount:'50.25'}});
    expect(playerSnapshot(room,'a').game?.privateState?.shopping).toMatchObject({hasBudget:true,budget:50.25,budgetSource:'manual'});
    expect(()=>handleGameAction(room,'a',{actionId:'bad',gameId:'shopping',action:'shopping-set-budget',payload:{source:'manual',amount:'1.005'}})).toThrow('两位小数');
  });
  it('accepts the most recent persisted auction wallets after another game',()=>{
    const room=auctionRoom();room.currentGame='story';room.game!.gameId='story';
    startGame(room,'shopping',new Map(),new Map(),'shopping-plan',{a:33.33,b:44.44});
    expect((playerSnapshot(room,'b').game?.privateState?.shopping as {budget:number}).budget).toBe(44.44);
  });
});
