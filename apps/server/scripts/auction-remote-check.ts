import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import WebSocket from 'ws';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { MySqlStore } from '../src/store.js';
assert.equal(config.db.database,'cosworks_dev');assert.equal(config.db.host,'127.0.0.1');assert.equal(config.db.port,13306);
const fixturePath='../../.local/auction-check.json';
const saved=process.argv.includes('--resume')?JSON.parse(await readFile(fixturePath,'utf8')):null;
const users:Array<{account:string;password:string;token:string;id:string}>=saved?.users??[];
let code=saved?.code??'';
async function api(index:number,path:string,body?:unknown){
  const response=await fetch(`http://localhost:${5173+index}/api${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:`http://localhost:${5173+index}`,...(users[index]?{Authorization:`Bearer ${users[index].token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json() as any;if(!response.ok)throw new Error(`${path}: ${result.error}`);return result.data;
}
const action=(index:number,action:string,payload:unknown={})=>api(index,`/rooms/${code}/actions`,{actionId:randomUUID(),gameId:'auction',action,payload});
const host=(action:string,extra:unknown={})=>api(0,`/rooms/${code}/host-actions`,{action,...extra as object});
const pool=mysql.createPool({...config.db,timezone:'Z'});const store=new MySqlStore(pool);await store.ensureTimelineSchema();
try{
 if(!saved){
  const suffix=Date.now().toString(36);
  for(let i=0;i<3;i++){
   const account=`auction_${suffix}_${i}`,password='Auction-check-2026';
   const registered=await api(i,'/auth/register',{account,password,displayName:`拍卖验收${i+1}`});users.push({account,password,token:registered.token,id:registered.user.accountId});
   await fetch(`http://localhost:${5173+i}/api/profile/me`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${users[i].token}`},body:JSON.stringify({mbti:'ENFP'})});
   const role=await api(i,'/profile/me/roles',{ipTheme:'拍卖验收',name:'收藏家',personaTags:[],quote:'',signatureAction:'',ability:'',isDefault:true});(users[i] as any).roleId=role.role.id;
  }
  const created=await api(0,'/rooms',{name:'拍卖稳定性验收',ipTheme:'拍卖验收'});code=created.room.code;
  for(let i=0;i<3;i++){
   if(i)await api(i,`/rooms/${code}/join`,{});
   const r=await fetch(`http://localhost:${5173+i}/api/rooms/${code}/role`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${users[i].token}`},body:JSON.stringify({ipRoleId:(users[i] as any).roleId,ready:true})});assert.equal(r.status,200);
  }
  await host('set-plan',{gamePlan:['auction','auction']});await host('start');
  for(let i=0;i<3;i++)await action(i,'auction-set-budget',{initialBudget:i===0?0:100});
  const room=(await api(0,`/rooms/${code}`)).room;
  const image=await sharp({create:{width:2100,height:1200,channels:3,background:'#bc8a35'}}).jpeg().toBuffer();await writeFile('../../.local/auction-photo.jpg',image);
  for(let i=0;i<3;i++){
   const form=new FormData();form.append('file',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'photo.jpg');form.append('roomId',room.id);
   const r=await fetch(`http://localhost:${5173+i}/api/media/upload`,{method:'POST',headers:{Authorization:`Bearer ${users[i].token}`},body:form});assert.equal(r.status,201);const asset=(await r.json() as any).data;
   await action(i,'auction-submit-item',{assetId:asset.assetId,title:['旅行怀表','纪念钢笔','老明信片'][i],story:'测试拍品的完整故事：这件随身物品陪伴我走过许多城市。'});
  }
  await host('advance-stage',{reason:'开始验收竞价'});
  const streams=users.map((user,i)=>new WebSocket(`ws://localhost:${5173+i}/ws?room=${code}&token=${user.token}`,{origin:`http://localhost:${5173+i}`}));
  const prices:number[][]=streams.map(()=>[]);
  streams.forEach((ws,i)=>ws.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='room:state'&&m.room?.game?.publicState.topBid)prices[i].push(m.room.game.publicState.topBid.price);}));
  await Promise.all(streams.map(ws=>new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);}))); 
  const bids=await Promise.allSettled([action(1,'auction-bid',{price:10}),action(2,'auction-bid',{price:20}),action(1,'auction-bid',{price:15})]);
  assert.ok(bids.some(r=>r.status==='fulfilled'));
  for(let i=0;i<10;i++)await action(1+i%2,'auction-bid',{price:20+(i+1)/10});
  const before=(await api(0,`/rooms/${code}/overview`)).overview.auction;assert.equal(before.topBid.price,21);
  for(let i=0;i<3;i++){const deadline=Date.now()+3000;while(prices[i].at(-1)!==21&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));assert.equal(prices[i].at(-1),21);assert.ok(prices[i].every((v,j,a)=>j===0||v>a[j-1]));streams[i].close();}
  const recovered=(await store.getRoom(code))!;const session=await store.getGameSession(recovered.game!.sessionId) as any;
  assert.equal(session.game.privateState.auction.topBid.price,21);assert.equal(session.game.privateState.auction.budgetSubmitted[users[0].id],true);
  await writeFile(fixturePath,JSON.stringify({code,users,before,sessionId:recovered.game!.sessionId},null,2));
  console.log(JSON.stringify({code,websocketCounts:prices.map(x=>x.length),highestBid:21,mysqlSession:true,awaitingRestart:true}));
 }else{
  const after=(await api(0,`/rooms/${code}/overview`)).overview.auction;
  for(const key of ['stage','wallets','currentLotIndex','lots','topBid','lotOrder','bidHistory'])assert.deepEqual(after[key],saved.before[key]);
  await action(0,'auction-sold');await action(0,'auction-pass-lot');await host('advance-stage',{reason:'验收最后流拍'});
  const history=(await api(0,`/rooms/${code}/sessions/${saved.sessionId}/history`)).history.auction;assert.equal(history.auctionRanking[0].soldPrice,21);assert.equal(history.lots.length,3);assert.ok(history.lots[0].bidHistory.length>=11);
  assert.equal(Object.values(history.finalWallets).reduce((a:any,b:any)=>a+b,0),200);
  await host('start-next');
  console.log(JSON.stringify({code,restartRestored:true,historyBids:history.lots[0].bidHistory.length,settled:true,uiSession:'init'}));
 }
}finally{await pool.end();}
