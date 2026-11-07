// 端到端冒烟：海龟汤 IP 专属链路
// A 冷启动：预热未就绪就开局 → 应短暂等待(≤15s)后回退本地题库，kicker 不得声称「专属」
// B 预热完成：set-plan 后等 AI 生成完再开局 → 首局即 IP 专属题
const API = 'http://localhost:5000/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(path, { method = 'GET', body } = {}, tok = '') {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`${path} -> HTTP ${res.status}: ${json.error || ''}`);
  return json.data;
}
const THEMED = /罗小黑|妖灵|会馆|灵溪|无限|小黑|精卫|诺亚|领域|妖精|天真|馆主|妖/;
const GENERIC = /钢琴|电梯|火柴|葬礼|海龟汤|双胞胎|讣告|沙漠/;

async function makeUser(name, role, suffix = '') {
  const account = name + Math.random().toString(36).slice(2, 8);
  const reg = await req('/auth/register', { method: 'POST', body: { account, password: 'smoketest123', displayName: name } });
  const tok = reg.token;
  await req('/profile/me', { method: 'PUT', body: { mbti: 'ENTP' } }, tok);
  const roleRes = await req('/profile/me/roles', { method: 'POST', body: { ipTheme: '罗小黑战记', name: role, personaTags: ['沉稳'], quote: '嗯', signatureAction: '抱臂', ability: '操纵金属', isDefault: true } }, tok);
  return tok;
}

async function setupRoom(hostTok, guestTok, guestRoleId) {
  const { room } = await req('/rooms', { method: 'POST', body: { name: '海龟汤IP局', ipTheme: '罗小黑战记', durationMinutes: 30, playerCount: 4 } }, hostTok);
  await req(`/rooms/${room.code}/join`, { method: 'POST', body: {} }, guestTok);
  await req(`/rooms/${room.code}/role`, { method: 'PUT', body: { ipRoleId: guestRoleId, ready: true } }, guestTok);
  await req(`/rooms/${room.code}/host-actions`, { method: 'POST', body: { action: 'set-plan', gamePlan: [{ id: 't1', gameId: 'turtle', createdAt: new Date().toISOString(), rounds: 1 }] } }, hostTok);
  return room.code;
}

async function startAndDraw(hostTok, code) {
  const t0 = Date.now();
  await req(`/rooms/${code}/host-actions`, { method: 'POST', body: { action: 'start', gameId: 'turtle' } }, hostTok);
  const startSec = ((Date.now() - t0) / 1000).toFixed(1);
  await req(`/rooms/${code}/actions`, { method: 'POST', body: { actionId: "smoke-draw-" + String(Date.now()), gameId: "turtle", action: "party-draw", payload: {} } }, hostTok);
  const d = await req(`/rooms/${code}`, {}, hostTok);
  const party = d.room.game.privateState.party;
  const card = party.current?.card ?? {};
  return { startSec, flavorSource: party.flavorSource, label: card.label ?? '(无)', kicker: card.kicker ?? '(无)' };
}

const hostA = await makeUser('汤主A', '无限');
const guestReg = await req('/auth/register', { method: 'POST', body: { account: 'guest' + Math.random().toString(36).slice(2, 8), password: 'smoketest123', displayName: '汤客' } });
await req('/profile/me', { method: 'PUT', body: { mbti: 'INTJ' } }, guestReg.token);
const guestRole = await req('/profile/me/roles', { method: 'POST', body: { ipTheme: '罗小黑战记', name: '小黑', personaTags: ['活泼'], quote: '喵', signatureAction: '甩尾', ability: '瞬移', isDefault: true } }, guestReg.token);
const guestTok = guestReg.token, guestRoleId = guestRole.role.id;

console.log('== A 冷启动 ==');
const codeA = await setupRoom(hostA, guestTok, guestRoleId);
const a = await startAndDraw(hostA, codeA);
console.log(`start=${a.startSec}s flavorSource=${a.flavorSource}`);
console.log('label:', a.label.slice(0, 60));
console.log('kicker:', a.kicker);
if (a.flavorSource === 'local') {
  const ok = !a.kicker.includes('专属');
  console.log(ok ? 'PASS 回退题 kicker 未谎称专属' : 'FAIL 回退题仍声称专属');
} else {
  console.log('NOTE 冷启动直接拿到 AI 牌（预热比预期快）:', THEMED.test(a.label) ? 'IP 专属 PASS' : 'GENERIC 需检查');
}

console.log('== B 预热完成后再开局 ==');
const hostB = await makeUser('汤主B', '池年');
const codeB = await setupRoom(hostB, guestTok, guestRoleId);
console.log('等待 90s 让 AI 生成专属牌池…');
await sleep(90000);
const b = await startAndDraw(hostB, codeB);
console.log(`start=${b.startSec}s flavorSource=${b.flavorSource}`);
console.log('label:', b.label.slice(0, 80));
console.log('kicker:', b.kicker);
if (b.flavorSource === 'ai') {
  console.log(THEMED.test(b.label) ? 'PASS 首局即 IP 专属题' : 'WARN AI 牌但题面未见 IP 关键词，人工确认');
} else {
  console.log('FAIL 预热后仍回退本地（AI 生成可能失败/过慢），需查后台 job');
}
