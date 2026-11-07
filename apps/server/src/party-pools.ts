import { createHash } from 'node:crypto';
import { isFlavorBucket, normalizePartyText, partyMatches, PARTY_FLAVOR_VERSION, type FlavorBucket, type PartyRoleProfile, type RoomSnapshot } from '@ruxiju/shared';
import type { Store } from './store.js';
import { newJob, PermanentJobError, type BackgroundJob } from './jobs.js';
import { aiConfigured, aiJson } from './ai-client.js';
import { partyDeck, type PartyCard } from './party-content.js';

/**
 * 轻量玩法的 AI 增强牌池：独立于 legacy 池（content-pool:v1），
 * 语义是「全房共享一副主题专属牌堆」，key 为 房间×玩法。
 * 取不到或校验不过时一律回退本地题库，绝不阻塞开局。
 */
export const PARTY_POOL_GAMES = ['kings', 'turtle', 'truthdare', 'never', 'reaction', 'whoami', 'charades', 'twenty', 'describe'] as const;
export type PartyPoolGame = typeof PARTY_POOL_GAMES[number];
export function isPartyPoolGame(gameId: string): gameId is PartyPoolGame {
  return (PARTY_POOL_GAMES as readonly string[]).includes(gameId);
}

const POOL_VERSION = 1;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unsafe = /(亲吻|拥抱|脱衣|喝酒|饮酒|身体接触|隐私|密码|自残|自杀|辱骂|跳楼|购买道具)/;
const THRESHOLD = 4;
const TAKE_MIN = 6;

export interface PartyPoolSpec { code: string; roomId: string; gameId: PartyPoolGame; key: string; fingerprint: string; theme: string; profiles: PartyRoleProfile[] }
interface PartyPool { fingerprint: string; items: Array<{ label: string; card: PartyCard; source: 'ai'; usedAt: string | null }> }

const cardOf = (item: { card: PartyCard }) => item.card;
const labelKey = (card: PartyCard) => normalizePartyText(card.answer && card.answer !== card.label ? `${card.label}|${card.answer}` : card.label);

function partyPoolKey(roomId: string, gameId: PartyPoolGame) { return `content-pool:party:v${POOL_VERSION}:${roomId}:${gameId}`; }

/** 指纹：主题 + flavor 版本 + 全员档案（任何一个人改角色/MBTI 都会换新牌堆） */
export function partyFingerprint(theme: string, profiles: PartyRoleProfile[]): string {
  return hash({
    theme,
    flavorVersion: PARTY_FLAVOR_VERSION,
    deckVersion: POOL_VERSION,
    roster: profiles.map(profile => [profile.accountId, profile.playerRole, profile.ipTheme, profile.mbti, profile.personaTags, profile.quote, profile.signatureAction, profile.ability])
  });
}

export async function partyPoolSpec(store: Store, room: RoomSnapshot, gameId: PartyPoolGame, profiles: PartyRoleProfile[]): Promise<PartyPoolSpec> {
  return { code: room.code, roomId: room.id, gameId, key: partyPoolKey(room.id, gameId), fingerprint: partyFingerprint(room.ipTheme, profiles), theme: room.ipTheme, profiles };
}

async function readPool(store: Store, spec: PartyPoolSpec): Promise<PartyPool> {
  const saved = (await store.getGeneratedContent(spec.key))?.content as PartyPool | undefined;
  return saved ?? { fingerprint: spec.fingerprint, items: [] };
}

async function savePool(store: Store, spec: PartyPoolSpec, pool: PartyPool) {
  await store.saveGeneratedContent({ cacheKey: spec.key, accountId: null, gameId: spec.gameId, content: pool, rulesVersion: POOL_VERSION });
}

/** 已用过的牌面（本地静态题 + 历史生成），给 AI 做去重 */
async function exclusions(store: Store, spec: PartyPoolSpec): Promise<string[]> {
  const pool = await readPool(store, spec);
  return pool.items.map(item => item.card.label);
}

