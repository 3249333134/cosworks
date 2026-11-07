import { describe, expect, it } from 'vitest';
import { MBTI_TYPES, type Mbti } from './types.js';
import {
  assignIdentitiesAvoidSelf, buildThemeWhoamiPool, ensureBucketCoverage, flavorBucket,
  mbtiWeights, mulberry32, personalizeCard, stableSeed, weightedShuffle,
  PARTY_FLAVOR_VERSION, FLAVOR_BUCKETS, type FlavorBucket, type PartyCardDraft, type PartyRoleProfile
} from './party-flavor.js';

const profile: PartyRoleProfile = {
  accountId: 'a1', displayName: '小明', playerRole: '罗小黑', ipTheme: '罗小黑战记',
  mbti: 'INFP', personaTags: ['灵活', '好奇'], quote: '我想回家', signatureAction: '轻轻点头', ability: '空间系能力'
};

describe('stableSeed / mulberry32 determinism', () => {
  it('same string → same seed', () => {
    expect(stableSeed('罗小黑|quiz|1')).toBe(stableSeed('罗小黑|quiz|1'));
    expect(stableSeed('a')).not.toBe(stableSeed('b'));
  });
  it('same seed → same sequence', () => {
    const a = mulberry32(42); const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe('flavorBucket mapping across 16 MBTI types', () => {
  it('deterministic and complete', () => {
    const map: Record<Mbti, FlavorBucket> = Object.fromEntries(
      MBTI_TYPES.map(m => [m, flavorBucket(m)])
    ) as Record<Mbti, FlavorBucket>;
    expect(map.INTJ).toBe('observe');
    expect(map.ENTP).toBe('perform');
    expect(map.INFP).toBe('observe');
    expect(map.ESFP).toBe('perform');
    expect(map.ISTJ).toBe('observe');
    expect(map.ESTJ).toBe('perform');
    expect(Object.keys(map)).toHaveLength(16);
  });
  it('null mbti falls back to hint then perform', () => {
    expect(flavorBucket(null)).toBe('perform');
    expect(flavorBucket(null, 'verbal')).toBe('verbal');
    expect(flavorBucket(null, 'bogus')).toBe('perform');
  });
});

describe('mbtiWeights', () => {
  it('all 1.0 without mbti', () => {
    expect(mbtiWeights(null)).toEqual({ perform: 1, observe: 1, verbal: 1, speed: 1 });
  });
  it('E-heavy type boosts perform, capped at 3.0', () => {
    const w = mbtiWeights('ESFP');
    expect(w.perform).toBe(2.8); // E + P + F → 1 + 0.6*3
    expect(w.verbal).toBe(1.6); // F
    expect(w.speed).toBe(1.6); // S
    expect(w.observe).toBe(1);
  });
  it('I-heavy type boosts observe', () => {
    const w = mbtiWeights('INTJ');
    expect(w.observe).toBe(2.2); // I + J
    expect(w.speed).toBe(2.2); // T + J
    expect(w.perform).toBe(1);
  });
});

describe('weightedShuffle', () => {
  const items = FLAVOR_BUCKETS.flatMap(b => [`${b}-1`, `${b}-2`]);
  it('preserves the exact item set (reorder only, no pruning)', () => {
    const rand = mulberry32(7);
    const shuffled = weightedShuffle(items, item => mbtiWeights('ENTP')[item.split('-')[0] as FlavorBucket], rand);
    expect([...shuffled].sort()).toEqual([...items].sort());
    expect(shuffled).toHaveLength(items.length);
  });
  it('deterministic for the same seed', () => {
    const w = () => 2;
    expect(weightedShuffle(items, w, mulberry32(99))).toEqual(weightedShuffle(items, w, mulberry32(99)));
  });
  it('heavier weight tends to appear earlier', () => {
    const heavy = weightedShuffle(['low', 'low', 'low', 'low', 'high'], x => x === 'high' ? 10 : 0.1, mulberry32(3));
    expect(heavy.indexOf('high')).toBeLessThan(2);
  });
});

describe('ensureBucketCoverage', () => {
  const tagOf = (v: string) => (v.startsWith('p') ? 'perform' : v.startsWith('o') ? 'observe' : v.startsWith('v') ? 'verbal' : v.startsWith('s') ? 'speed' : null) as FlavorBucket | null;
  it('front of the deck covers all buckets when supply exists', () => {
    const deck = ['p1', 'p2', 'o1', 'v1', 's1', 'p3'];
    const fixed = ensureBucketCoverage(deck, tagOf);
    const front = fixed.slice(0, 4).map(tagOf);
    expect(new Set(front)).toEqual(new Set(FLAVOR_BUCKETS));
    expect([...fixed].sort()).toEqual([...deck].sort());
  });
  it('degrades gracefully with fewer buckets', () => {
    const deck = ['p1', 'p2', 'p3'];
    expect(ensureBucketCoverage(deck, tagOf)).toHaveLength(3);
  });
});

describe('personalizeCard', () => {
  const draft: PartyCardDraft = { label: '奶茶', answer: '珍珠奶茶', aliases: ['波霸'], tags: ['perform'] };
  it('flavor never leaks the answer', () => {
    for (const mbti of MBTI_TYPES) {
      const { flavor, kicker } = personalizeCard(draft, { ...profile, mbti }, '罗小黑战记', 'seed');
      expect(flavor).not.toContain('珍珠奶茶');
      expect(flavor).not.toContain('波霸');
      expect(flavor).toContain('奶茶');
      expect(kicker.length).toBeGreaterThan(0);
    }
  });
  it('I and E players get different flavor for the same card', () => {
    const quiet = personalizeCard(draft, { ...profile, mbti: 'INTJ' }, '罗小黑战记', 'seed');
    const loud = personalizeCard(draft, { ...profile, mbti: 'ENTP' }, '罗小黑战记', 'seed');
    expect(quiet.bucket).toBe('observe');
    expect(loud.bucket).toBe('perform');
    expect(quiet.flavor).not.toBe(loud.flavor);
  });
  it('deterministic for the same inputs', () => {
    expect(personalizeCard(draft, profile, '罗小黑战记', 's1')).toEqual(personalizeCard(draft, profile, '罗小黑战记', 's1'));
  });
  it('tolerates empty role fields', () => {
    const bare: PartyRoleProfile = { accountId: 'x', displayName: '路人', playerRole: '', ipTheme: '', mbti: null, personaTags: [], quote: '', signatureAction: '', ability: '' };
    const { flavor, kicker } = personalizeCard(draft, bare, '', 's');
    expect(flavor.length).toBeGreaterThan(4);
    expect(kicker).toBe('专属牌面');
  });
  it('local source never claims 专属 (fallback deck is not IP-specific)', () => {
    const themed = personalizeCard(draft, profile, '罗小黑战记', 's', 'local');
    expect(themed.kicker).toBe('《罗小黑战记》· 经典题库');
    expect(themed.kicker).not.toContain('专属');
    const bare = personalizeCard(draft, { ...profile, playerRole: '', displayName: '路人' }, '', 's', 'local');
    expect(bare.kicker).toBe('经典题库');
    const ai = personalizeCard(draft, profile, '罗小黑战记', 's');
    expect(ai.kicker).toContain('专属');
  });
  it('flavor stays within a reasonable length', () => {
    const longProfile = { ...profile, signatureAction: '这是一个特别特别特别长的标志性动作描述超过限制就会截断' };
    const { flavor } = personalizeCard(draft, longProfile, '罗小黑战记', 's');
    expect(flavor.length).toBeLessThanOrEqual(60);
  });
});

describe('whoami pool', () => {
  it('theme roles come first, deduped, then fallback fills the rest', () => {
    const pool = buildThemeWhoamiPool('罗小黑战记', ['罗小黑', '罗小黑', '小白', ''], ['罗小黑', '无限', '哪吒'], 5);
    expect(pool).toEqual(['罗小黑', '小白', '无限', '哪吒', '《罗小黑战记》的神秘角色1']);
  });
  it('pads with themed mystery roles when pool is short', () => {
    const pool = buildThemeWhoamiPool('罗小黑战记', ['罗小黑'], [], 4);
    expect(pool).toEqual(['罗小黑', '《罗小黑战记》的神秘角色1', '《罗小黑战记》的神秘角色2', '《罗小黑战记》的神秘角色3']);
  });
  it('assignIdentitiesAvoidSelf moves a self-collision away', () => {
    const assigned = assignIdentitiesAvoidSelf(['罗小黑', '小白', '无限'], ['小白', '小白', '无限']);
    expect(assigned[0]).not.toBe('小白');
    expect(assigned[1]).not.toBe('小白');
    expect(assigned[2]).not.toBe('无限');
    expect([...assigned].sort()).toEqual(['罗小黑', '小白', '无限'].sort());
  });
  it('version is exported', () => {
    expect(PARTY_FLAVOR_VERSION).toBeGreaterThan(0);
  });
});
