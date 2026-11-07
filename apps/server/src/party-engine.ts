import { randomUUID } from 'node:crypto';
import { GAME_DEFINITIONS, flavorBucket, isPartyGame, normalizePartyText, partyMatches, PARTY_FLAVOR_VERSION, personalizeCard, mbtiWeights, buildThemeWhoamiPool, assignIdentitiesAvoidSelf, mulberry32, stableSeed, type FlavorBucket, type GameAction, type GameId, type PartyCardView, type PartyGameId, type PartyGuessView, type PartyRoleProfile, type PartyView, type RoomSnapshot } from '@ruxiju/shared';
import { PARTY_DICE_DEFAULT, TWENTY_QUESTIONS, partyDeck, werewolfRoles, WHOAMI_ROLES, type PartyCard } from './party-content.js';

function shuffle<T>(arr: readonly T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 轻量玩法引擎：一套「发牌 / 抽题 / 揭晓 / 下一位」的骨架覆盖 13 款现场玩法。
 * - deal：每人私密拿一张身份牌（狼人杀、我是谁）
 * - draw：按顺序从牌堆或题库抽一张（小姐牌、海龟汤、你说我猜…）
 * - roll：实时骰盅
 * 私密内容只存在 privateState，对外一律经过 partyView 裁剪。
 */
export interface PartyLogEntry { label: string; detail: string | null; answer: string | null; owner: string | null; private: boolean; revealed: boolean; at: number }
export interface PartyGuess { accountId: string; text: string; correct: boolean | null; at: number }
export interface PartyNote { accountId: string; text: string; verdict: string; at: number }
export interface PartyDice { count: number; sides: number; rolls: Array<{ accountId: string; values: number[]; total: number; at: number }> }

export interface PartyState {
  mode: 'deal' | 'draw' | 'roll';
  stage: 'playing' | 'reveal' | 'complete';
  round: number;
  order: string[];
  turnIndex: number;
  deck: PartyCard[];
  used: PartyCard[];
  current: { card: PartyCard; owner: string | null; revealed: boolean } | null;
  hands: Record<string, PartyCard[]>;
  guesses: PartyGuess[];
  log: PartyLogEntry[];
  points: Record<string, number>;
  notes: PartyNote[];
  dice: PartyDice;
  limit: number | null;
  phase: 'night' | 'day' | 'vote' | null;
  dealtAt: number | null;
  /** 个性化：房间 IP 主题快照 */
  theme: string;
  /** 个性化：开局时的全员角色档案（缺档成员 playerRole 回退昵称、mbti=null） */
  roster: PartyRoleProfile[];
  /** 个性化版本；0 = 升级前的旧局（不生成 flavor） */
  flavorVersion: number;
  flavorSource: 'local' | 'ai' | 'legacy';
}

/** 开局注入：主题、全员档案、AI 增强牌堆（缺省回退本地题库） */
export interface PartyStartInput {
  theme?: string;
  profiles?: PartyRoleProfile[];
  cards?: PartyCard[];
  flavorSource?: 'local' | 'ai';
}

const DEAL_GAMES: PartyGameId[] = ['werewolf', 'whoami'];
const ROLL_GAMES: PartyGameId[] = ['dice'];
/** 抽到之后需要揭晓答案的玩法 */
const REVEAL_GAMES: PartyGameId[] = ['turtle', 'quiz', 'charades', 'describe', 'twenty'];
/** 牌面只有持有者能看的玩法 */
const PRIVATE_PROMPT_GAMES: PartyGameId[] = ['charades', 'describe', 'twenty'];
/** 猜错也不公开内容的玩法 */
const MASK_GUESS_GAMES: PartyGameId[] = ['quiz'];

const WEREWOLF_PHASES: Array<{ id: 'night' | 'day' | 'vote'; label: string; hint: string }> = [
  { id: 'night', label: '夜晚', hint: '所有人闭眼，狼人睁眼互相确认并选择目标，预言家、女巫、守卫依次行动。' },
  { id: 'day', label: '白天', hint: '公布昨夜结果，所有人依次发言并陈述怀疑对象。' },
  { id: 'vote', label: '投票', hint: '所有人同时投票，票数最高者出局；平票则本轮无人出局。' }
];

/** 轻量玩法不要求先选角色，房间里的所有人都算参与者 */
function activeMembers(room: RoomSnapshot) { return room.members; }

/** 牌的桶位（取第一个标签）；无标签的牌权重恒为 1，不参与个性化倾斜 */
function primaryBucketOf(card: PartyCard): FlavorBucket | null {
  return card.tags?.[0] ?? null;
}

/**
 * 个性化牌序：牌堆第 i 张会被 order[i % 人数] 号玩家抽到，
 * 因此按「位置 → 潜在持有者」用该玩家的 MBTI 桶位权重加权抽取（不放回）。
 * 只重排不裁剪，牌数与集合恒不变；无档案/无标签时退化为普通洗牌。
 */
function personalizedDeck(cards: PartyCard[], roster: PartyRoleProfile[], order: string[], rand: () => number): PartyCard[] {
  if (!roster.length || !cards.some(card => card.tags?.length)) return shuffle(cards);
  const profileOf = new Map(roster.map(profile => [profile.accountId, profile]));
  const weightOf = (card: PartyCard, accountId: string) => {
    const bucket = primaryBucketOf(card);
    if (!bucket) return 1;
    const weights = mbtiWeights(profileOf.get(accountId)?.mbti);
    return weights[bucket];
  };
  const remaining = cards.slice();
  const result: PartyCard[] = [];
  while (remaining.length) {
    const owner = order[result.length % order.length] ?? '';
    const total = remaining.reduce((sum, card) => sum + weightOf(card, owner), 0);
    let cursor = rand() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      cursor -= weightOf(remaining[i], owner);
      if (cursor <= 0) { index = i; break; }
    }
    result.push(...remaining.splice(index, 1));
  }
  return result;
}

