import { useState } from 'react';
import { PageFrame } from './AdaptivePage';
import { GAME_DEFINITIONS, isPartyGame, type PartyView, type RoomSnapshot } from '@ruxiju/shared';
import { api, uid } from './api';
import './party.css';

type Props = { room: RoomSnapshot; memberId: string; onRefresh: (room: RoomSnapshot) => void; onExit: () => void; onHost: () => void; onRules: () => void };

/** 抽题后需要揭晓答案的玩法 */
const NEEDS_REVEAL = new Set(['turtle', 'quiz', 'charades', 'describe', 'twenty']);
/** 靠提交答案判定的玩法 */
const GUESS_GAMES = new Set(['quiz', 'charades', 'describe', 'twenty']);

const TONE_CLASS: Record<string, string> = {
  perform: 'party-tone-perform',
  observe: 'party-tone-observe',
  verbal: 'party-tone-verbal',
  speed: 'party-tone-speed'
};

export function PartyGame({ room, memberId, onRefresh, onExit, onHost, onRules }: Props) {
  const game = room.game;
  const view = game?.privateState?.party as PartyView | undefined;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [guess, setGuess] = useState('');
  const [question, setQuestion] = useState('');
  const [diceCount, setDiceCount] = useState<number | null>(null);
  const [diceSides, setDiceSides] = useState<number | null>(null);
  if (!game || !view) return null;

  const def = GAME_DEFINITIONS[view.gameId];
  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true); setNotice('');
    try {
      const data = await api<{ room: RoomSnapshot }>(`/rooms/${room.code}/actions`, { method: 'POST', body: JSON.stringify({ actionId: uid(), gameId: view.gameId, action, payload }) });
      onRefresh(data.room);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败，请重试');
      return false;
    } finally { setBusy(false); }
  };

  const submitGuess = async () => {
    const text = guess.trim();
    if (!text) return;
    if (await act('party-guess', { guess: text })) setGuess('');
  };
  const submitQuestion = async () => {
    const text = question.trim();
    if (!text) return;
    if (await act('party-question', { text })) setQuestion('');
  };

  const waiting = !view.current && view.mode === 'draw';
  const turnLabel = view.turnName ?? '—';

  return <PageFrame scope={`${game.sessionId}:${memberId}`} className="play-surface party-game">
    <header className="play-header">
      <button onClick={onExit} aria-label="返回房间">‹</button>
      <strong>{def.name}</strong>
      {view.isHost ? <button className="host-chip" onClick={onHost}>主持</button> : <span className="connection"><i />在线</span>}
    </header>

    <section className="party-stage">
      <div className="party-meta">
        <span className="party-round">{view.mode === 'roll' ? '随时可摇' : view.mode === 'deal' ? `${view.phase ?? '已发牌'} · 第 ${view.round} 轮` : `第 ${view.round} 轮`}</span>
        {view.turnName && <span>轮到 <strong>{view.turnName}</strong></span>}
        {view.mode === 'draw' && <span>题库剩 {view.deckLeft}</span>}
      </div>

      {view.stage === 'complete' && <ResultCard view={view} />}

      {view.stage !== 'complete' && view.mode === 'roll' && <DiceStage view={view} busy={busy} onRoll={(payload) => void act('party-roll', payload)} diceCount={diceCount} diceSides={diceSides} setDiceCount={setDiceCount} setDiceSides={setDiceSides} />}

      {view.stage !== 'complete' && view.mode === 'deal' && view.gameId === 'werewolf' && <WerewolfStage view={view} />}
      {view.stage !== 'complete' && view.mode === 'deal' && view.gameId === 'whoami' && <WhoamiStage view={view} busy={busy} guess={guess} setGuess={setGuess} onSubmitGuess={submitGuess} />}

      {view.stage !== 'complete' && view.mode === 'draw' && <>
        {waiting
          ? <div className="party-card party-wait">
              <p className="party-kicker">{view.flavorSource === 'legacy' ? '等待抽题' : `${view.theme} · 专属牌库`}</p>
              <h1 className="party-title">{view.isHost ? '抽一道题开始这一轮' : `等待主持为 ${turnLabel} 抽题`}</h1>
              <p className="party-detail">{def.shortRule}</p>
              {view.flavorSource !== 'legacy' && <p className="party-flavor">牌面会按在场每个人的角色设定和 MBTI 自动调整语气与提示方式。</p>}
            </div>
          : <PromptCard view={view} busy={busy} onReveal={() => void act('party-reveal')} />}
        {(view.gameId === 'turtle' || view.gameId === 'twenty') && <NotesCard view={view} busy={busy} question={question} setQuestion={setQuestion} onSubmitQuestion={submitQuestion} />}
        {GUESS_GAMES.has(view.gameId) && view.current && <GuessCard view={view} busy={busy} guess={guess} setGuess={setGuess} onSubmit={submitGuess} />}
        {view.log.length > 1 && <LogCard view={view} />}
      </>}

      {view.log.length > 1 && view.mode === 'draw' && view.stage === 'complete' && <LogCard view={view} />}
      {notice && <p className="notice" role="alert">{notice}</p>}
      <button className="rules-link party-rules-link" onClick={onRules}>查看本场规则</button>
    </section>

    {view.stage !== 'complete' && view.isHost && <footer className="party-hostbar">
      {view.mode === 'draw' && <button className="party-action" disabled={busy} onClick={() => void act('party-draw')}>{view.current ? '换一题' : '抽题'}</button>}
      {view.mode === 'draw' && view.current && NEEDS_REVEAL.has(view.gameId) && !view.current.revealed && <button className="party-action" disabled={busy} onClick={() => void act('party-reveal')}>揭晓答案</button>}
      {view.mode === 'draw' && <button className="party-action" disabled={busy} onClick={() => void act('party-next')}>下一位</button>}
      {view.mode === 'deal' && view.gameId === 'werewolf' && <button className="party-action" disabled={busy} onClick={() => void act('party-phase')}>推进阶段</button>}
      <button className="primary party-finish" disabled={busy} onClick={() => void act('party-finish')}>结束本场</button>
    </footer>}

    {view.stage === 'complete' && <footer className="play-footer"><button className="primary" onClick={onExit}>返回聚会经历</button></footer>}
  </PageFrame>;
}

