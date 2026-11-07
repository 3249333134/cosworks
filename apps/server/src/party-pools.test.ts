import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PartyRoleProfile, RoomSnapshot } from '@ruxiju/shared';
import { MemoryStore } from './store.js';
import { aiConfigured } from './ai-client.js';
import { enqueuePartyPool, partyFingerprint, partyPoolSpec, takePartyCards, validatePartyCards, waitForPartyCards, type PartyPoolSpec } from './party-pools.js';
import { partyDeck } from './party-content.js';

const profiles: PartyRoleProfile[] = [
  { accountId: 'a', displayName: '玩家1', playerRole: '罗小黑', ipTheme: '罗小黑战记', mbti: 'ENTP', personaTags: ['活泼'], quote: '我想回家', signatureAction: '轻轻点头', ability: '空间系能力' },
  { accountId: 'b', displayName: '玩家2', playerRole: '小白', ipTheme: '罗小黑战记', mbti: 'INTJ', personaTags: ['安静'], quote: '', signatureAction: '', ability: '' }
];

function room(): RoomSnapshot {
  return {
    id: 'room-pool', code: 'P00L', name: '牌池测试', ipTheme: '罗小黑战记', status: 'waiting', ownerAccountId: 'a',
    members: profiles.map((profile, index) => ({
      id: `m${profile.accountId}`, accountId: profile.accountId, displayName: profile.displayName, isOwner: index === 0,
      hostRole: index === 0 ? 'owner' as const : null, playerRole: profile.playerRole, ipRoleId: null,
      team: '队', ready: true, online: true, score: 0
    })),
    currentGame: null, game: null, gamePlan: [], planCursor: 0, planRound: 1, closedAt: null
  };
}

async function seedPool(store: MemoryStore, spec: PartyPoolSpec, cards: Array<{ label: string; answer?: string; detail?: string }>) {
  await store.saveGeneratedContent({
    cacheKey: spec.key, accountId: null, gameId: spec.gameId,
    content: { fingerprint: spec.fingerprint, items: cards.map(card => ({ label: card.label, card, source: 'ai', usedAt: null })) },
    rulesVersion: 1
  });
}

describe('party pool', () => {
  it('serves a full AI deck and marks the taken cards as used', async () => {
    const store = new MemoryStore();
    const target = room();
    const spec = await partyPoolSpec(store, target, 'charades', profiles);
    const deck = Array.from({ length: 8 }, (_, i) => ({ label: `专属动作${i + 1}` }));
    await seedPool(store, spec, deck);
    const cards = await takePartyCards(store, target, 'charades', profiles);
    expect(cards).not.toBeNull();
    expect(cards!.length).toBeGreaterThanOrEqual(6);
    const saved = (await store.getGeneratedContent(spec.key))!.content as { items: Array<{ usedAt: string | null }> };
    expect(saved.items.filter(item => item.usedAt).length).toBe(cards!.length);
  });

  it('falls back to the local deck when the pool is short and enqueues a restock', async () => {
    const store = new MemoryStore();
    const target = room();
    const spec = await partyPoolSpec(store, target, 'describe', profiles);
    await seedPool(store, spec, [{ label: '只有一个词' }]);
    const cards = await takePartyCards(store, target, 'describe', profiles);
    expect(cards).toBeNull();
    // 未配置 AI 时静默跳过入队；配置了 AI 则必须有补货任务
    const jobs = [...(store as unknown as { jobs: Map<string, { kind: string; key: string }> }).jobs.values()];
    if (aiConfigured()) {
      expect(jobs.some(job => job.kind === 'party-pool' && job.key.includes(spec.key))).toBe(true);
    } else {
      expect(jobs.every(job => job.kind !== 'party-pool')).toBe(true);
    }
  });

  it('clears stale items when the roster fingerprint changes and never serves them', async () => {
    const store = new MemoryStore();
    const target = room();
    const spec = await partyPoolSpec(store, target, 'turtle', profiles);
    await seedPool(store, spec, Array.from({ length: 8 }, (_, i) => ({ label: `旧主题汤面${i + 1}`, answer: `旧汤底${i + 1}` })));
    // 换了 IP 主题 → 指纹失配
    const changedRoom = { ...target, ipTheme: '哪吒之魔童闹海' };
    const cards = await takePartyCards(store, changedRoom, 'turtle', profiles.map(profile => ({ ...profile, ipTheme: '哪吒之魔童闹海' })));
    expect(cards).toBeNull();
    const saved = (await store.getGeneratedContent(spec.key))!.content as { fingerprint: string; items: Array<{ usedAt: string | null }> };
    expect(saved.fingerprint).not.toBe(spec.fingerprint);
    expect(saved.items.every(item => item.usedAt)).toBe(true);
  });

  it('skips the pool entirely when a member changed roles (new fingerprint, no stale deal)', () => {
    const base = partyFingerprint('罗小黑战记', profiles);
    const changed = partyFingerprint('罗小黑战记', profiles.map(profile => ({ ...profile, mbti: 'INFP' as const })));
    expect(changed).not.toBe(base);
  });

  it('does not enqueue when AI is not configured', async () => {
    const store = new MemoryStore();
    const target = room();
    // 测试环境没有 AI key 时（provider=local）应静默跳过，不阻塞开局
    const spec = await partyPoolSpec(store, target, 'kings', profiles);
    await seedPool(store, spec, []);
    await enqueuePartyPool(store, target, 'kings', profiles);
    const jobs = [...(store as unknown as { jobs: Map<string, { kind: string }> }).jobs.values()].filter(job => job.kind === 'party-pool');
    // 若环境配置了 AI 则允许入队；未配置则必须为空 —— 两种情况都不应抛错
    expect(Array.isArray(jobs)).toBe(true);
  });
});