function createState(room: RoomSnapshot, gameId: PartyGameId, input?: PartyStartInput): PartyState {
  const active = activeMembers(room);
  const order = shuffle(active.map(member => member.accountId));
  const mode: PartyState['mode'] = DEAL_GAMES.includes(gameId) ? 'deal' : ROLL_GAMES.includes(gameId) ? 'roll' : 'draw';
  const roster = input?.profiles ?? [];
  const theme = input?.theme ?? room.ipTheme;
  const rand = mulberry32(stableSeed(`${room.id}|${gameId}|${Date.now()}|${Math.random()}`));
  const deck = mode === 'draw' ? personalizedDeck(input?.cards?.length ? input.cards : partyDeck(gameId), roster, order, rand) : [];
  const hands: Record<string, PartyCard[]> = {};
  let phase: PartyState['phase'] = null;
  if (gameId === 'werewolf') {
    const roles = werewolfRoles(order.length);
    order.forEach((accountId, index) => { hands[accountId] = [{ label: roles[index] ?? '村民' }]; });
    phase = 'night';
  }
  if (gameId === 'whoami') {
    // 名单优先取「在场成员自己的角色名 + 房间 IP 主题」，静态表兜底；分配时避免抽到自己
    const roleOf = new Map(roster.map(profile => [profile.accountId, profile.playerRole]));
    const ownRoles = order.map(id => roleOf.get(id) ?? active.find(member => member.accountId === id)?.playerRole ?? null);
    const pool = buildThemeWhoamiPool(theme, ownRoles.filter((role): role is string => Boolean(role)), WHOAMI_ROLES, order.length);
    const identities = assignIdentitiesAvoidSelf(shuffle(pool), ownRoles);
    order.forEach((accountId, index) => { hands[accountId] = [{ label: identities[index] ?? '神秘角色' }]; });
  }
  return {
    mode, stage: 'playing', round: 1, order, turnIndex: 0, deck, used: [],
    current: null, hands, guesses: [], log: [], points: {},
    notes: [], dice: { ...PARTY_DICE_DEFAULT, rolls: [] },
    limit: gameId === 'twenty' ? TWENTY_QUESTIONS : null,
    phase, dealtAt: Date.now(),
    theme, roster, flavorVersion: roster.length ? PARTY_FLAVOR_VERSION : 0,
    flavorSource: roster.length ? input?.flavorSource ?? 'local' : 'legacy'
  };
}