function PromptCard({ view, busy, onReveal }: { view: PartyView; busy: boolean; onReveal: () => void }) {
  const current = view.current!;
  const hidden = current.label === '等待揭晓';
  const kicker = current.kicker ?? (view.gameId === 'turtle' ? '汤面' : hidden ? '正在出题' : current.mine ? '只有你看得到' : '题目');
  const tone = current.tags?.[0] ? TONE_CLASS[current.tags[0]] ?? '' : view.myBucket ? TONE_CLASS[view.myBucket] ?? '' : '';
  return <article className={`party-card party-prompt ${current.revealed ? 'is-revealed' : ''} ${tone}`}>
    <p className="party-kicker">{kicker}</p>
    <h1 className="party-title">{current.label}</h1>
    {current.flavor && <p className="party-flavor">{current.flavor}</p>}
    {current.detail && <p className="party-detail">{current.detail}</p>}
    {hidden && !current.mine && <p className="party-hint">{current.ownerName ?? '出题人'} 已经拿到内容，其他人看不到。用语言或动作把答案传递出来。</p>}
    {current.revealed && current.answer && <div className="party-answer"><span>答案</span><p>{current.answer}</p></div>}
    {current.revealed && !current.answer && <p className="party-hint">本题已揭晓，点“下一位”继续。</p>}
    {!current.revealed && current.mine && !view.isHost && <p className="party-hint">由你来出题，完成后等待主持揭晓或进入下一位。</p>}
    {!current.revealed && current.mine && view.isHost && <button className="party-inline" disabled={busy} onClick={onReveal}>揭晓答案</button>}
    {view.gameId === 'twenty' && view.limit !== null && <p className="party-counter">还能提问 <strong>{view.limit}</strong> 次</p>}
  </article>;
}

function GuessCard({ view, busy, guess, setGuess, onSubmit }: { view: PartyView; busy: boolean; guess: string; setGuess: (value: string) => void; onSubmit: () => void }) {
  const isOwner = view.current?.mine ?? false;
  const disabled = !view.canGuess || isOwner || busy;
  return <article className="party-card party-guess">
    <p className="party-kicker">抢答</p>
    {isOwner
      ? <p className="party-hint">题目在你手上，不能自己答。等其他人抢答或主持揭晓。</p>
      : <form className="party-guess-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <input value={guess} onChange={event => setGuess(event.target.value)} placeholder={view.ownGuess ? `已提交：${view.ownGuess}` : '写下你的答案'} maxLength={40} disabled={!view.canGuess || busy} />
          <button type="submit" disabled={disabled || !guess.trim()}>提交</button>
        </form>}
    {view.guesses.length > 0 && <ul className="party-guess-list">
      {view.guesses.map((item, index) => <li key={`${item.accountId}-${index}`} className={item.correct === true ? 'is-correct' : item.correct === false ? 'is-wrong' : ''}>
        <span>{item.displayName}</span>
        <strong>{item.text}</strong>
        {item.correct === true && <em>✓</em>}
        {item.correct === false && <em>✗</em>}
      </li>)}
    </ul>}
    {view.guesses.length > 0 && <p className="party-hint">已收到 {view.guesses.length} 份答案。</p>}
  </article>;
}

