// 验证:后台改配置 → 聊天立即生效
import { encryptPayload, decryptPayload } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
const TOKEN = 'change-me-please';
const R = [];
const ok = (n, c, x = '') => { R.push({ n, c: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

async function admin(name, body = {}) {
  const r = await fetch(`${B}/api/admin/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 先清理旧测试用户(避免封禁残留、额度耗尽的干扰)
{
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host:'127.0.0.1', port: Number(process.env.DB_PORT || 3306), user:'root',
    password:'', database: process.env.DB_NAME || 'wujie_tavern', charset:'utf8mb4' });
  for (const uid of ['u770001', 'u770002']) {
    for (const t of ['user_tasks','api_keys','sessions','favorites','likes','bookmarks',
                     'personas','user_settings','credit_history']) {
      try { await conn.query(`DELETE FROM ${t} WHERE user_id=?`, [uid]); } catch {}
    }
    try { await conn.query('DELETE FROM users WHERE id=?', [uid]); } catch {}
  }
  await conn.end();
}

// 登录普通用户
const u = { id: 770001, first_name: '配置验证', username: 'cfgtest' };
const initData = `user=${encodeURIComponent(JSON.stringify(u))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
const ar = await fetch(`${B}/api/auth-webapp`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 'c', fingerprint: 'fp', device: { platform: 'node' }, initData }) });
const apiKey = (await ar.json()).apiKey;
ok('用户登录', !!apiKey);

async function api(name, body = {}) {
  const r = await fetch(`${B}/api/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ _enc: encryptPayload(body) }) });
  const t = await r.text();
  const j = JSON.parse(t);
  return { status: r.status, body: j._enc ? decryptPayload(j._enc) : j };
}

// ========== 1. 改仓库模型计费,验证聊天扣费变化 ==========
console.log('\n--- 测试1:改模型计费 ---');
{
  const models = await admin('list-text-models');
  const m2 = models.items.find(x => x.id === 2);
  console.log('原计费:', m2.creditPer1k);

  // 先聊一次,记录消耗
  const cards = await api('list-public-character-cards', { sortBy: 'trending' });
  const cardId = cards.body.items[0].id;

  const r1 = await api('create-chat-completion', { characterCardId: cardId, message: '测试一' });
  const cost1 = r1.body.credits;
  console.log('原消耗:', cost1);

  // 后台把计费改成 100 倍
  await admin('save-text-model', { model: { ...m2, creditPer1k: 300 } });
  console.log('改为:', 300);

  // 立刻再聊一次(不重启)
  const r2 = await api('create-chat-completion', { characterCardId: cardId, message: '测试二' });
  const cost2 = r2.body.credits;
  console.log('新消耗:', cost2);

  ok('计费改动生效', cost2 > cost1 * 10, `${cost1} -> ${cost2}`);

  // 改回
  await admin('save-text-model', { model: { ...m2, creditPer1k: m2.creditPer1k } });
  const r3 = await api('create-chat-completion', { characterCardId: cardId, message: '测试三' });
  ok('计费还原', r3.body.credits <= cost1 * 2, `${r3.body.credits}`);
}

// ========== 2. 停用模型 ==========
console.log('\n--- 测试2:停用模型 ---');
{
  const models = await admin('list-text-models');
  const m8 = models.items.find(x => x.id === 8);
  await admin('save-text-model', { model: { ...m8, enabled: false } });

  const after = await admin('list-text-models');
  const got = after.items.find(x => x.id === 8);
  ok('模型已停用', got.enabled === false);

  // 用停用的模型 id 聊天,应回落到兜底
  await api('update-chat-settings', { settings: { modelId: 8 } });
  const cards = await api('list-public-character-cards', { sortBy: 'trending' });
  const r = await api('create-chat-completion', {
    characterCardId: cards.body.items[0].id, message: '用停用模型',
  });
  ok('停用模型仍能回落', r.status === 200 && !!r.body.reply, `模型显示: ${r.body.model}`);

  await admin('save-text-model', { model: { ...m8, enabled: true } });
  await api('update-chat-settings', { settings: { modelId: 2 } });
}

// ========== 3. 改生图引擎价格与尺寸 ==========
console.log('\n--- 测试3:改生图引擎 ---');
{
  const imgs = await admin('list-image-models');
  const e0 = imgs.items[0];
  console.log('原引擎:', e0.name, e0.credit, `${e0.width}x${e0.height}`);

  await admin('save-image-model', { model: { ...e0, apiKey: '', credit: 999, width: 640, height: 960 } });

  const r = await api('gen-image-for-message', { prompt: '测试画面' });
  ok('生图用新价格', r.body.credits === 999, String(r.body.credits));
  ok('生图用新尺寸', r.body.image?.width === 640 && r.body.image?.height === 960,
     `${r.body.image?.width}x${r.body.image?.height}`);
  ok('生图引擎名正确', !!r.body.engine, r.body.engine);

  await admin('save-image-model', { model: { ...e0, apiKey: '', credit: e0.credit, width: e0.width, height: e0.height } });
}

// ========== 4. 改全局配置 ==========
console.log('\n--- 测试4:改全局配置 ---');
{
  const before = await admin('list-config');
  const oldBonus = before.groups.economy.find(x => x.key === 'economy.signupBonus').value;

  await admin('save-config', { items: { 'economy.signupBonus': '8888' } });

  // 新用户注册
  const nu = { id: 770002, first_name: '新用户', username: 'newbie' };
  const nd = `user=${encodeURIComponent(JSON.stringify(nu))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  await fetch(`${B}/api/auth-webapp`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'n', fingerprint: 'fp', device: { platform: 'node' }, initData: nd }) });

  const list = await admin('list-users', { keyword: 'u770002' });
  const newUser = list.items.find(x => x.id === 'u770002');
  ok('新注册赠送额度已生效', newUser && newUser.balance == 8888,
     `余额 ${newUser?.balance}（期望 8888）`);

  await admin('save-config', { items: { 'economy.signupBonus': oldBonus } });
}

// ========== 5. 封禁用户后的效果 ==========
console.log('\n--- 测试5:封禁用户 ---');
{
  await admin('set-user-status', { userId: 'u770001', status: 'banned', reason: '测试封禁' });

  const r = await fetch(`${B}/api/get-user-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ _enc: encryptPayload({}) }),
  });
  ok('被封禁后接口拒绝', r.status === 401 || r.status === 403, 'HTTP ' + r.status);

  await admin('set-user-status', { userId: 'u770001', status: 'active' });
}

const passed = R.filter(x => x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);
process.exit(passed === R.length ? 0 : 1);