export function ensurePartyGame(room: RoomSnapshot, input?: PartyStartInput): RoomSnapshot {
  if (!isPartyGame(room.currentGame) || !room.game) return room;
  const existing = room.game.privateState?.party as PartyState | undefined;
  if (existing) { syncPublic(room, existing); return room; }
  const state = createState(room, room.currentGame, input);
  room.game.privateState = { party: state };
  room.game.publicState = {};
  room.game.primaryAction = primaryActionFor(room.currentGame, state);
  syncPublic(room, state);
  return room;
}

export function partyState(room: RoomSnapshot): PartyState | undefined {
  if (!room.game || !isPartyGame(room.currentGame)) return undefined;
  const value = room.game.privateState?.party as PartyState | undefined;
  if (!value) return undefined;
  value.order ??= activeMembers(room).map(member => member.accountId);
  value.hands ??= {};
  value.guesses ??= [];
  value.log ??= [];
  value.points ??= {};
  value.notes ??= [];
  value.used ??= [];
  value.deck ??= [];
  value.dice ??= { ...PARTY_DICE_DEFAULT, rolls: [] };
  value.dice.rolls ??= [];
  value.stage ??= 'playing';
  value.round ??= 1;
  value.turnIndex ??= 0;
  value.theme ??= room.ipTheme;
  value.roster ??= [];
  value.flavorVersion ??= 0;
  value.flavorSource ??= 'legacy';
  return value;
}