function NotesCard({ view, busy, question, setQuestion, onSubmitQuestion }: { view: PartyView; busy: boolean; question: string; setQuestion: (value: string) => void; onSubmitQuestion: () => void }) {
  const verdictLabel: Record<string, string> = { yes: '是', no: '否', irrelevant: '无关', close: '接近', question: '提问' };
  return <article className="party-card party-notes">
    <p className="party-kicker">{view.gameId === 'twenty' ? '提问记录' : '问答留档'}</p>
    {view.gameId === 'twenty' && <form className="party-guess-form" onSubmit={event => { event.preventDefault(); onSubmitQuestion(); }}>
      <input value={question} onChange={event => setQuestion(event.target.value)} placeholder="提一个只能用是 / 否回答的问题" maxLength={60} disabled={busy || (view.limit ?? 0) <= 0} />
      <button type="submit" disabled={busy || !question.trim() || (view.limit ?? 0) <= 0}>记录</button>
    </form>}
    {view.notes.length === 0
      ? <p className="party-hint">{view.isHost ? '可以在下方主持抽屉里补充“是 / 否 / 无关”的问答记录，方便回看。' : '还没有问答记录。'}</p>
      : <ul className="party-note-list">{view.notes.slice().reverse().map((note, index) => <li key={`${note.at}-${index}`}>
          <span>{note.displayName}</span>
          <strong>{note.text}</strong>
          <em className={`v-${note.verdict}`}>{verdictLabel[note.verdict] ?? note.verdict}</em>
        </li>)}</ul>}
  </article>;
}

function LogCard({ view }: { view: PartyView }) {
  return <article className="party-card party-log">
    <p className="party-kicker">本场记录</p>
    <ol>{view.log.slice().reverse().map((entry, index) => <li key={`${entry.at}-${index}`}>
      <span>{entry.ownerName ?? '公开'}</span>
      <strong>{entry.label}</strong>
      {entry.revealed && entry.detail && <small>{entry.detail}</small>}
    </li>)}</ol>
  </article>;
}

