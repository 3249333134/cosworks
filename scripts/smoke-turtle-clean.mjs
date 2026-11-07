// 干净环境单场景验证：建房 → 编排海龟汤 → 等 AI 预热 → 开局 → 抽题 → 检查题面/kicker
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
const THEMED = /罗小黑|妖灵|会馆|灵溪|无限|小黑|精卫|诺亚|领域|妖精|天真|馆主|尾巴|喵|金属/;

async function makeUser(name, role) {
  const account = name + Math.random().toString(36).slice(2, 8);
  const reg = await req('/auth/register', { method: 'POST', body: { account, password: 'smoketest123', displayName: name } });
  const tok = reg.token;
  await req('/profile/me', { method: 'PUT', body: { mbti: 'ENTP' } }, tok);
  const roleRes = await req('/profile/me/roles', { method: 'POST', body: { ipTheme: '罗小黑战记', name: role, personaTags: ['沉稳'], quote: '嗯', signatureAction: '抱臂', ability: '操纵金属', isDefault: true } }, tok);
  return { tok, roleId: roleRes.role.id };
}

const host = await makeUser('验证主', '无限');
const guest = await makeUser('验证客', '小黑');
const { room } = await req('/rooms', { method: 'POST', body: { name: '干净B场景', ipTheme: '罗小黑战记', durationMinutes: 30, playerCount: 4 } }, host.tok);
await req(`/rooms/${room.code}/join`, { method: 'POST', body: {} }, guest.tok);
await req(`/rooms/${room.code}/role`, { method: 'PUT', body: { ipRoleId: guest.roleId, ready: true } }, guest.tok);
await req(`/rooms/${room.code}/host-actions`, { method: 'POST', body: { action: 'set-plan', gamePlan: [{ id: 't1', gameId: 'turtle', createdAt: new Date().toISOString(), rounds: 1 }] } }, host.tok);
console.log('room:', room.code, '— 等待 100s AI 预热…');
await sleep(100000);
async function startDrawAndCheck(round) {
  const t0 = Date.now();
  await req(`/rooms/${room.code}/host-actions`, { method: 'POST', body: { action: 'start', gameId: 'turtle' } }, host.tok);
  console.log(`[第${round}局] start 用时`, ((Date.now() - t0) / 1000).toFixed(1), 's');
  await req(`/rooms/${room.code}/actions`, { method: 'POST', body: { actionId: 'smokedraw' + Date.now(), gameId: 'turtle', action: 'party-draw', payload: {} } }, host.tok);
  const d = await req(`/rooms/${room.code}`, {}, host.tok);
  const party = d.room.game.privateState.party;
  const card = party.current?.card ?? {};
  console.log('flavorSource:', party.flavorSource);
  console.log('汤面:', card.label);
  console.log('kicker:', card.kicker);
  console.log('汤底:', (card.answer || '').slice(0, 90));
  const themed = THEMED.test(`${card.label}`);
  if (party.flavorSource === 'ai' && themed) { console.log(`PASS：第${round}局即 IP 专属题`); return 'ai'; }
  if (party.flavorSource === 'local') { console.log(card.kicker && !card.kicker.includes('专属') ? `第${round}局回退标注诚实` : 'FAIL 回退标注错误'); return 'local'; }
  console.log(themed ? 'PASS 内容贴合 IP' : 'WARN 需人工判断');
  return 'unknown';
}
const first = await startDrawAndCheck(1);
if (first !== 'ai') {
  console.log('— 等待 90s 让补货任务完成，再开第二局…');
  await sleep(90000);
  await startDrawAndCheck(2);
}