export function handlePartyAction(room: RoomSnapshot, accountId: string, input: GameAction): RoomSnapshot {
  const gameId = input.gameId as PartyGameId;
  const state = partyState(room);
  if (!state) throw new Error('玩法尚未初始化');
  const member = room.members.find(item => item.accountId === accountId);
  if (!member) throw new Error('你不在这个房间');
  const isHost = Boolean(member.hostRole);
  if (state.stage === 'complete') throw new Error('本场已经结算，请开启下一场');
  const card = state.current?.card;
  const cardOwner = state.current?.owner ?? null;

  switch (input.action) {
    case 'party-draw': {
      if (!isHost) throw new Error('只有主持可以抽题');
      if (state.mode !== 'draw') throw new Error('当前玩法不需要抽题');
      if (state.current && !state.current.revealed && REVEAL_GAMES.includes(gameId)) throw new Error('请先揭晓上一题，或点“下一位”跳过');
      if (state.deck.length === 0) { state.deck = shuffle(state.used); state.used = []; }
      const next = state.deck.shift();
      if (!next) throw new Error('题库暂时没有可用的题目');
      state.used.push(next);
      state.current = { card: next, owner: PRIVATE_PROMPT_GAMES.includes(gameId) ? state.order[state.turnIndex] ?? null : null, revealed: false };
      state.guesses = [];
      state.log.push({ label: next.label, detail: next.detail ?? null, answer: next.answer ?? null, owner: state.current.owner, private: PRIVATE_PROMPT_GAMES.includes(gameId), revealed: false, at: Date.now() });
      if (state.limit !== null && gameId === 'twenty') state.limit = TWENTY_QUESTIONS;
      break;
    }
    case 'party-reveal': {
      if (!isHost) throw new Error('只有主持可以揭晓答案');
      if (!state.current) throw new Error('还没有抽题');
      state.current.revealed = true;
      state.stage = 'reveal';
      const entry = state.log[state.log.length - 1];
      if (entry) entry.revealed = true;
      break;
    }
    case 'party-next': {
      if (!isHost) throw new Error('只有主持可以推进到下一位');
      if (!state.order.length) throw new Error('还没有参与玩家');
      state.current = null;
      state.guesses = [];
      state.stage = 'playing';
      if (state.limit !== null) state.limit = TWENTY_QUESTIONS;
      state.turnIndex += 1;
      if (state.turnIndex >= state.order.length) { state.turnIndex = 0; state.round += 1; }
      break;
    }
    case 'party-guess': {
      const text = String(input.payload?.guess ?? '').trim().slice(0, 40);
      if (!text) throw new Error('请输入你的答案');
      if (gameId === 'whoami') {
        const own = state.hands[accountId]?.[0]?.label;
        if (!own) throw new Error('你还没有身份牌');
        if (state.guesses.some(guess => guess.accountId === accountId)) throw new Error('你已经提交过猜测');
        const correct = normalizePartyText(text) === normalizePartyText(own);
        state.guesses.push({ accountId, text, correct, at: Date.now() });
        if (correct) state.points[accountId] = (state.points[accountId] ?? 0) + 1;
        break;
      }
      if (!state.current) throw new Error('还没有抽题');
      if (state.current.revealed) throw new Error('本题已经揭晓');
      if (cardOwner === accountId) throw new Error('出题人不能猜自己的题');
      if (!REVEAL_GAMES.includes(gameId)) throw new Error('当前玩法不需要提交答案');
      if (state.guesses.some(guess => guess.accountId === accountId)) throw new Error('你已经提交过答案');
      if (state.limit !== null && state.limit <= 0) throw new Error('20 个问题已经用完');
      const correct = partyMatches(card, text);
      state.guesses.push({ accountId, text, correct, at: Date.now() });
      if (correct) {
        state.points[accountId] = (state.points[accountId] ?? 0) + 1;
        state.current.revealed = true;
        state.stage = 'reveal';
        const entry = state.log[state.log.length - 1];
        if (entry) entry.revealed = true;
      }
      break;
    }
    case 'party-mark': {
      if (!isHost) throw new Error('只有主持可以判定');
      const targetAccountId = String(input.payload?.targetAccountId ?? '');
      const correct = Boolean(input.payload?.correct);
      const guess = state.guesses.find(item => item.accountId === targetAccountId);
      if (!guess) throw new Error('没有找到这条回答');
      guess.correct = correct;
      if (correct) {
        state.points[targetAccountId] = (state.points[targetAccountId] ?? 0) + 1;
        if (state.current) state.current.revealed = true;
        state.stage = 'reveal';
        const entry = state.log[state.log.length - 1];
        if (entry) entry.revealed = true;
      }
      break;
    }
    case 'party-question': {
      if (state.limit === null) throw new Error('当前玩法不需要记录问题');
      const text = String(input.payload?.text ?? '').trim().slice(0, 60);
      if (!text) throw new Error('请输入问题');
      if (state.limit <= 0) throw new Error('20 个问题已经用完');
      state.limit -= 1;
      state.notes.push({ accountId, text, verdict: 'question', at: Date.now() });
      break;
    }
    case 'party-note': {
      if (!isHost) throw new Error('只有主持可以记录问答');
      const text = String(input.payload?.text ?? '').trim().slice(0, 120);
      const verdict = String(input.payload?.verdict ?? 'yes');
      if (!text) throw new Error('请输入问答内容');
      state.notes.push({ accountId, text, verdict: ['yes', 'no', 'irrelevant', 'close'].includes(verdict) ? verdict : 'yes', at: Date.now() });
      if (state.notes.length > 60) state.notes = state.notes.slice(-60);
      break;
    }
    case 'party-roll': {
      if (state.mode !== 'roll') throw new Error('当前玩法不是掷骰子');
      const count = Math.max(1, Math.min(8, Number(input.payload?.count) || state.dice.count));
      const sides = Math.max(2, Math.min(100, Number(input.payload?.sides) || state.dice.sides));
      const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      state.dice.count = count;
      state.dice.sides = sides;
      state.dice.rolls.push({ accountId, values, total: values.reduce((sum, value) => sum + value, 0), at: Date.now() });
      if (state.dice.rolls.length > 40) state.dice.rolls = state.dice.rolls.slice(-40);
      break;
    }
    case 'party-phase': {
      if (!isHost) throw new Error('只有主持可以推进阶段');
      if (gameId !== 'werewolf' || !state.phase) throw new Error('当前玩法没有阶段');
      const index = WEREWOLF_PHASES.findIndex(item => item.id === state.phase);
      const next = WEREWOLF_PHASES[(index + 1) % WEREWOLF_PHASES.length];
      state.phase = next.id;
      if (next.id === 'night') state.round += 1;
      break;
    }
    case 'party-finish': {
      if (!isHost) throw new Error('只有主持可以结束本场');
      settleParty(room);
      break;
    }
    default:
      throw new Error('当前操作不适用于这款玩法');
  }
  if (room.game && !isPartySettled(state)) {
    room.game.primaryAction = primaryActionFor(gameId, state);
    syncPublic(room, state);
  }
  return room;
}

