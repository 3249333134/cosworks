import { useState } from 'react';
import { GAME_DEFINITIONS, type GameHistory, type RoomSnapshot, type UndercoverView } from '@ruxiju/shared';
import { api, uid } from './api';
import './undercover.css';

type Props={room:RoomSnapshot;memberId:string;onRefresh:(room:RoomSnapshot)=>void;onExit:()=>void;onHost:()=>void;onRules:()=>void};

export function UndercoverGame({room,memberId,onRefresh,onExit,onHost,onRules}:Props){
  const view=room.game?.privateState?.undercover as UndercoverView|undefined;
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  if(!room.game||!view)return null;
  const me=view.participants.find(p=>p.accountId===memberId),host=Boolean(room.members.find(m=>m.accountId===memberId)?.hostRole);
  const speaker=view.participants.find(p=>p.accountId===view.speakerId),alive=new Set(view.alive);
  const act=async(action:string,payload:Record<string,unknown>={})=>{setBusy(true);setNotice('');try{const data=await api<{room:RoomSnapshot}>(`/rooms/${room.code}/actions`,{method:'POST',body:JSON.stringify({actionId:uid(),gameId:'undercover',action,payload:{sessionId:room.game!.sessionId,round:view.round,...payload}})});onRefresh(data.room);}catch(error){setNotice(error instanceof Error?error.message:'操作失败，请重试');}finally{setBusy(false);}};
  const eliminated=view.lastResult?.eliminated?view.participants.find(p=>p.accountId===view.lastResult!.eliminated):null;
  return <main className="play-surface undercover-game">
    <header className="play-header"><button onClick={onExit} aria-label="返回房间">‹</button><strong>{GAME_DEFINITIONS.undercover.name}</strong>{host?<button className="host-chip" onClick={onHost}>主持</button>:<span className="connection"><i/>在线</span>}</header>
    <section className="undercover-stage">
      <div className="undercover-mark"><span>卧</span></div>
      <p className="undercover-kicker">{view.ipTheme} · {view.stage==='setup'?'秘密发牌':`第 ${view.round} 轮`}</p>
      {view.stage==='setup'&&<Setup view={view} host={host} busy={busy} onAct={act}/>} 
      {view.stage!=='setup'&&view.stage!=='complete'&&<PrivateWord word={view.ownWord}/>} 
      {view.stage==='speaking'&&<section className="undercover-panel">{view.lastResult&&view.lastResult.round<view.round&&<div className="undercover-last-result"><span>上一轮结果</span><strong>{view.lastResult.eliminated?`${view.participants.find(p=>p.accountId===view.lastResult!.eliminated)?.displayName??'玩家'} 出局`:'平票，无人出局'}</strong></div>}<span>现在发言</span><h1>{speaker?.displayName??'当前玩家'}</h1><p>{speaker?.playerRole??'角色'}请描述自己的词，不能直接说出答案。</p>{view.speakerId===memberId&&<button className="primary" disabled={busy} onClick={()=>void act('undercover-spoke')}>我描述完了</button>}{host&&alive.has(memberId)&&view.speakerId!==memberId&&<button className="undercover-secondary" disabled={busy} onClick={()=>void act('undercover-skip',{speakerId:view.speakerId})}>跳过本位发言</button>}</section>}
      {view.stage==='voting'&&<section className="undercover-panel"><span>秘密投票</span><h1>{view.ownVote?'你的票已锁定':'谁的词不一样？'}</h1><p>每人只能投一票，不能投自己。结束前不显示票数和他人的选择。</p>{alive.has(memberId)&&!view.ownVote?<div className="undercover-votes">{view.participants.filter(p=>alive.has(p.accountId)&&p.accountId!==memberId).map(p=><button key={p.accountId} disabled={busy} onClick={()=>void act('undercover-vote',{target:p.accountId})}><strong>{p.displayName}</strong><small>{p.playerRole}</small></button>)}</div>:<p className="undercover-status">{alive.has(memberId)?`已投给 ${view.participants.find(p=>p.accountId===view.ownVote)?.displayName??'一位玩家'}，不可修改。`:'你已出局，本轮旁观投票。'}</p>}{host&&<button className="undercover-secondary" disabled={busy||view.votedCount===0} onClick={()=>void act('undercover-close-vote')}>提前结束投票 · 未投算弃权</button>}<small className="undercover-progress">已有 {view.votedCount}/{view.totalVoters} 人完成投票</small></section>}
      {view.stage==='result'&&<section className="undercover-panel"><span>本轮结果</span><h1>{eliminated?`${eliminated.displayName} 出局`:'平票，无人出局'}</h1><p>{eliminated?`${eliminated.playerRole}暂时离场，身份仍不公开。`:'最高票并列，本轮不淘汰任何人。'}</p>{host?<button className="primary" disabled={busy} onClick={()=>void act('undercover-next')}>开始下一轮描述</button>:<p className="undercover-status">等待主持开始下一轮。</p>}</section>}
      {view.stage==='complete'&&<Result view={view}/>} 
      {notice&&<p className="notice" role="alert">{notice}</p>}
      <button className="rules-link" onClick={onRules}>查看本局规则</button>
    </section>
    {view.stage==='complete'&&<footer className="play-footer"><button className="primary" onClick={onExit}>返回聚会经历</button></footer>}
  </main>;
}

