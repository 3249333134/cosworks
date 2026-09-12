import { createHash } from 'node:crypto';
import type { GameAction, RoomSnapshot, ShoppingPurchase, ShoppingResult, ShoppingTask } from '@ruxiju/shared';

export interface ShoppingParticipant { accountId:string; displayName:string; playerRole:string }
export interface ShoppingState {
  stage:'shopping'|'complete';
  ipTheme:string;
  participants:ShoppingParticipant[];
  budgets:Record<string,number>;
  auctionWallets?:Record<string,number>;
  budgetSources?:Record<string,'auction'|'manual'>;
  tasks:Record<string,ShoppingTask>;
  purchases:Record<string,ShoppingPurchase>;
  processedActions:Record<string,true>;
  taskVersion?:number;
}

const COLORS=['角色主色','暖色','冷色','金色或银色','黑白配色','与角色服装呼应的颜色'];

export function previousAuctionWallets(room:RoomSnapshot){
  if(room.currentGame!=='auction'||!room.game)return null;
  const auc=room.game.privateState?.auction as {wallets?:Record<string,number>}|undefined;
  return auc?.wallets?structuredClone(auc.wallets):null;
}

export function ensureShoppingGame(room:RoomSnapshot,wallets?:Record<string,number>|null){
  if(room.currentGame!=='shopping'||!room.game)return room;
  if(room.game.privateState?.shopping){const state=shoppingState(room)!;if(!state.budgetSources){state.auctionWallets={...state.budgets};state.budgetSources=Object.fromEntries(Object.keys(state.budgets).map(id=>[id,'auction' as const]));}if(state.taskVersion!==3&&state.stage!=='complete'){for(const p of state.participants)if(!state.purchases[p.accountId]&&state.budgets[p.accountId]!==undefined)state.tasks[p.accountId]=taskFor(state.ipTheme,p,state.budgets[p.accountId]);state.taskVersion=3;}refreshShoppingPublic(room,state);return room;}
  const participants=room.members.filter(m=>m.ready).map(m=>({accountId:m.accountId,displayName:m.displayName,playerRole:m.playerRole}));
  const budgets=Object.fromEntries(participants.filter(p=>wallets?.[p.accountId]!==undefined).map(p=>[p.accountId,round2(Math.max(0,Number(wallets![p.accountId])||0))]));
  const tasks=Object.fromEntries(participants.filter(p=>budgets[p.accountId]!==undefined).map(p=>[p.accountId,taskFor(room.ipTheme,p,budgets[p.accountId])]));
  const state:ShoppingState={stage:'shopping',taskVersion:3,ipTheme:room.ipTheme,participants,budgets,auctionWallets:{...budgets},budgetSources:Object.fromEntries(Object.keys(budgets).map(id=>[id,'auction' as const])),tasks,purchases:{},processedActions:{}};
  room.game.privateState={shopping:state};room.game.primaryAction='登记采购结果';refreshShoppingPublic(room,state);return room;
}

export function shoppingState(room:RoomSnapshot){return room.game?.privateState?.shopping as ShoppingState|undefined;}

export function shoppingPrivate(room:RoomSnapshot,accountId:string){
  const state=shoppingState(room);if(!state)return undefined;
  const purchase=state.purchases[accountId]??null;const budget=state.budgets[accountId]??0;
  return {hasBudget:state.budgets[accountId]!==undefined,auctionBudget:state.auctionWallets?.[accountId]??null,budgetSource:state.budgetSources?.[accountId]??'auction',task:state.tasks[accountId]??null,budget,purchase,remaining:round2(budget-(purchase?.price??0))};
}

