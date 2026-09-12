// Browser fixtures only: no API writes, no real accounts or rooms.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlaySurface, Auth, Home, MbtiSetup, RoleSetup, RoomLobby} from '../src/App';
import {PageFrame, SummaryPanel, DetailDialog} from '../src/AdaptivePage';
import '../src/styles.css';
import '../src/game.css';
import '../src/adaptive.css';

const noop=()=>{}, asyncNoop=async()=>{};
const text='这是用于检查长内容与换行的聚会测试文字。'.repeat(20);
const params=new URLSearchParams(location.search),gameId=params.get('game')??'story',stage=params.get('stage')??'relay';
const members=Array.from({length:12},(_,i)=>({id:`p${i}`,accountId:`p${i}`,displayName:`测试玩家${i}`,playerRole:`测试角色${i}`,hostRole:i===0?'owner':null,isOwner:i===0,ready:true,online:true,score:0,team:'测试队',ipRoleId:'role'}));
const member=members[params.get('player')==='1'?1:0];
const participants=members.map(p=>({...p,persona:'测试人设'}));
const segments=members.map(p=>({...p,content:text,submittedAt:new Date().toISOString(),voteCount:1}));
const lot={lotId:'lot1',sellerAccountId:'p0',sellerName:'测试玩家0',sellerRole:'测试角色',title:'测试拍品',story:text,imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#353029"/></svg>'),submittedAt:new Date().toISOString(),bidCount:12};
const story={stage,participants,order:members.map(p=>p.accountId),opening:text,endingHint:'聚会最终会迎来意想不到的变化。',segments:stage==='setup'?[]:segments,currentSpeakerId:member.accountId,currentSpeakerName:member.displayName,currentSpeakerRole:member.playerRole,turnStartedAt:Date.now(),readyToStart:false,submittedCount:12,total:12,votedCount:3,voterCount:12,points:{},tasks:{},approvals:{},rulings:{},details:{}};
const undercover={stage,ipTheme:'测试 IP',participants,count:3,recommended:3,maxCount:5,alive:members.map(p=>p.accountId),round:2,speakerId:member.accountId,ownWord:'测试词语',votedCount:3,totalVoters:12,ownVote:null,lastResult:{round:1,eliminated:'p11',votes:{},tied:[]},winner:'civilian',reveal:{words:{civilian:'测试词',undercover:'另一词'},spies:['p1'],rounds:[]}};
const room:any={id:'fixture',code:'UITEST',name:'自适应测试房间',ipTheme:'测试 IP',ownerAccountId:'p0',members,status:'running',planCursor:0,planRound:1,gamePlan:[],currentGame:gameId,game:{gameId,sessionId:`fixture-${gameId}`,phase:stage==='complete'?'settled':'playing',round:1,prompt:text,primaryAction:'提交当前任务',publicState:{stage,total:12,completed:3,lots:[lot],currentLot:lot,topBid:{accountId:'p1',displayName:'测试玩家1',price:2},bidHistory:members.map((p,i)=>({...p,price:i+1,bidAt:new Date().toISOString()})),orderLotIds:['lot1'],results:[],...(gameId==='story'?story:{})},privateState:{challenge:{id:'fixture',title:'测试任务',content:text},auction:{wallet:100,budget:100,itemSubmitted:false},truth:{hasSubmitted:false,statements:['','',''],points:0},witch:{ownDeposit:null,reveals:[],boardSize:5},story:{ownTask:'让自己的角色帮助另一位玩家。'},shopping:{hasBudget:true,budget:100,budgetSource:'auction',auctionBudget:100,remaining:100,purchase:null,task:{suggestion:'为聚会添置用品',brief:text,color:'蓝色',purpose:'布置聚会桌面'}},undercover,draw:{stage:'drawing',order:['p0','p1'],currentIndex:0,drawings:[],word:'测试词',isHostDrawer:true,isCurrentDrawer:true,isGuesser:false,drawing:null}},config:{rounds:1,boardSize:5}}};
const profile:any={accountId:'p0',displayName:'测试玩家',mbti:'INFP',roles:[{id:'role',name:'测试角色',ipTheme:'测试 IP',personaTags:['测试'],quote:text,signatureAction:'挥手',ability:'帮助大家',isDefault:true}],recentRooms:[]};
function Fixture(){
 const [modal,setModal]=useState(false),[revision,setRevision]=useState(0);
 if(gameId==='disclosure')return <PageFrame className="play-surface" scope="test"><header>测试顶部</header><section className="play-stage"><button onClick={()=>setRevision(r=>r+1)}>模拟同步 {revision}</button><SummaryPanel id="long" title="长记录"><p>{text.repeat(8)}</p><input aria-label="草稿"/></SummaryPanel><button onClick={()=>setModal(true)}>打开抽屉</button></section><footer className="play-footer"><button className="primary">底部主操作</button></footer>{modal&&<DetailDialog title="长表单" onClose={()=>setModal(false)}>{Array.from({length:20},(_,i)=><label className="field" key={i}>字段{i}<input/></label>)}<button className="primary">保存</button></DetailDialog>}</PageFrame>;
 const props:any={profile,busy:false,notice:'',run:asyncNoop,onBack:noop,onLogout:noop,onSave:asyncNoop,onRolesChange:noop,onEditMbti:noop,onAddRole:noop,onCreate:noop,onJoin:noop,onRejoin:noop,onPickRole:noop,onSuccess:asyncNoop};
 if(gameId==='auth')return <Auth {...props}/>;
 if(gameId==='home')return <Home {...props} recentOverride={[]}/>;
 if(gameId==='mbti')return <MbtiSetup {...props}/>;
 if(gameId==='role')return <RoleSetup {...props} room={room} draft={profile.roles[0]} onDraft={noop} onNotice={noop}/>;
 if(gameId==='room')return <RoomLobby {...props} room={{...room,game:null}} member={member} isHost={member.accountId==='p0'} onHome={noop} onRole={noop} onResume={noop} onPlan={asyncNoop} onHostAction={noop} onTimelineStart={noop} onStart={noop}/>;
 return <PlaySurface room={room} member={member} isHost={member.accountId==='p0'} hostOpen={false} setHostOpen={noop} busy={false} notice="" onRefresh={noop} run={asyncNoop} onExit={noop} onReplay={noop} onStartNext={noop} onLogout={noop} onEditMbti={noop}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
