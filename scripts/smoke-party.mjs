const API = 'http://localhost:5000/api';
let token = '';
const log = (...a) => console.log(...a);
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

async function req(path, { method = 'GET', body } = {}, tok = token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`non-json ${res.status}: ${text.slice(0, 120)}`); }
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

async function makeUser(name) {
  const account = name + Math.random().toString(36).slice(2, 8);
  const data = await req('/auth/register', { method: 'POST', body: { account, password: 'smoketest123', displayName: name } }, '');
  const tok = data.token;
  await req('/profile/me', { method: 'PUT', body: { mbti: 'ENTP' } }, tok);
  const role = await req('/profile/me/roles', { method: 'POST', body: { ipTheme: '罗小黑战记', name: '小黑', personaTags: ['活泼'], quote: '喵', signatureAction: '甩尾', ability: '瞬移', isDefault: true } }, tok);
  return { account, accountId: data.user.accountId, token: tok, roleId: role.role.id };
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

async function main() {
  const a = await makeUser('甲');
  const b = await makeUser('乙');
  const c = await makeUser('丙');
  const d = await makeUser('丁');
  token = a.token;

  const { room } = await req('/rooms', { method: 'POST', body: { name: '玩法冒烟局', ipTheme: '罗小黑战记', durationMinutes: 60, playerCount: 4 } });
  const code = room.code;
  for (const player of [b, c, d]) {
    await req(`/rooms/${code}/join`, { method: 'POST', body: {} }, player.token);
    await req(`/rooms/${code}/role`, { method: 'PUT', body: { ipRoleId: player.roleId, ready: true } }, player.token);
  }
  await req(`/rooms/${code}/role`, { method: 'PUT', body: { ipRoleId: a.roleId, ready: true } });
  log('room', code);

  const plan = [];
  async function setPlan() {
    await req(`/rooms/${code}/host-actions`, { method: 'POST', body: { action: 'set-plan', gamePlan: plan } });
  }
  async function start(gameId) {
    plan.push({ id: `p-${plan.length}-${gameId}`, gameId, createdAt: new Date().toISOString(), rounds: 1 });
    await setPlan();
    await req(`/rooms/${code}/host-actions`, { method: 'POST', body: { action: 'start', gameId } });
  }
  async function act(player, gameId, action, payload = {}) {
    const data = await req(`/rooms/${code}/actions`, { method: 'POST', body: { actionId: uid(), gameId, action, payload } }, player.token);
    return data.room;
  }
  async function view(player = a) { const d = await req(`/rooms/${code}`, {}, player.token); return d.room; }
  const party = (r) => r?.game?.privateState?.party;

  // 1. kings 抽牌 + 下一位 + 结算
  await start('kings');
  let r = await act(a, 'kings', 'party-draw');
  if (!party(r)?.current?.label) fail('kings 未抽到牌'); else log('kings 抽到', party(r).current.label);
  r = await act(a, 'kings', 'party-next');
  if (party(r)?.round !== 1) log('kings 轮次', party(r)?.round);
  r = await act(a, 'kings', 'party-finish');
  if (party(r)?.stage !== 'complete') fail('kings 未结算'); else log('kings 结算 OK');

  // 2. dice 掷骰
  await start('dice');
  r = await act(b, 'dice', 'party-roll', { count: 3, sides: 6 });
  const roll = party(r)?.dice?.[0];
  if (!roll || roll.values.length !== 3) fail('dice 未掷出 3 颗'); else log('dice', roll.values.join('+'), '=', roll.total);
  r = await act(a, 'dice', 'party-finish');

  // 3. turtle 抽汤面 → 答案隐藏 → 揭晓
  await start('turtle');
  r = await act(a, 'turtle', 'party-draw');
  const t0 = party(r).current;
  if (t0.answer) fail('turtle 未揭晓就下发了汤底'); else log('turtle 汤面已显示，汤底隐藏 OK');
  r = await act(a, 'turtle', 'party-reveal');
  if (!party(r).current.answer) fail('turtle 揭晓后没有汤底'); else log('turtle 汤底揭晓 OK');

  // 4. quiz 答错 → 答对
  await start('quiz');
  r = await act(a, 'quiz', 'party-draw');
  const answerHidden = !party(r).current.answer;
  r = await act(b, 'quiz', 'party-guess', { guess: '这个答案肯定不对' });
  if (!party(r)) { console.error('quiz 返回无 party 状态:', JSON.stringify(r.game).slice(0, 400)); throw new Error('quiz party 缺失'); }
  console.log('quiz guesses raw:', JSON.stringify(party(r).guesses));
  const wrong = party(r).guesses.find(g => g.accountId === b.accountId);
  const otherSees = (await view(a)).game.privateState.party.guesses.find(g => g.accountId === b.accountId);
  log('quiz 答案隐藏', answerHidden, '| 答错标记', wrong.correct, '| 他人看到', otherSees.text);

  // 5. charades 私密题目：只有当前出题人看得到
  await start('charades');
  r = await act(a, 'charades', 'party-draw');
  const views = await Promise.all([a, b, c, d].map(p => view(p)));
  const visible = views.map(v => party(v).current?.label).filter(label => label && label !== '等待揭晓');
  log('charades 可见题目人数', visible.length, '| 题目', visible[0]);
  if (visible.length !== 1) fail('charades 题目可见范围异常');

  // 6. whoami 发牌
  await start('whoami');
  r = await view(a);
  let p = party(r);
  log('whoami 我的手牌', p.hand, '| 风味来源', p.flavorSource, '| 可见他人', p.others.map(o => `${o.displayName}:${o.card}`).join(','));
  // 额头身份自己不能看：hand 必须为 null（防 API 泄漏），他人的身份照常可见
  if (p.hand !== null) fail('whoami 手牌应不下发给自己');
  if (p.others.length !== 3) fail('whoami 他人身份数量异常');

  // 7. werewolf 阶段
  await start('werewolf');
  r = await act(a, 'werewolf', 'party-phase');
  log('werewolf 阶段', party(r).phase);
  r = await act(a, 'werewolf', 'party-phase');
  log('werewolf 阶段', party(r).phase);
  r = await act(a, 'werewolf', 'party-finish');
  const reveal = party(r).revealAll;
  if (!reveal || reveal.length !== 4) fail('werewolf 结算未公开身份'); else log('werewolf 结算公开身份 OK');

  // 8. never / twenty / reaction / memory / truthdare / describe
  for (const gameId of ['never', 'twenty', 'reaction', 'memory', 'truthdare', 'describe']) {
    await start(gameId);
    r = await act(a, gameId, 'party-draw');
    if (!party(r).current) fail(`${gameId} 抽题失败`);
    r = await act(a, gameId, 'party-next');
    log(gameId, 'OK');
  }

  // 9. 原有玩法回归：不要做
  await start('dont');
  r = await view(a);
  const ownWord = r.game.privateState.challenge?.content;
  log('dont ownContent', ownWord);
  if (!ownWord) fail('原有 dont 玩法未正常发词');
  r = await act(a, 'dont', 'change-challenge');
  log('dont 换词 OK', r.game.privateState.challenge?.content);

  // 10. 原有玩法回归：两真一假
  await start('truth');
  r = await act(a, 'truth', 'truth-submit', { statements: ['一', '二', '三'], falseIndex: 1 });
  log('truth 提交 OK', party(r) === undefined ? '' : '');
  if (party(r)) fail('truth 不应有 party 状态');

  log('\n全部冒烟步骤执行完毕');
}

main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; });