function isPartySettled(state: PartyState): boolean { return (state.stage as string) === 'complete'; }

/** 主持抽屉里的“推进当前阶段”：优先揭晓，其次进入下一位 */
export function advanceParty(room: RoomSnapshot): RoomSnapshot {
  const state = partyState(room);
  if (!state || !room.game) throw new Error('玩法尚未初始化');
  const gameId = room.currentGame as PartyGameId;
  const host = room.members.find(member => member.hostRole) ?? room.members.find(member => member.accountId === room.ownerAccountId);
  if (!host) throw new Error('房间里没有主持人');
  if (gameId === 'werewolf') return handlePartyAction(room, host.accountId, { actionId: randomUUID(), gameId, action: 'party-phase' });
  if (gameId === 'dice') { settleParty(room); return room; }
  if (state.current && !state.current.revealed && REVEAL_GAMES.includes(gameId)) {
    state.current.revealed = true;
    state.stage = 'reveal';
    const entry = state.log[state.log.length - 1];
    if (entry) entry.revealed = true;
    room.game.primaryAction = primaryActionFor(gameId, state);
    syncPublic(room, state);
    return room;
  }
  state.current = null;
  state.guesses = [];
  state.stage = 'playing';
  if (state.limit !== null) state.limit = TWENTY_QUESTIONS;
  state.turnIndex += 1;
  if (state.turnIndex >= state.order.length) { state.turnIndex = 0; state.round += 1; }
  room.game.primaryAction = primaryActionFor(gameId, state);
  syncPublic(room, state);
  return room;
}

export function settleParty(room: RoomSnapshot): RoomSnapshot {
  const state = partyState(room);
  if (!state || !room.game) return room;
  if (state.stage === 'complete') return room;
  state.stage = 'complete';
  state.current = null;
  const active = activeMembers(room);
  active.forEach(member => {
    const earned = state.points[member.accountId] ?? 0;
    if (earned > 0) member.score += earned;
  });
  room.game.scores = Object.fromEntries(room.members.map(member => [member.accountId, member.score]));
  const best = Math.max(0, ...Object.values(state.points));
  const results = active.map(member => ({ accountId: member.accountId, displayName: member.displayName, points: state.points[member.accountId] ?? 0, winner: best > 0 && (state.points[member.accountId] ?? 0) === best }));
  room.game.publicState = {
    ...room.game.publicState, stage: 'complete', round: state.round,
    results, winnerAccountIds: results.filter(item => item.winner).map(item => item.accountId),
    lastActionAt: Date.now()
  };
  room.game.phase = 'settled';
  room.game.endsAt = null;
  room.status = 'settled';
  return room;
}

function syncPublic(room: RoomSnapshot, state: PartyState) {
  if (!room.game) return;
  room.game.publicState = {
    ...room.game.publicState,
    stage: state.stage,
    round: state.round,
    turnAccountId: state.order[state.turnIndex] ?? null,
    deckLeft: state.deck.length,
    guessCount: state.guesses.length,
    phase: state.phase,
    lastActionAt: Date.now()
  };
}

function primaryActionFor(gameId: PartyGameId, state: PartyState): string {
  if (gameId === 'werewolf') return WEREWOLF_PHASES.find(item => item.id === state.phase)?.label ?? '推进阶段';
  if (gameId === 'dice') return '摇一次';
  if (state.stage === 'reveal') return '下一位';
  if (state.current) return REVEAL_GAMES.includes(gameId) ? '揭晓答案' : '下一位';
  return GAME_DEFINITIONS[gameId].primaryAction;
}

function profileFor(state: PartyState, accountId: string | null): PartyRoleProfile | null {
  if (!accountId) return null;
  return state.roster.find(profile => profile.accountId === accountId) ?? null;
}

/** 狼人杀身份牌风味句：身份结构固定，只做 IP 主题与角色口吻的包装 */
function werewolfFlavor(label: string, theme: string, profile: PartyRoleProfile | null): string {
  const role = profile?.playerRole || profile?.displayName || '你';
  switch (label) {
    case '狼人': return `《${theme}》的暗夜降临：和同伴用眼神确认目标，白天发言时带一点「${role}」的口吻掩饰身份`;
    case '预言家': return `每晚查验一人。白天可以借「${role}」的语气把情报说得像猜测`;
    case '女巫': return `解药毒药各一瓶。用「${role}」的处世方式决定今晚救谁`;
    case '猎人': return `出局时可以带走一人，别让身份提前暴露`;
    case '守卫': return `每晚守护一人，守护方式可以很有「${role}」的风格`;
    case '白痴': return `被投票出局后可以翻牌留下，但从此失去投票权`;
    default: return `《${theme}》的普通村民：你没有特殊能力。用「${role}」的性格认真发言，活到最后就是胜利`;
  }
}

