import type { FlavorBucket, Mbti } from './types.js';

/** 转出桶位类型（真正的定义在 types.ts，供视图层共用） */
export type { FlavorBucket };

/**
 * 轻量玩法的个性化风味层。
 * - 每位玩家的角色档案（playerRole/personaTags/quote/signatureAction/ability）+ MBTI + 房间 IP 主题
 * - MBTI 按四桶加权（表演/观察/语言/竞速），只重排不裁剪，牌堆集合恒不变
 * - 本地模板确定性生成（seeded），AI 增强层在此基础上叠加
 */
export const PARTY_FLAVOR_VERSION = 1;

export const FLAVOR_BUCKETS: readonly FlavorBucket[] = ['perform', 'observe', 'verbal', 'speed'];
export const FLAVOR_BUCKET_LABELS: Record<FlavorBucket, string> = {
  perform: '表演型',
  observe: '观察型',
  verbal: '语言型',
  speed: '竞速型'
};

export interface PartyRoleProfile {
  accountId: string;
  displayName: string;
  playerRole: string;
  ipTheme: string;
  mbti: Mbti | null;
  personaTags: string[];
  quote: string;
  signatureAction: string;
  ability: string;
}

export interface PartyCardDraft {
  label: string;
  detail?: string;
  answer?: string;
  aliases?: string[];
  /** 桶位标签：抽牌加权与文案变体都按它走 */
  tags?: FlavorBucket[];
  /** 已生成的风味文案（AI 或预生成），personalizeCard 可覆盖 */
  kicker?: string;
  flavor?: string;
}

/** mulberry32：小而稳的可复现随机源 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a：字符串 → 稳定种子（同 shopping-engine 范式） */
export function stableSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function isFlavorBucket(value: unknown): value is FlavorBucket {
  return value === 'perform' || value === 'observe' || value === 'verbal' || value === 'speed';
}

/**
 * MBTI → 桶位。优先级：mbti（E→perform，I→observe，N/F→verbal，其余→speed），
 * mbti 缺失时才用牌面 tags 的首个桶位提示兜底，最后落到 perform（最通用的现场形态）。
 */
export function flavorBucket(mbti: Mbti | null | undefined, hint?: unknown): FlavorBucket {
  if (mbti) {
    if (mbti.startsWith('E')) return 'perform';
    if (mbti.startsWith('I')) return 'observe';
    if (mbti.includes('N') || mbti.includes('F')) return 'verbal';
    return 'speed';
  }
  if (isFlavorBucket(hint)) return hint;
  return 'perform';
}

/** 各桶对应的 MBTI 字母；一个字母可以同时贡献多个桶（如 J 既偏观察也偏竞速） */
const BUCKET_LETTERS: Record<FlavorBucket, readonly string[]> = {
  perform: ['E', 'P', 'F'],
  observe: ['I', 'J'],
  verbal: ['N', 'F'],
  speed: ['S', 'T', 'J']
};

/** 命中字母 +0.6，上限 3.0，缺省全 1.0（缺 MBTI 时均衡抽牌，不丢人） */
export function mbtiWeights(mbti: Mbti | null | undefined): Record<FlavorBucket, number> {
  const weights: Record<FlavorBucket, number> = { perform: 1, observe: 1, verbal: 1, speed: 1 };
  if (!mbti) return weights;
  for (const bucket of FLAVOR_BUCKETS) {
    let weight = weights[bucket];
    for (const letter of BUCKET_LETTERS[bucket]) {
      if (mbti.includes(letter)) weight += 0.6;
    }
    weights[bucket] = Math.min(3, Math.round(weight * 10) / 10);
  }
  return weights;
}

/**
 * Efraimidis–Spirakis 加权洗牌：key = ln(u)/w，只重排不裁剪，牌数与集合恒不变。
 * rand 用 seeded 随机源保证同一批人在同一场里抽牌顺序稳定可复现。
 */
export function weightedShuffle<T>(items: readonly T[], weights: (item: T) => number, rand: () => number): T[] {
  return items
    .map(item => {
      const w = Math.max(0.05, weights(item));
      const u = Math.max(rand(), 1e-12);
      return { item, key: Math.log(u) / w };
    })
    .sort((a, b) => b.key - a.key)
    .map(entry => entry.item);
}

/** 确定性覆盖修复：尽量让前 coverage 张牌覆盖全部桶位（没有对应桶位的牌堆自然跳过） */
export function ensureBucketCoverage<T>(ordered: readonly T[], bucketOf: (item: T) => FlavorBucket | null, coverage = FLAVOR_BUCKETS.length): T[] {
  const result = ordered.slice();
  const covered = new Set<FlavorBucket>();
  const limit = Math.min(coverage, result.length);
  for (let slot = 0; slot < limit; slot++) {
    const current = bucketOf(result[slot]);
    if (current && !covered.has(current)) { covered.add(current); continue; }
    const swapIndex = result.findIndex((item, index) => {
      if (index <= slot) return false;
      const bucket = bucketOf(item);
      return bucket !== null && !covered.has(bucket);
    });
    if (swapIndex > slot) {
      [result[slot], result[swapIndex]] = [result[swapIndex], result[slot]];
      const bucket = bucketOf(result[slot]);
      if (bucket) covered.add(bucket);
    } else if (current) {
      covered.add(current);
    }
  }
  return result;
}

