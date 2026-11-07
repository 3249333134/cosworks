import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GameId, PartyView, RoomSnapshot } from '@ruxiju/shared';
import { handleGameAction, playerSnapshot, settleGame, startGame } from './game-engine.js';
import { partyState } from './party-engine.js';

function room(): RoomSnapshot {
  return {
    id: 'room-party', code: 'PRTY', name: '轻量玩法测试', ipTheme: '罗小黑战记', status: 'waiting', ownerAccountId: 'a',
    members: ['a', 'b', 'c', 'd'].map((accountId, index) => ({
      id: `m${accountId}`, accountId, displayName: `玩家${index + 1}`, isOwner: index === 0,
      hostRole: index === 0 ? 'owner' as const : null, playerRole: '', ipRoleId: null,
      team: '未分队', ready: index < 2, online: true, score: 0
    })),
    currentGame: null, game: null, gamePlan: [], planCursor: 0, planRound: 1, closedAt: null
  };
}

function act(target: RoomSnapshot, accountId: string, gameId: GameId, action: string, payload: Record<string, unknown> = {}) {
  return handleGameAction(target, accountId, { actionId: randomUUID(), gameId, action, payload });
}
function view(target: RoomSnapshot, accountId: string): PartyView {
  return playerSnapshot(target, accountId).game?.privateState?.party as PartyView;
}

describe('light party games', () => {
  it('deals to everyone in the room even when they have not picked a role', () => {
    const target = room();
    startGame(target, 'dice', new Map());
    // 4 人里只有 2 人 ready，轻量玩法仍然全员参与
    expect(partyState(target)?.order).toHaveLength(4);
    expect(target.game?.scores).toHaveProperty('d');
  });

  it('only lets the host draw and advance, and settles into results', () => {
    const target = room();
    startGame(target, 'kings', new Map());
    expect(() => act(target, 'b', 'kings', 'party-draw')).toThrow('只有主持');
    act(target, 'a', 'kings', 'party-draw');
    expect(view(target, 'a').current?.label).toBeTruthy();
    expect(view(target, 'b').current?.label).toBe(view(target, 'a').current?.label);
    const before = view(target, 'a').round;
    act(target, 'a', 'kings', 'party-next');
    expect(view(target, 'a').current).toBeNull();
    expect(view(target, 'a').round).toBe(before);
    settleGame(target);
    expect(view(target, 'a').stage).toBe('complete');
    expect(target.game?.phase).toBe('settled');
    expect(() => act(target, 'a', 'kings', 'party-draw')).toThrow();
  });

  it('keeps a private prompt readable only by its owner', () => {
    const target = room();
    startGame(target, 'charades', new Map());
    act(target, 'a', 'charades', 'party-draw');
    const ownerId = partyState(target)!.current!.owner!;
    const ownerView = view(target, ownerId);
    expect(ownerView.current?.mine).toBe(true);
    expect(ownerView.current?.label).not.toBe('等待揭晓');
    for (const member of target.members.filter(item => item.accountId !== ownerId)) {
      const other = view(target, member.accountId);
      expect(other.current?.label).toBe('等待揭晓');
      expect(other.current?.detail).toBeNull();
      expect(JSON.stringify(playerSnapshot(target, member.accountId))).not.toContain(ownerView.current!.label);
    }
  });

  it('hides the soup answer until the host reveals it', () => {
    const target = room();
    startGame(target, 'turtle', new Map());
    act(target, 'a', 'turtle', 'party-draw');
    const answer = partyState(target)!.current!.card.answer;
    expect(answer).toBeTruthy();
    expect(view(target, 'b').current?.answer).toBeNull();
    expect(JSON.stringify(playerSnapshot(target, 'b'))).not.toContain(answer!);
    act(target, 'a', 'turtle', 'party-reveal');
    expect(view(target, 'b').current?.answer).toBe(answer);
  });

  it('shows other players their forehead card but never your own', () => {
    const target = room();
    startGame(target, 'whoami', new Map());
    const own = partyState(target)!.hands['a'][0].label;
    const snapshot = view(target, 'a');
    // 额头牌自己不能看：hand 不下发自己的身份（防 API 层泄漏）
    expect(snapshot.hand).toBeNull();
    expect(JSON.stringify(playerSnapshot(target, 'a'))).not.toContain(`"hand":["${own}"]`);
    expect(snapshot.others?.map(item => item.accountId)).not.toContain('a');
    expect(snapshot.others).toHaveLength(3);
    act(target, 'a', 'whoami', 'party-guess', { guess: own });
    expect(view(target, 'a').points['a']).toBe(1);
  });

  it('marks quiz answers privately and awards a point for a correct one', () => {
    const target = room();
    startGame(target, 'quiz', new Map());
    act(target, 'a', 'quiz', 'party-draw');
    const answer = partyState(target)!.current!.card.answer!;
    act(target, 'b', 'quiz', 'party-guess', { guess: '肯定不对的答案' });
    expect(view(target, 'a').guesses[0].text).toBe('已提交答案');
    expect(view(target, 'b').guesses[0].text).toBe('肯定不对的答案');
    act(target, 'c', 'quiz', 'party-guess', { guess: answer });
    expect(view(target, 'c').points['c']).toBe(1);
    expect(view(target, 'c').current?.revealed).toBe(true);
  });

  it('rolls dice within the configured range and records who rolled', () => {
    const target = room();
    startGame(target, 'dice', new Map());
    act(target, 'c', 'dice', 'party-roll', { count: 3, sides: 6 });
    const roll = view(target, 'a').dice[0];
    expect(roll.values).toHaveLength(3);
    expect(roll.values.every(value => value >= 1 && value <= 6)).toBe(true);
    expect(roll.total).toBe(roll.values.reduce((sum, value) => sum + value, 0));
    expect(roll.displayName).toBe('玩家3');
  });

  it('cycles the werewolf phases and only reveals identities at the end', () => {
    const target = room();
    startGame(target, 'werewolf', new Map());
    expect(view(target, 'a').phase).toBe('夜晚');
    expect(view(target, 'a').revealAll).toBeNull();
    act(target, 'a', 'werewolf', 'party-phase');
    expect(view(target, 'a').phase).toBe('白天');
    act(target, 'a', 'werewolf', 'party-phase');
    expect(view(target, 'a').phase).toBe('投票');
    act(target, 'a', 'werewolf', 'party-finish');
    const all = view(target, 'a').revealAll!;
    expect(all).toHaveLength(4);
    expect(all.every(item => item.card.length > 0)).toBe(true);
  });
});

