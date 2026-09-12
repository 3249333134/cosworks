import { describe,expect,it } from 'vitest';
import type { GameSessionRecord } from './store.js';
import type { RoomSnapshot } from '@ruxiju/shared';
import { buildHistory, buildTimeline } from './history.js';

const room:RoomSnapshot={id:'room-history',code:'HJK234',name:'历史局',ipTheme:'罗小黑战记',status:'settled',ownerAccountId:'a',members:[
  {id:'ma',accountId:'a',displayName:'阿甲',isOwner:true,hostRole:'owner',playerRole:'无限',ipRoleId:'ra',team:'甲',ready:true,online:true,score:0},
  {id:'mb',accountId:'b',displayName:'阿乙',isOwner:false,hostRole:null,playerRole:'小黑',ipRoleId:'rb',team:'甲',ready:true,online:true,score:0},
],currentGame:'witch',game:null,gamePlan:[{id:'plan-witch',gameId:'witch',createdAt:'2026-01-01T00:00:00.000Z'}],planCursor:1,planRound:1,closedAt:null};

const session:GameSessionRecord={id:'session-witch',roomId:room.id,gameId:'witch',planItemId:'plan-witch',startedAt:'2026-01-01T01:00:00.000Z',endedAt:'2026-01-01T01:10:00.000Z',state:{game:{sessionId:'session-witch',planItemId:'plan-witch',gameId:'witch',phase:'settled',round:1,prompt:'',primaryAction:'',endsAt:null,scores:{},publicState:{stage:'complete'},privateState:{witch:{deposits:{a:{cell:6,punishment:'唱一句角色台词',buriedAt:1000},b:{cell:6,punishment:'夸下一位玩家',buriedAt:2000}},investigations:{a:[{cell:6,hit:true,investigatedByAccountId:'a',investigatedByName:'阿甲',investigatedAt:3000},{cell:6,hit:true,investigatedByAccountId:'a',investigatedByName:'阿甲',investigatedAt:3000}],b:[{cell:0,hit:false,investigatedByAccountId:'b',investigatedByName:'阿乙',investigatedAt:4000}]},lastActionAt:{}}}},runtime:{challenges:{},completed:['a','b'],usedDontContents:[],dontWordCounts:{},dontWordHistory:{}}}};

describe('party history',()=>{
  it('binds a completed session to its stable plan item',()=>{const timeline=buildTimeline(room,[session]);expect(timeline.items[0]).toMatchObject({planItemId:'plan-witch',sessionId:'session-witch',status:'completed'});expect(timeline.players.map(item=>item.color)).toHaveLength(2);});
  it('aggregates every burial and unique investigator after settlement',()=>{const history=buildHistory(room,session,[],'b');const poison=history.witch?.cells[6];expect(poison?.burials).toHaveLength(2);expect(poison?.clicks).toHaveLength(1);expect(poison?.clicks[0]).toMatchObject({displayName:'阿甲',hit:true});expect(history.witch?.cells[0]).toMatchObject({state:'safe'});expect(history.witch?.cells).toHaveLength(25);});
  it('does not expose an aggregated witch board before settlement',()=>{const active={...session,endedAt:null,state:{...(session.state as object),game:{...((session.state as {game:object}).game),phase:'playing'}}};const activeRoom={...room,status:'running' as const,game:(active.state as {game:RoomSnapshot['game']}).game};const history=buildHistory(activeRoom,active,[],'a');expect(history.witch).toBeUndefined();expect(history.overview?.witch?.cells).toHaveLength(25);});
});