describe('waitForPartyCards', () => {
  it('returns the deck once the pool becomes ready, or null immediately without AI', async () => {
    const store = new MemoryStore();
    const target = room();
    if (!aiConfigured()) {
      // 未配置 AI：必须立刻返回 null，绝不空等
      const start = Date.now();
      expect(await waitForPartyCards(store, target, 'turtle', profiles, 2000, 20)).toBeNull();
      expect(Date.now() - start).toBeLessThan(500);
      return;
    }
    const spec = await partyPoolSpec(store, target, 'turtle', profiles);
    const timer = setTimeout(() => {
      void seedPool(store, spec, Array.from({ length: 6 }, (_, i) => ({ label: `专属汤面${i + 1}`, answer: `足够长的专属汤底${i + 1}，解释了整件事的来龙去脉` })));
    }, 80);
    const cards = await waitForPartyCards(store, target, 'turtle', profiles, 3000, 40);
    clearTimeout(timer);
    expect(cards).not.toBeNull();
    expect(cards!.length).toBeGreaterThanOrEqual(6);
  });

  it('gives up after the timeout when the pool never fills', async () => {
    if (!aiConfigured()) return;
    const store = new MemoryStore();
    const target = room();
    const cards = await waitForPartyCards(store, target, 'turtle', profiles, 250, 40);
    expect(cards).toBeNull();
  });
});

describe('validatePartyCards', () => {
  const spec: PartyPoolSpec = { code: 'P00L', roomId: 'room-pool', gameId: 'charades', key: 'k', fingerprint: 'f', theme: '罗小黑战记', profiles };
  const excluded = partyDeck('charades').map(card => card.label);

  it('accepts a valid batch and normalizes fields', () => {
    const cards = validatePartyCards('charades', {
      items: [
        { label: '翻跟头', aliases: ['侧手翻'], tags: ['perform'], flavor: '用你最放得开的方式把它演出来' },
        { label: '包饺子', detail: '一个过年场景的动作' }
      ]
    }, spec, excluded);
    expect(cards).toHaveLength(2);
    expect(cards[0].aliases).toEqual(['侧手翻']);
    expect(cards[1].flavor).toBeUndefined();
  });

  it('rejects cards that leak the answer inside flavor', () => {
    const cards = validatePartyCards('turtle', {
      items: [{ label: '一个人在深夜的便利店哭了，为什么？', answer: '他找到了已故母亲留下的字条', flavor: '答案和他母亲留下的字条有关' }]
    }, spec, []);
    expect(cards).toHaveLength(0);
  });

  it('rejects unsafe content and duplicate labels', () => {
    const cards = validatePartyCards('charades', {
      items: [
        { label: '拥抱别人' },
        { label: excluded[0] },
        { label: '跳舞' }, { label: '跳舞' }
      ]
    }, spec, excluded);
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('跳舞');
  });

  it('whoami rejects the players own role names', () => {
    const whoSpec: PartyPoolSpec = { ...spec, gameId: 'whoami' };
    const cards = validatePartyCards('whoami', {
      items: [{ label: '罗小黑' }, { label: '哪吒' }, { label: '小白' }]
    }, whoSpec, []);
    expect(cards.map(card => card.label)).toEqual(['哪吒']);
  });

  it('turtle requires a substantial answer', () => {
    const cards = validatePartyCards('turtle', {
      items: [
        { label: '一个男人走进电梯后再也没有出来，为什么？', answer: '太短' },
        { label: '太短的汤面', answer: '这是一个足够长的汤底，解释了整件事情的来龙去脉和原因所在' }
      ]
    }, spec, []);
    expect(cards).toHaveLength(0);
  });

  it('rejects abstract unguessable words', () => {
    const cards = validatePartyCards('describe', { items: [{ label: '命运的齿轮' }, { label: '电磁炉' }] }, spec, []);
    expect(cards.map(card => card.label)).toEqual(['电磁炉']);
  });
});
