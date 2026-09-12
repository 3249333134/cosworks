import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '@ruxiju/shared';
import { gameOverview, handleGameAction, playerSnapshot, startGame } from './game-engine.js';
import { beginUndercover, recommendedSpies, undercoverState } from './undercover-engine.js';

function room():RoomSnapshot{return {id:'room-undercover',code:'UNDER2',name:'卧底测试',ipTheme:'罗小黑战记',status:'waiting',ownerAccountId:'a',members:['a','b','c','d'].map((accountId,index)=>({id:`m${accountId}`,accountId,displayName:`玩家${index+1}`,isOwner:index===0,hostRole:index===0?'owner' as const:null,playerRole:['罗小黑','无限','鹿野','风息'][index],ipRoleId:`r${accountId}`,team:'同队',ready:true,online:true,score:0})),currentGame:null,game:null,gamePlan:[{id:'plan-undercover',gameId:'undercover',createdAt:new Date().toISOString()}],planCursor:0,planRound:1,closedAt:null};}
function action(target:RoomSnapshot,id:string,name:string,payload:Record<string,unknown>={}){const s=undercoverState(target)!;return handleGameAction(target,id,{actionId:randomUUID(),gameId:'undercover',action:name,payload:{sessionId:target.game!.sessionId,round:s.round,...payload}});}
function deal(target:RoomSnapshot){beginUndercover(target,'a',{civilian:'蓝莓汽水',undercover:'葡萄汽水'});return undercoverState(target)!;}

describe('undercover game',()=>{
  it('recommends a minority and includes the host as a private-word player',()=>{
    expect(recommendedSpies(4)).toBe(1);expect(recommendedSpies(6)).toBe(2);
    const target=room();startGame(target,'undercover',new Map());const state=deal(target);
    expect(state.participants.map(p=>p.accountId)).toContain('a');
    for(const id of state.participants.map(p=>p.accountId)){
      const snapshot=playerSnapshot(target,id);const own=snapshot.game?.privateState?.undercover as {ownWord:string|null};
      expect(own.ownWord).toBe(state.spies.includes(id)?'葡萄汽水':'蓝莓汽水');
      expect(JSON.stringify(snapshot)).not.toContain('"spies"');
      expect(JSON.stringify(snapshot)).not.toContain(state.spies.includes(id)?'蓝莓汽水':'葡萄汽水');
    }
    expect(JSON.stringify(target.game?.publicState)).not.toContain('蓝莓汽水');expect(JSON.stringify(target.game?.publicState)).not.toContain('葡萄汽水');
    expect(gameOverview(target,'a')?.undercover?.ownWord).toBe(state.spies.includes('a')?'葡萄汽水':'蓝莓汽水');
  });

  it('lets only the host adjust count before dealing and locks it afterwards',()=>{
    const target=room();startGame(target,'undercover',new Map());
    expect(()=>action(target,'b','undercover-count',{count:1})).toThrow('只有主持');
    action(target,'a','undercover-count',{count:1});deal(target);
    expect(()=>action(target,'a','undercover-count',{count:1})).toThrow('发词后不能修改');
  });

  it('moves through speaking and a tied vote without eliminating anyone',()=>{
    const target=room();startGame(target,'undercover',new Map());const state=deal(target);
    for(const id of [...state.order])action(target,id,'undercover-spoke');
    expect(state.stage).toBe('voting');
    action(target,'a','undercover-vote',{target:'b'});action(target,'b','undercover-vote',{target:'a'});action(target,'c','undercover-vote',{target:'d'});action(target,'d','undercover-vote',{target:'c'});
    expect(state.stage).toBe('speaking');expect(state.round).toBe(2);expect(state.alive).toHaveLength(4);expect(state.rounds[0]).toMatchObject({eliminated:null});
  });

  it('ends immediately when surviving undercovers equal surviving civilians',()=>{
    const target=room();startGame(target,'undercover',new Map());const state=deal(target);const spy=state.spies[0];const civilians=state.alive.filter(id=>id!==spy);
    state.stage='voting';state.alive=[spy,civilians[0],civilians[1]];state.votes={};
    action(target,spy,'undercover-vote',{target:civilians[0]});action(target,civilians[0],'undercover-vote',{target:civilians[1]});action(target,civilians[1],'undercover-vote',{target:civilians[0]});
    expect(state.winner).toBe('undercover');expect(state.stage).toBe('complete');expect(target.game?.phase).toBe('settled');
    expect((playerSnapshot(target,'a').game?.privateState?.undercover as {reveal:{spies:string[]}}).reveal.spies).toEqual([spy]);
  });

  it('ends with a civilian win after the final undercover is eliminated',()=>{
    const target=room();startGame(target,'undercover',new Map());const state=deal(target);const spy=state.spies[0];state.stage='voting';state.votes={};
    for(const id of state.alive)action(target,id,'undercover-vote',{target:id===spy?state.alive.find(other=>other!==spy)!:spy});
    expect(state.winner).toBe('civilian');expect(state.alive).not.toContain(spy);
  });
});