export async function enqueuePartyPool(store: Store, room: RoomSnapshot, gameId: PartyPoolGame, profiles: PartyRoleProfile[]): Promise<void> {
  if (!aiConfigured()) return;
  const spec = await partyPoolSpec(store, room, gameId, profiles);
  const pool = await readPool(store, spec);
  const remaining = pool.fingerprint === spec.fingerprint ? pool.items.filter(item => !item.usedAt).length : 0;
  if (remaining > THRESHOLD) return;
  await store.enqueueJob(newJob(`party-pool:${spec.key}:${spec.fingerprint}`, 'party-pool', { code: spec.code, gameId: spec.gameId, fingerprint: spec.fingerprint, theme: spec.theme, profiles: spec.profiles }, null));
}

/** 开局尝试取一副 AI 专属牌堆；不足/失配时返回 null（本地题库兜底）并懒补货 */
export async function takePartyCards(store: Store, room: RoomSnapshot, gameId: PartyPoolGame, profiles: PartyRoleProfile[]): Promise<PartyCard[] | null> {
  const spec = await partyPoolSpec(store, room, gameId, profiles);
  const pool = await readPool(store, spec);
  if (pool.fingerprint !== spec.fingerprint) {
    // 指纹失配（换主题/换角色/换人）：清掉未用项，立即回退本地，后台补新堆
    pool.items = pool.items.filter(item => item.usedAt);
    pool.fingerprint = spec.fingerprint;
    await savePool(store, spec, pool);
    void enqueuePartyPool(store, room, gameId, profiles).catch(() => {});
    return null;
  }
  const fresh = pool.items.filter(item => !item.usedAt);
  if (fresh.length < TAKE_MIN) {
    void enqueuePartyPool(store, room, gameId, profiles).catch(() => {});
    return null;
  }
  const taken = fresh.slice(0, Math.max(TAKE_MIN, Math.min(12, profiles.length * 4)));
  const takenKeys = new Set(taken.map(item => labelKey(cardOf(item))));
  for (const item of pool.items) if (takenKeys.has(labelKey(cardOf(item)))) item.usedAt = new Date().toISOString();
  await savePool(store, spec, pool);
  return taken.map(item => cardOf(item));
}

const sleepMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 开局时等待 AI 专属牌堆生成完成（首次开局预热未就绪的场景）。
 * 未配置 AI 直接返回 null；轮询期间 takePartyCards 会持续触发补货（job key 按指纹去重）。
 * 超时返回 null，由调用方回退本地题库。
 */
export async function waitForPartyCards(store: Store, room: RoomSnapshot, gameId: PartyPoolGame, profiles: PartyRoleProfile[], timeoutMs = 25000, stepMs = 600): Promise<PartyCard[] | null> {
  if (!aiConfigured()) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cards = await takePartyCards(store, room, gameId, profiles);
    if (cards?.length) return cards;
    await sleepMs(stepMs);
  }
  return null;
}

const PROMPTS: Record<PartyPoolGame, string> = {
  kings: '生成8张聚会指令牌，label 形如「A · 指定一人」，detail 是30-60字的轻松指令。动作轻量、可观察、不需要道具，不强迫身体接触。',
  turtle: '生成8道海龟汤。汤面必须发生在这个 IP 主题的世界观或经典场景里，或者谜底与主题的角色、设定、名场面相关；同时谜底必须能被汤面信息+是/否问答推理出来，逻辑自洽，不能只套一个和主题无关的经典谜题。label 是40-90字的汤面（谜题情境），answer 是60-140字的汤底（完整解释），detail 是一句不剧透的提示。',
  truthdare: '生成8张真心话大冒险，label 以「真心话 · 」或「大冒险 · 」开头。真心话不追问隐私，大冒险不需要道具、无身体接触、30秒内可完成，可结合在场角色的说话方式或标志性动作。',
  never: '生成8句「我从来没有…」，日常小事、轻松幽默、不涉隐私羞耻，可穿插主题世界观的趣事变体。',
  reaction: '生成6个反应小游戏，label 是游戏名，detail 是40-80字规则：全场轮流、出错受轻罚、不用道具。',
  whoami: '生成10个适合「头上贴牌猜身份」的知名角色名，2-6字。要和在场角色的 IP 世界相关或大众熟知，不能是在场玩家自己的角色名。',
  charades: '生成10个你演我猜的表演词，2-4字的具体动作或日常活动（如「打喷嚏」）。不考抽象概念，aliases 是确切的同义说法。',
  twenty: '生成10个秘密词二十问的谜底名词，2-4字具体事物（动物、物品、食物均可），不要太冷门。',
  describe: '生成10个你说我猜的描述词，2-4字具体名词（物品、职业、场景），aliases 是确切同义词，不依赖品牌名。'
};

