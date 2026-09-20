(some characters truncated)...
,input:GameAction):RoomSnapshot {
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
  value.stage??='init';value.budgets??={};value.wallets??={};value.lots??=[];value.lotOrder??=[];value.topBid??=null;value.itemsByAccount??={};value.auctioneerMode??='free';value.auctioneerAccountId??=null;
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
  const overviewOf=(lot:AuctionLot):AuctionLotOverview=>({lotId:lot.lotId,sellerAccountId:lot.sellerAccountId,sellerName:active.find(a=>a.accountId===lot.sellerAccountId)?.displayName??null,sellerRole:active.find(a=>a.accountId===lot.sellerAccountId)?.playerRole??null,title:lot.title,story:lot.story,assetId:lot.assetId,imageUrl:lot.imageUrl,thumbUrl:lot.thumbUrl,submittedAt:new Date(lot.submittedAt).toISOString(),bidCount:lot.bidHistory.length,reservePrice:round2(lot.reservePrice),soldPrice:lot.soldPrice,winnerAccountId:lot.winnerAccountId,winnerName:lot.winnerAccountId?active.find(a=>a.accountId===lot.winnerAccountId)?.displayName??null:null,sold:lot.sold});
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
  ps.auctioneerMode=auc.auctioneerMode;
  ps.auctioneerAccountId=auc.auctioneerAccountId;
  ps.auctioneerName=auc.auctioneerAccountId?active.find(a=>a.accountId===auc.auctioneerAccountId)?.displayName??null:null;
}
function beginAuctionLot(room:RoomSnapshot,auc:AuctionState,active:RoomSnapshot['members'],index:number){
  if(auc.lotOrder.length===0)throw new Error('还没有可拍卖的物品');
  if(index<0||index>=auc.lotOrder.length)throw new Error('拍品序号超出范围');
  const lotId=auc.lotOrder[index];const lot=auc.lots.find(l=>l.lotId===lotId);if(!lot)throw new Error('找不到当前拍品');
  auc.currentLotIndex=index;auc.stage='bidding';auc.topBid=null;room.game!.round=index+1;room.game!.primaryAction=`起拍价 ${round2(lot.reservePrice).toFixed(2)} 元，每次加价 ≥ ${PRICE_INCREMENT} 元`;
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
  if(input.action==='auction-set-auctioneer'){
    if(auc.stage!=='init')throw new Error('拍卖师模式只能在开始前设置');
    if(!isHost)throw new Error('只有主持能设置拍卖师模式');
    const mode=String(input.payload?.mode||'free')==='designated'?'designated':'free';
    const auctioneerAccountId=mode==='designated'?String(input.payload?.auctioneerAccountId||room.ownerAccountId):null;
    if(auctioneerAccountId&&!active.some(m=>m.accountId===auctioneerAccountId))throw new Error('指定的拍卖师不在本局玩家中');
    auc.auctioneerMode=mode;auc.auctioneerAccountId=auctioneerAccountId;
    refreshAuctionPublicState(room,auc,active);return room;
  }
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
    const reservePrice=round2(moneyInput(input.payload?.reservePrice));
    if(reservePrice<0||reservePrice>1000000)throw new Error('起拍价必须在 0～1000000 元之间');
    if(title.length<1||title.length>20)throw new Error('物品名称需要 1～20 个字');
    if(story.length>200)throw new Error('物品介绍最多 200 个字');
    const hasPhoto=Boolean(assetId);
    const lotId='lot-'+randomUUID();const lot:AuctionLot={
      lotId,sellerAccountId:accountId,title,story,assetId,
      imageUrl:hasPhoto?`/api/media/${encodeURIComponent(assetId)}`:`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#2a2318'/><text x='50%' y='55%' font-size='90' text-anchor='middle' dominant-baseline='middle'>${emoji||'🎁'}</text></svg>`)}`,
      thumbUrl:hasPhoto?`/api/media/${encodeURIComponent(assetId)}?thumb=1`:'',
      submittedAt:Date.now(),bidHistory:[],winnerAccountId:null,soldPrice:null,soldAt:null,sold:false,reservePrice
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
    if(auc.auctioneerMode==='designated'&&auc.auctioneerAccountId===accountId)throw new Error('拍卖师不能参与出价');
    const raw=moneyInput(input.payload?.price);
    const price=round2(raw);
    const wallet=round2(auc.wallets[accountId]??0);if(price>wallet)throw new Error('余额不足');
    const basePrice=auc.topBid?round2(auc.topBid.price):round2(lot.reservePrice);
    const minNext=round2(basePrice+(auc.topBid?PRICE_INCREMENT:0));
    if(price<minNext)throw new Error(auc.topBid?`出价必须 ≥ 当前最高价 + ${PRICE_INCREMENT} 元（当前最低可出：${minNext.toFixed(2)} 元）`:`出价必须 ≥ 起拍价 ${lot.reservePrice.toFixed(2)} 元`);
    const bid:AuctionBid={bidId:input.actionId,accountId,price,bidAt:Date.now()};
    auc.topBid=bid;lot.bidHistory.push(bid);
    refreshAuctionPublicState(room,auc,active);return room;
  }
  if(input.action==='auction-sold'||input.action==='auction-pass-lot'){
    if(auc.stage!=='bidding')throw new Error('当前不在出价阶段');
    const lot=auc.currentLotIndex==null?undefined:auc.lots.find(l=>l.lotId===auc.lotOrder[auc.currentLotIndex!]);
    if(!lot)throw new Error('找不到当前拍品');
    const isAuctioneer=auc.auctioneerMode==='designated'?auc.auctioneerAccountId===accountId:lot.sellerAccountId===accountId;
    if(!isAuctioneer)throw new Error(auc.auctioneerMode==='designated'?'只有指定的拍卖师可以落锤或流拍':'只有当前拍品的出售人可以担任拍卖师，落锤或流拍');
    if(input.payload?.lotId!==undefined&&input.payload.lotId!==lot.lotId)throw new Error('拍品已更新，请刷新后重试');
    if(input.action==='auction-pass-lot')auc.topBid=null;
    finalizeAuctionLot(room,auc,active);return room;
  }
  throw new Error('当前操作不适用于物品拍卖会');
}