function quizKicker(profile: PartyRoleProfile | null): string {
  const role = profile?.playerRole;
  return role ? `${role}问` : '知识问答';
}

/**
 * 某张牌的个性化文案。flavor 由题面生成，绝不能下发给它不该看到的人——
 * hidden 分支必须返回空值（party.test.ts 有泄漏断言）。
 */
function cardFlavor(state: PartyState, gameId: PartyGameId, card: PartyCard, subjectAccountId: string | null): { kicker: string | null; flavor: string | null; tags: FlavorBucket[] } {
  const tags = card.tags ?? [];
  if (state.flavorVersion < 1 || !state.roster.length) return { kicker: null, flavor: null, tags };
  const subject = profileFor(state, subjectAccountId);
  if (!subject) return { kicker: null, flavor: null, tags };
  if (card.flavor) return { kicker: card.kicker ?? null, flavor: card.flavor, tags };
  if (gameId === 'quiz') return { kicker: quizKicker(subject), flavor: null, tags };
  const seed = `${gameId}|${state.dealtAt ?? 0}|${card.label}`;
  const { flavor, kicker } = personalizeCard(card, subject, state.theme, seed, state.flavorSource === 'ai' ? 'ai' : 'local');
  return { kicker, flavor, tags };
}

/** 逐人裁剪后的视图：答案、他人私密牌、被隐藏的猜测都不会下发给不该看到的人 */
export function partyView(room: RoomSnapshot, accountId: string): PartyView | null {
  const state = partyState(room);
  if (!state || !room.game || !isPartyGame(room.currentGame)) return null;
  const gameId = room.currentGame;
  const me = room.members.find(member => member.accountId === accountId);
  const isHost = Boolean(me?.hostRole);
  const turnAccountId = state.order[state.turnIndex] ?? null;
  const turnName = room.members.find(member => member.accountId === turnAccountId)?.displayName ?? null;
  const current = buildCurrentView(room, state, accountId);
  const revealed = Boolean(state.current?.revealed);
  // werewolf：自己能看到自己的身份；whoami：身份贴在自己额头，自己不能看（hand 置空防 API 泄漏）
  const hand = gameId === 'werewolf' ? state.hands[accountId]?.map(card => card.label) ?? null : null;
  const myProfile = profileFor(state, accountId);
  const handFlavor = gameId === 'werewolf' && hand?.length ? werewolfFlavor(hand[0], state.theme, myProfile) : null;
  const myBucket = flavorBucketForView(myProfile);
  const others = gameId === 'whoami'
    ? state.order.filter(id => id !== accountId).map(id => ({
      accountId: id,
      displayName: room.members.find(member => member.accountId === id)?.displayName ?? '已离开玩家',
      card: state.hands[id]?.[0]?.label ?? '未知'
    }))
    : null;
  const guesses: PartyGuessView[] = state.guesses.map(guess => {
    const mine = guess.accountId === accountId;
    const masked = MASK_GUESS_GAMES.includes(gameId) && !mine && !revealed;
    return {
      accountId: guess.accountId,
      displayName: room.members.find(member => member.accountId === guess.accountId)?.displayName ?? '已离开玩家',
      text: masked ? '已提交答案' : guess.text,
      correct: masked ? null : guess.correct,
      at: new Date(guess.at).toISOString()
    };
  });
  const best = Math.max(0, ...Object.values(state.points));
  const results = state.stage === 'complete'
    ? activeMembers(room).map(member => ({ accountId: member.accountId, displayName: member.displayName, points: state.points[member.accountId] ?? 0, winner: best > 0 && (state.points[member.accountId] ?? 0) === best })).sort((a, b) => b.points - a.points)
    : null;
  const revealAll = state.stage === 'complete'
    ? Object.entries(state.hands).map(([id, cards]) => ({ accountId: id, displayName: room.members.find(member => member.accountId === id)?.displayName ?? '已离开玩家', card: cards.map(card => card.label).join(' / ') }))
    : null;
  const canGuess = gameId === 'whoami'
    ? !state.guesses.some(guess => guess.accountId === accountId)
    : Boolean(state.current) && !revealed && state.current?.owner !== accountId && !state.guesses.some(guess => guess.accountId === accountId);
  return {
    gameId,
    mode: state.mode,
    stage: state.stage,
    round: state.round,
    totalRounds: Math.max(1, Number(room.game.config?.rounds ?? 1)),
    isHost,
    isMyTurn: turnAccountId === accountId,
    turnAccountId,
    turnName,
    current,
    hand,
    others,
    guesses,
    ownGuess: state.guesses.find(guess => guess.accountId === accountId)?.text ?? null,
    points: { ...state.points },
    deckLeft: state.deck.length,
    log: state.log.slice(-20).map(entry => ({
      label: entry.private && !entry.revealed && entry.owner !== accountId ? '已抽题（内容对其他人隐藏）' : entry.label,
      detail: entry.private && !entry.revealed && entry.owner !== accountId ? null : entry.detail,
      ownerName: entry.owner ? room.members.find(member => member.accountId === entry.owner)?.displayName ?? null : null,
      at: new Date(entry.at).toISOString(),
      revealed: entry.revealed
    })),
    dice: state.dice.rolls.slice(-12).reverse().map(roll => ({
      accountId: roll.accountId,
      displayName: room.members.find(member => member.accountId === roll.accountId)?.displayName ?? '已离开玩家',
      values: roll.values,
      total: roll.total,
      at: new Date(roll.at).toISOString()
    })),
    diceConfig: { count: state.dice.count, sides: state.dice.sides },
    notes: state.notes.slice(-30).map(note => ({
      accountId: note.accountId,
      displayName: room.members.find(member => member.accountId === note.accountId)?.displayName ?? '已离开玩家',
      text: note.text,
      verdict: note.verdict,
      at: new Date(note.at).toISOString()
    })),
    limit: state.limit,
    phase: state.phase ? WEREWOLF_PHASES.find(item => item.id === state.phase)?.label ?? state.phase : null,
    canGuess,
    results,
    revealAll,
    theme: state.theme,
    flavorSource: state.flavorSource,
    myBucket,
    handFlavor
  };
}