/** 逐张校验 AI 牌：长度、安全、flavor 不泄漏 answer、答案可判定、去重。全部通过才收，否则整批拒绝 */
export function validatePartyCards(gameId: PartyPoolGame, raw: unknown, spec: PartyPoolSpec, excluded: string[]): PartyCard[] {
  const values = (raw as { items?: unknown[] })?.items;
  if (!Array.isArray(values)) throw new PermanentJobError('AI 牌堆格式不正确');
  const seen = new Set(excluded.map(label => normalizePartyText(label)));
  const accepted: PartyCard[] = [];
  const ownRoles = new Set(spec.profiles.map(profile => normalizePartyText(profile.playerRole)));
  for (const value of values.slice(0, 12)) {
    try {
      const card = value as Partial<PartyCard>;
      if (typeof card.label !== 'string') continue;
      const label = card.label.trim();
      const maxLabel = gameId === 'turtle' ? 100 : 40;
      if (label.length < (gameId === 'turtle' ? 15 : 1) || label.length > maxLabel) continue;
      if (unsafe.test(`${label}${card.detail ?? ''}${card.answer ?? ''}${card.flavor ?? ''}`)) continue;
      const aliases = Array.isArray(card.aliases) ? card.aliases.filter(a => typeof a === 'string' && a.length > 0 && a.length <= 12 && !unsafe.test(a)).slice(0, 4) : [];
      const answer = typeof card.answer === 'string' && card.answer.trim() && card.answer.trim() !== label ? card.answer.trim() : undefined;
      if (gameId === 'turtle' && (!answer || answer.length < 20)) continue;
      if (gameId === 'whoami') {
        if (label.length > 12) continue;
        if (ownRoles.has(normalizePartyText(label))) continue;
      }
      const tags = Array.isArray(card.tags) && isFlavorBucket(card.tags[0]) ? [card.tags[0] as FlavorBucket] : undefined;
      const flavor = typeof card.flavor === 'string' && card.flavor.length <= 80 ? card.flavor.trim() : undefined;
      // flavor 只许说题面（label），绝不允许剧透 answer
      if (flavor && answer && normalizePartyText(flavor).includes(normalizePartyText(answer))) continue;
      // 答案可判定：answer 或 label 必须能被同一套匹配规则命中一个等价表述
      const matchable = answer ?? label;
      if (!partyMatches({ label, answer, aliases }, matchable)) continue;
      const key = normalizePartyText(answer && answer !== label ? `${label}|${answer}` : label);
      if (!key || seen.has(key)) continue;
      if (gameId !== 'turtle' && gameLabelTooGeneric(gameId, label)) continue;
      seen.add(key);
      accepted.push({ label, detail: typeof card.detail === 'string' && card.detail.length <= 120 ? card.detail.trim() : undefined, answer, aliases, tags, flavor, kicker: typeof card.kicker === 'string' && card.kicker.length <= 24 ? card.kicker.trim() : undefined });
    } catch { /* 单张不合法只丢弃该张 */ }
  }
  return accepted;
}