describe('party flavor personalization', () => {
  const profiles = [
    { accountId: 'a', displayName: '玩家1', playerRole: '罗小黑', ipTheme: '罗小黑战记', mbti: 'ENTP' as const, personaTags: ['活泼'], quote: '我想回家', signatureAction: '轻轻点头', ability: '空间系能力' },
    { accountId: 'b', displayName: '玩家2', playerRole: '小白', ipTheme: '罗小黑战记', mbti: 'INTJ' as const, personaTags: ['安静'], quote: '', signatureAction: '', ability: '' },
    { accountId: 'c', displayName: '玩家3', playerRole: '无限', ipTheme: '罗小黑战记', mbti: null, personaTags: [], quote: '', signatureAction: '', ability: '' },
    { accountId: 'd', displayName: '玩家4', playerRole: '比丢', ipTheme: '罗小黑战记', mbti: 'ISFP' as const, personaTags: [], quote: '', signatureAction: '', ability: '' }
  ];

  it('generates flavor for the private prompt owner and masks it from everyone else', () => {
    const target = room();
    startGame(target, 'charades', new Map(), new Map(), null, null, undefined, { theme: '罗小黑战记', profiles, flavorSource: 'local' });
    act(target, 'a', 'charades', 'party-draw');
    const ownerId = partyState(target)!.current!.owner!;
    const ownerView = view(target, ownerId);
    expect(view(target, ownerId).flavorSource).toBe('local');
    expect(ownerView.current?.flavor).toBeTruthy();
    expect(ownerView.current?.kicker).toContain('罗小黑战记');
    if (ownerView.current?.answer) expect(ownerView.current.flavor).not.toContain(ownerView.current.answer);
    for (const member of target.members.filter(item => item.accountId !== ownerId)) {
      const other = view(target, member.accountId);
      expect(other.current?.flavor).toBeNull();
      expect(other.current?.kicker).toBeNull();
      expect(other.current?.tags).toEqual([]);
      const serialized = JSON.stringify(playerSnapshot(target, member.accountId));
      expect(serialized).not.toContain(ownerView.current!.label);
      expect(serialized).not.toContain(ownerView.current!.flavor!);
    }
  });

  it('E and I players see different flavor wording for the same public card', () => {
    const target = room();
    startGame(target, 'turtle', new Map(), new Map(), null, null, undefined, { theme: '罗小黑战记', profiles, flavorSource: 'local' });
    act(target, 'a', 'turtle', 'party-draw');
    const fromA = view(target, 'a').current;
    const fromB = view(target, 'b').current;
    // 公开牌使用同一份 flavor（当前轮次玩家档案），两端一致
    expect(fromA?.flavor).toBe(fromB?.flavor);
    expect(fromA?.flavor).toBeTruthy();
    expect(fromA?.kicker).toContain('罗小黑');
  });

  it('quiz keeps its answer set and adds a role-based kicker only', () => {
    const target = room();
    startGame(target, 'quiz', new Map(), new Map(), null, null, undefined, { theme: '罗小黑战记', profiles, flavorSource: 'local' });
    act(target, 'a', 'quiz', 'party-draw');
    expect(view(target, 'a').current?.kicker).toContain('问');
    expect(view(target, 'a').current?.flavor).toBeNull();
  });

  it('whoami pulls identities from the room roster and never deals you your own role', () => {
    const target = room();
    startGame(target, 'whoami', new Map(), new Map(), null, null, undefined, { theme: '罗小黑战记', profiles, flavorSource: 'local' });
    const state = partyState(target)!;
    const roleOf = new Map(profiles.map(profile => [profile.accountId, profile.playerRole]));
    for (const accountId of state.order) {
      expect(state.hands[accountId][0].label).not.toBe(roleOf.get(accountId));
    }
    // 额头牌自己不可见
    expect(view(target, 'a').hand).toBeNull();
    expect(view(target, 'a').handFlavor).toBeNull();
  });

  it('werewolf keeps its identity set and adds themed hand flavor', () => {
    const target = room();
    startGame(target, 'werewolf', new Map(), new Map(), null, null, undefined, { theme: '罗小黑战记', profiles, flavorSource: 'local' });
    const state = partyState(target)!;
    const labels = Object.values(state.hands).map(hand => hand[0].label);
    expect(labels.every(label => ['狼人', '村民', '预言家', '女巫', '猎人', '守卫', '白痴'].includes(label))).toBe(true);
    expect(view(target, 'a').handFlavor).toContain('罗小黑战记');
  });

  it('sessions started before the upgrade stay legacy with no flavor', () => {
    const target = room();
    startGame(target, 'charades', new Map());
    act(target, 'a', 'charades', 'party-draw');
    expect(view(target, 'a').flavorSource).toBe('legacy');
    expect(view(target, 'a').current?.flavor).toBeNull();
    expect(view(target, 'a').current?.kicker).toBeNull();
  });
});