function flavorBucketForView(profile: PartyRoleProfile | null) {
  if (!profile?.mbti) return null;
  return flavorBucket(profile.mbti);
}

function buildCurrentView(room: RoomSnapshot, state: PartyState, accountId: string): PartyCardView | null {
  const current = state.current;
  if (!current) return null;
  const gameId = room.currentGame as PartyGameId;
  const mine = current.owner === accountId;
  const hiddenFromMe = current.owner !== null && !mine && !current.revealed;
  const answerVisible = current.revealed;
  const label = hiddenFromMe ? '等待揭晓' : current.card.label;
  // flavor/kicker 由题面生成：hidden 时置空，公开牌统一用当前轮次玩家的档案，保证全场看到一致
  const flavor = hiddenFromMe
    ? { kicker: null, flavor: null, tags: [] as FlavorBucket[] }
    : cardFlavor(state, gameId, current.card, current.owner ?? state.order[state.turnIndex] ?? null);
  return {
    id: `card-${state.log.length}`,
    label,
    detail: hiddenFromMe ? null : current.card.detail ?? null,
    answer: answerVisible ? current.card.answer ?? null : null,
    revealed: current.revealed,
    mine,
    ownerName: current.owner ? room.members.find(member => member.accountId === current.owner)?.displayName ?? null : null,
    kicker: flavor.kicker,
    flavor: flavor.flavor,
    tags: flavor.tags
  };
}

export function partyPhaseHint(room: RoomSnapshot): string | null {
  const state = partyState(room);
  if (!state?.phase) return null;
  return WEREWOLF_PHASES.find(item => item.id === state.phase)?.hint ?? null;
}

export function partyRequiresReveal(gameId: GameId) { return isPartyGame(gameId) && REVEAL_GAMES.includes(gameId); }