function DiceStage({ view, busy, onRoll, diceCount, diceSides, setDiceCount, setDiceSides }: {
  view: PartyView; busy: boolean; onRoll: (payload: Record<string, unknown>) => void;
  diceCount: number | null; diceSides: number | null; setDiceCount: (value: number) => void; setDiceSides: (value: number) => void;
}) {
  const latest = view.dice[0];
  const count = diceCount ?? view.diceConfig.count;
  const sides = diceSides ?? view.diceConfig.sides;
  return <>
    <article className="party-card party-dice">
      <p className="party-kicker">骰盅</p>
      {latest
        ? <>
            <div className="party-dice-row">{latest.values.map((value, index) => <span key={index}>{value}</span>)}</div>
            <p className="party-dice-total">合计 <strong>{latest.total}</strong> · {latest.displayName} 摇的</p>
          </>
        : <p className="party-hint">还没有人摇过。谁来开第一把？</p>}
      <div className="party-dice-controls">
        <label>数量<select value={count} onChange={event => setDiceCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>面数<select value={sides} onChange={event => setDiceSides(Number(event.target.value))}>{[4, 6, 8, 10, 12, 20, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <button className="primary" disabled={busy} onClick={() => onRoll({ count, sides })}>摇一次</button>
    </article>
    {view.dice.length > 1 && <article className="party-card party-log">
      <p className="party-kicker">最近结果</p>
      <ol>{view.dice.map((roll, index) => <li key={`${roll.at}-${index}`}><span>{roll.displayName}</span><strong>{roll.values.join(' + ')} = {roll.total}</strong></li>)}</ol>
    </article>}
  </>;
}

function WerewolfStage({ view }: { view: PartyView }) {
  const role = view.hand?.[0] ?? '等待发牌';
  const hint: Record<string, string> = {
    '夜晚': '所有人闭眼，狼人睁眼互相确认并选择目标；预言家、女巫、守卫依次行动。',
    '白天': '公布昨夜结果，所有人依次发言并陈述怀疑对象。',
    '投票': '所有人同时投票，票数最高者出局；平票则本轮无人出局。'
  };
  return <>
    <article className={`party-card party-role ${view.myBucket ? TONE_CLASS[view.myBucket] ?? '' : ''}`}>
      <p className="party-kicker">你的身份 · 仅自己可见</p>
      <h1 className="party-title party-role-name">{role}</h1>
      {view.handFlavor && <p className="party-flavor">{view.handFlavor}</p>}
      <p className="party-hint">不要把屏幕给别人看。手机只负责身份和阶段提示，发言与投票在线下完成。</p>
    </article>
    <article className="party-card">
      <p className="party-kicker">当前阶段</p>
      <h2 className="party-phase">{view.phase ?? '夜晚'}</h2>
      <p className="party-detail">{hint[view.phase ?? '夜晚']}</p>
      {view.isHost ? <p className="party-hint">由你确认现场节奏后推进阶段。</p> : <p className="party-hint">等待主持推进阶段。</p>}
    </article>
  </>;
}

function WhoamiStage({ view, busy, guess, setGuess, onSubmitGuess }: { view: PartyView; busy: boolean; guess: string; setGuess: (value: string) => void; onSubmitGuess: () => void }) {
  const myGuess = view.guesses.find(item => item.text === view.ownGuess);
  return <>
    <article className="party-card party-role">
      <p className="party-kicker">{view.flavorSource === 'legacy' ? '你头上的身份' : `${view.theme} · 你头上的身份`}</p>
      <h1 className="party-title party-role-name">？</h1>
      <p className="party-hint">你自己看不到，其他人屏幕上都写着你的身份。只能用是 / 否问题来猜。</p>
    </article>
    <article className="party-card">
      <p className="party-kicker">其他人看到的身份</p>
      <ul className="party-whoami-list">{view.others?.map(item => <li key={item.accountId}><span>{item.displayName}</span><strong>{item.card}</strong></li>)}</ul>
    </article>
    <article className="party-card">
      <p className="party-kicker">提交猜测</p>
      {myGuess
        ? <p className="party-detail">你猜的是「{myGuess.text}」{myGuess.correct ? '，猜中了！' : '，还不对，继续问。'}</p>
        : <form className="party-guess-form" onSubmit={event => { event.preventDefault(); onSubmitGuess(); }}>
            <input value={guess} onChange={event => setGuess(event.target.value)} placeholder="我猜我是…" maxLength={40} disabled={busy} />
            <button type="submit" disabled={busy || !guess.trim()}>提交</button>
          </form>}
      {view.points && Object.keys(view.points).length > 0 && <ul className="party-points">{Object.entries(view.points).map(([accountId, points]) => <li key={accountId}>{view.others?.find(item => item.accountId === accountId)?.displayName ?? '玩家'}<strong>{points}</strong></li>)}</ul>}
    </article>
  </>;
}

function ResultCard({ view }: { view: PartyView }) {
  const results = view.results ?? [];
  return <article className="party-card party-result">
    <p className="party-kicker">本场结束</p>
    <h1 className="party-title">{results.some(item => item.winner) ? `${results.filter(item => item.winner).map(item => item.displayName).join('、')} 领先` : '本场结束'}</h1>
    {results.length > 0 && <ol className="party-score-list">{results.map(item => <li key={item.accountId} className={item.winner ? 'is-winner' : ''}><span>{item.displayName}</span><strong>{item.points} 分</strong></li>)}</ol>}
    {view.revealAll && view.revealAll.length > 0 && <div className="party-reveal"><p className="party-kicker">身份公开</p><ul>{view.revealAll.map(item => <li key={item.accountId}><span>{item.displayName}</span><strong>{item.card}</strong></li>)}</ul></div>}
  </article>;
}

export function PartyRules({ gameId }: { gameId: string }) {
  const def = isPartyGame(gameId) ? GAME_DEFINITIONS[gameId] : null;
  if (!def) return <p className="muted">暂无规则说明</p>;
  const card = def.ruleCard;
  return <ol className="dont-rules must-rules">
    <li><strong>目标</strong><span>{card.goal}</span></li>
    {card.props && <li><strong>道具</strong><span>{card.props}</span></li>}
    {card.flow.map((step, index) => <li key={index}><strong>{step.title}</strong><span>{step.detail}</span></li>)}
    <li><strong>胜负</strong><span>{card.win}</span></li>
    {card.tips.length > 0 && <li><strong>注意</strong><span>{card.tips.join('；')}</span></li>}
    <li><strong>玩家范围</strong><span>{def.minPlayers}–{def.maxPlayers} 人，主持人也可以作为玩家参加；所有内容都只在自己的手机上显示。</span></li>
  </ol>;
}