function clip(value: string, max: number): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, Math.max(1, max - 1))}…` : v;
}

const BUCKET_TEMPLATES: Record<FlavorBucket, readonly string[]> = {
  perform: [
    '放开演：用最夸张的方式把「{label}」表现出来，让大家一眼看懂',
    '全场戏份给你：把「{label}」演出来{action}',
    '你是主角：用大动作加表情演绎「{label}」，越有感染力越好'
  ],
  observe: [
    '安静牌：只用一个小动作暗示「{label}」，别出声',
    '细节局：不动声色地暗示「{label}」，看谁观察得最细',
    '低调发挥：用细微的小习惯带出「{label}」，懂的人自然懂'
  ],
  verbal: [
    '嘴上功夫：用你自己的口吻描述「{label}」，但不能直接说出它',
    '语言局：绕着「{label}」给提示{quote}',
    '用一句话把「{label}」讲出来，但换掉关键词'
  ],
  speed: [
    '抢答局：快速给出和「{label}」相关的线索，慢一步就没了',
    '竞速提示：用最快的节奏给「{label}」递线索，考验全场反应',
    '限时牌：在十秒内让大家猜到「{label}」'
  ]
};

const ACTION_SUFFIX = (action: string) => `，顺手带出你标志性的「${action}」`;
const QUOTE_SUFFIX = (quote: string) => `，想想「${quote}」的语感`;

function fillTemplate(template: string, label: string, action: string, quote: string): string {
  let filled = template.replace('{label}', label);
  if (filled.includes('{action}')) filled = filled.replace('{action}', action ? ACTION_SUFFIX(action) : '');
  if (filled.includes('{quote}')) filled = filled.replace('{quote}', quote ? QUOTE_SUFFIX(quote) : '');
  return filled;
}

export interface PersonalizedFlavor { kicker: string; flavor: string; bucket: FlavorBucket }

/**
 * 按「持有者的桶位 + 角色档案」为一张牌生成 kicker/flavor。
 * 只使用 label（题面），绝不使用 answer——flavor 不允许泄漏答案。
 * source：'ai' 表示牌面内容是按本 IP 生成的专属题；'local' 表示本地静态兜底题库，
 * 此时 kicker 不得声称「专属」（内容并非 IP 定制）。
 */
export function personalizeCard(draft: PartyCardDraft, profile: PartyRoleProfile, theme: string, seedValue: string, source: 'ai' | 'local' = 'ai'): PersonalizedFlavor {
  const bucket = flavorBucket(profile.mbti, draft.tags?.[0]);
  const rand = mulberry32(stableSeed(`${seedValue}|${profile.accountId}|${draft.label}|${PARTY_FLAVOR_VERSION}`));
  const templates = BUCKET_TEMPLATES[bucket];
  const action = clip(profile.signatureAction, 14);
  const quote = clip(profile.quote, 18);
  let index = Math.floor(rand() * templates.length);
  if (action && bucket === 'perform') index = 1; // 有标志性动作时优先带动作的变体
  if (quote && bucket === 'verbal') index = 1;
  const flavor = fillTemplate(templates[index], draft.label, action, quote);
  const role = clip(profile.playerRole || profile.displayName, 12);
  const themeLabel = clip(theme, 10);
  const kicker = source === 'ai'
    ? (profile.playerRole ? `《${themeLabel}》· ${role}专属` : '专属牌面')
    : (themeLabel ? `《${themeLabel}》· 经典题库` : '经典题库');
  return { kicker, flavor, bucket };
}

/**
 * 我是谁的名单构建：在场 playerRole 去重 → 静态兜底表（排除重复）→ 主题神秘角色补齐。
 */
export function buildThemeWhoamiPool(theme: string, playerRoles: readonly string[], fallbackPool: readonly string[], playerCount: number): string[] {
  const count = Math.max(2, playerCount);
  const themeRoles = [...new Set(playerRoles.map(role => role.trim()).filter(Boolean))];
  const seen = new Set(themeRoles);
  const base = fallbackPool.filter(name => !seen.has(name));
  const extras: string[] = [];
  let serial = 0;
  while (themeRoles.length + base.length + extras.length < count) extras.push(`《${theme || '本场'}》的神秘角色${++serial}`);
  return [...themeRoles, ...base, ...extras].slice(0, count);
}

/** 身份分配：抽到的身份若等于本人 playerRole，则与后面一个不冲突的人交换 */
export function assignIdentitiesAvoidSelf(pool: readonly string[], ownRoles: readonly (string | null)[]): string[] {
  const result = pool.slice(0, ownRoles.length);
  for (let i = 0; i < result.length; i++) {
    const own = (ownRoles[i] ?? '').trim();
    if (!own || result[i] !== own) continue;
    for (let j = 0; j < result.length; j++) {
      if (j === i) continue;
      const ownJ = (ownRoles[j] ?? '').trim();
      if (result[j] !== own && (!ownJ || ownJ !== result[i])) {
        [result[i], result[j]] = [result[j], result[i]];
        break;
      }
    }
  }
  return result;
}