function Setup({view,host,busy,onAct}:{view:UndercoverView;host:boolean;busy:boolean;onAct:(action:string,payload?:Record<string,unknown>)=>Promise<void>}){const [count,setCount]=useState(view.count);return <section className="undercover-panel"><span>主持也作为玩家参与</span><h1>{view.participants.length} 人已入局</h1><p>系统推荐 {view.recommended} 名卧底。发牌后，所有人都只能查看自己的词，主持也看不到身份名单。</p><div className="undercover-count"><button aria-label="减少卧底" disabled={!host||busy||count<=1} onClick={()=>setCount(n=>n-1)}>−</button><div><strong>{count}</strong><small>名卧底</small></div><button aria-label="增加卧底" disabled={!host||busy||count>=view.maxCount} onClick={()=>setCount(n=>n+1)}>＋</button></div>{host&&count!==view.count&&<button className="undercover-secondary" disabled={busy} onClick={()=>void onAct('undercover-count',{count})}>保存卧底人数</button>}{host?<button className="primary" disabled={busy||count!==view.count} onClick={()=>void onAct('undercover-deal')}>{busy?'正在按 IP 生成词语…':'生成词语并秘密发牌'}</button>:<p className="undercover-status">等待主持确认卧底人数并发牌。</p>}</section>}
function PrivateWord({word}:{word:string|null}){return <article className="undercover-word"><span>你的词 · 仅自己可见</span><strong>{word??'正在发牌'}</strong><small>这里只显示词语，不显示你是平民还是卧底。</small></article>}
function Result({view}:{view:UndercoverView}){const spies=new Set(view.reveal?.spies??[]);return <section className="undercover-panel undercover-result"><span>{view.aborted?'本场提前结束':'游戏结束'}</span><h1>{view.aborted?'身份公开':view.winner==='undercover'?'卧底获胜':'平民获胜'}</h1><div className="undercover-reveal"><div><small>平民词</small><strong>{view.reveal?.words?.civilian??'未记录'}</strong></div><div><small>卧底词</small><strong>{view.reveal?.words?.undercover??'未记录'}</strong></div></div><ul>{view.participants.map(p=><li key={p.accountId}><span>{p.displayName} · {p.playerRole}</span><strong>{spies.has(p.accountId)?'卧底':'平民'}</strong></li>)}</ul></section>}

export function UndercoverRules(){return <ol className="dont-rules must-rules"><li><strong>秘密发牌</strong><span>词语按房间 IP 生成。每个人只看自己的词，主持也参与游戏，不能查看他人的词或身份。</span></li><li><strong>轮流描述</strong><span>所有存活玩家依次描述自己的词，不能直接说出答案。全员发言后进入秘密投票。</span></li><li><strong>投票淘汰</strong><span>每人一票，不能投自己，提交后不可修改。投票结束前不显示票数或他人的选择；最高票唯一者出局，平票则无人出局并进入下一轮。</span></li><li><strong>胜负</strong><span>所有卧底出局时平民获胜；每次投票结算后，若存活卧底人数大于或等于存活平民人数，卧底立即获胜。</span></li></ol>}
export function UndercoverOverview({view}:{view:UndercoverView}){const speaker=view.participants.find(p=>p.accountId===view.speakerId);return <div className="undercover-overview"><p>{view.stage==='setup'?`等待发牌 · ${view.count} 名卧底`:view.stage==='speaking'?`第 ${view.round} 轮 · ${speaker?.displayName??'当前玩家'}发言`:view.stage==='voting'?`${view.votedCount}/${view.totalVoters} 人已投票`:view.stage==='result'?'等待下一轮':'游戏结束'}</p>{view.ownWord&&view.stage!=='complete'&&<PrivateWord word={view.ownWord}/>}</div>}
export function UndercoverHistory({history}:{history:NonNullable<GameHistory['undercover']>}){return <div className="history-summary"><Result view={history}/>{history.reveal?.rounds.length?<ol className="undercover-rounds">{history.reveal.rounds.map(round=><li key={round.round}><strong>第 {round.round} 轮</strong><span>{round.eliminated?`${history.participants.find(p=>p.accountId===round.eliminated)?.displayName??'玩家'}出局`:'平票，无人出局'}</span></li>)}</ol>:null}</div>}