export function handleShoppingAction(room:RoomSnapshot,accountId:string,input:GameAction){
  const state=shoppingState(room);if(!state)throw new Error('采购任务尚未初始化');
  if(state.stage!=='shopping')throw new Error('本场采购已经结束');
  if(input.action==='shopping-set-budget'){
    const participant=state.participants.find(p=>p.accountId===accountId);
    if(!participant)throw new Error('你不在本场采购名单中');
    if(state.purchases[accountId]||state.processedActions[input.actionId])throw new Error('采购已登记或请求重复，不能修改预算');
    const source=input.payload?.source;
    if(source!=='auction'&&source!=='manual')throw new Error('请选择预算来源');
    const raw=source==='auction'?state.auctionWallets?.[accountId]:input.payload?.amount;
    if(raw===undefined)throw new Error('没有可继承的拍卖余额，请手动输入');
    const amount=money(raw);if(amount>1_000_000)throw new Error('预算不能超过 1000000 元');
    state.budgets[accountId]=amount;state.budgetSources??={};state.budgetSources[accountId]=source;
    state.tasks[accountId]=taskFor(state.ipTheme,participant,amount);state.processedActions[input.actionId]=true;
    refreshShoppingPublic(room,state);return room;
  }
  if(state.budgets[accountId]===undefined)throw new Error('请先确认采购预算');
  if(input.action!=='shopping-complete')throw new Error('当前操作不适用于一起采购');
  if(state.processedActions[input.actionId]||state.purchases[accountId])throw new Error('你已经登记过采购结果');
  if(!state.participants.some(p=>p.accountId===accountId))throw new Error('你不在本场采购名单中');
  const itemName=String(input.payload?.itemName??'').trim();const note=String(input.payload?.note??'').trim();
  if(itemName.length<1||itemName.length>500)throw new Error('采购清单需要 1～500 个字');
  if(note.length>120)throw new Error('采购说明最多 120 个字');
  const price=money(input.payload?.price);const budget=state.budgets[accountId]??0;
  if(price<0||price>budget)throw new Error(`采购金额不能超过你的 ¥${budget.toFixed(2)} 预算`);
  state.purchases[accountId]={itemName,price,note,completedAt:new Date().toISOString()};state.processedActions[input.actionId]=true;
  if(state.participants.every(p=>state.purchases[p.accountId]))state.stage='complete';
  refreshShoppingPublic(room,state);return room;
}

export function shoppingResults(state:ShoppingState):ShoppingResult[]{return state.participants.map(p=>{const purchase=state.purchases[p.accountId]??null;const budget=state.budgets[p.accountId]??0;return {...p,budget,spent:purchase?.price??0,remaining:round2(budget-(purchase?.price??0)),task:state.tasks[p.accountId]??{color:'未设置',purpose:'未设置',suggestion:'尚未领取任务',brief:'未确认预算，未领取任务'},purchase};});}

export function refreshShoppingPublic(room:RoomSnapshot,state:ShoppingState){
  const results=state.stage==='complete'?shoppingResults(state):[];
  room.game!.publicState={stage:state.stage,completedCount:Object.keys(state.purchases).length,total:state.participants.length,lastActionAt:Date.now(),results};
}

function taskFor(ipTheme:string,p:ShoppingParticipant,budget:number):ShoppingTask{
  const seed=createHash('sha256').update(`${ipTheme}|${p.playerRole}|${p.accountId}`).digest();
  const color=COLORS[seed[0]%COLORS.length];
  const colorTask=seed[1]%2===0;
  const purpose='让一件用品同时服务于桌面布置和合影';
  const requirement=colorTask?`清单中至少一件物品或其包装采用${color}，并说明它与角色的联系`:purpose+'，并说明它与角色的联系';
  return {color:colorTask?color:'自由选择',purpose:colorTask?'为聚会提供零食、饮料或布置用品':purpose,suggestion:'在聚会采购清单中完成你的任务',brief:`你以「${p.playerRole}」在《${ipTheme}》中的角色身份参与采购。活动经费最多 ¥${budget.toFixed(2)}，所有物品合计不能超支，无需花光。自行搭配聚会需要的零食、饮料、餐具或布置用品。你的任务：${requirement}；其余物品自由选择，但都应服务于本次聚会。${budget<1?'经费有限，可借用、免费领取或利用现有材料，实际支出仍不能超出额度。':''}`};
}
function money(value:unknown){const text=String(value??'');if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('金额最多保留两位小数');const result=Number(text);if(!Number.isFinite(result))throw new Error('请输入有效金额');return round2(result);}
function round2(value:number){return Math.round((value+Number.EPSILON)*100)/100;}