/** 过于抽象、猜不出来的词直接拒 */
function gameLabelTooGeneric(gameId: PartyPoolGame, label: string): boolean {
  if (gameId === 'whoami' || gameId === 'turtle' || gameId === 'kings') return false;
  return /勇气|命运|友情|灵魂|剧情|梦想/.test(label);
}

export async function generatePartyPoolCommit(store: Store, job: BackgroundJob): Promise<(tx: Store) => Promise<void>> {
  const { code, gameId, fingerprint, theme } = job.payload as { code: string; gameId: PartyPoolGame; fingerprint: string; theme: string };
  const profiles = (job.payload.profiles ?? []) as PartyRoleProfile[];
  const room = await store.getRoom(code);
  if (!room || room.closedAt) return async () => {};
  const spec = await partyPoolSpec(store, room, gameId, profiles);
  if (spec.fingerprint !== fingerprint) return async () => {};
  const pool = await readPool(store, spec);
  const remaining = pool.fingerprint === spec.fingerprint ? pool.items.filter(item => !item.usedAt).length : 0;
  if (remaining > THRESHOLD) return async () => {};
  const excluded = await exclusions(store, spec);
  const styleSamples = partyDeck(gameId).slice(0, 3).map(card => ({ label: card.label, detail: card.detail, answer: card.answer }));
  const roster = profiles.map(profile => ({
    role: profile.playerRole,
    persona: [profile.personaTags.join('、'), profile.quote, profile.signatureAction, profile.ability].filter(Boolean).join('；'),
    mbti: profile.mbti
  }));
  const raw = await aiJson(
    '你是线下角色聚会的出题编辑。牌面要贴合房间 IP 主题与在场玩家的角色设定和 MBTI 气质（表演型 E 偏动作展示、观察型 I 偏细节暗示、语言型 N/F 偏描述、竞速型 S/T 偏抢答）。禁止危险动作、身体接触、羞辱、隐私披露、需要道具。不能冒充原作事实，可以新创贴合主题的变体。返回 {items:[{label,detail?,answer?,aliases?,flavor?,tags?}]}，flavor 是给持牌人的一句玩法提示（50字内），tags 从 perform/observe/verbal/speed 里选一个。',
    { game: gameId, theme, count: 8, roster, styleSamples, excluded: excluded.slice(-80) },
    gameId === 'turtle' ? 6000 : 4000
  );
  let cards = validatePartyCards(gameId, raw, spec, excluded);
  if (cards.length < 4) throw new Error('生成内容未通过质量检查');
  const review = await aiJson('审核聚会牌面，只返回 {accepted:[合格项从0开始的索引]}。拒绝不能现场完成、与主题无关、逻辑不自洽、近义重复、flavor 剧透答案的内容。', { game: gameId, theme, items: cards }, 1000) as { accepted?: number[] };
  const approved = new Set(Array.isArray(review.accepted) ? review.accepted : []);
  cards = cards.filter((_, index) => approved.has(index));
  if (cards.length < 4) throw new Error('生成内容未通过质量复核');
  return async (tx: Store) => {
    const latestRoom = await tx.getRoom(code);
    if (!latestRoom || latestRoom.closedAt) return;
    const latest = await partyPoolSpec(tx, latestRoom, gameId, profiles);
    if (latest.fingerprint !== fingerprint) return;
    const saved = await readPool(tx, spec);
    if (saved.fingerprint !== fingerprint) { saved.items = saved.items.filter(item => item.usedAt); saved.fingerprint = fingerprint; }
    const used = new Set(saved.items.map(item => labelKey(cardOf(item))));
    for (const card of cards) {
      const key = labelKey(card);
      if (used.has(key)) continue;
      used.add(key);
      saved.items.push({ label: card.label, card, source: 'ai', usedAt: null });
    }
    if (saved.items.length > 60) saved.items = saved.items.slice(-60);
    await savePool(tx, spec, saved);
  };
}
