// 验证:刷新后数据能否正确加载
import { encryptPayload, decryptPayload } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';

async function login(userId) {
  const u = { id: userId, first_name: '持久化测试', username: 'persist' };
  const initData = `user=${encodeURIComponent(JSON.stringify(u))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(B + '/api/auth-webapp', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'p', fingerprint: 'fp', device: { platform: 'node' }, initData }) });
  return (await r.json()).apiKey;
}

async function api(key, name, body = {}) {
  const r = await fetch(`${B}/api/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ _enc: encryptPayload(body) }) });
  const t = await r.text();
  const j = JSON.parse(t);
  return { status: r.status, body: j._enc ? decryptPayload(j._enc) : j };
}

const R = [];
const ok = (n, c, x = '') => { R.push({ n, c: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

// 第一次登录,聊两句
const key1 = await login(550001);
ok('登录', !!key1);

const cards = await api(key1, 'list-public-character-cards', { sortBy: 'trending' });
const cardId = cards.body.items[0].id;

await api(key1, 'create-chat-completion', { characterCardId: cardId, message: '第一句话' });
await api(key1, 'create-chat-completion', { characterCardId: cardId, message: '第二句话' });

let a1 = await api(key1, 'list-archives');
ok('聊天后会话存在', a1.body.items.length === 1, `${a1.body.items[0]?.messageCount} 条消息`);

// 模拟刷新:重新登录(新 apiKey),看数据还在不在
const key2 = await login(550001);
ok('重新登录拿到新 key', !!key2 && key2 !== key1);

const a2 = await api(key2, 'list-archives');
ok('刷新后会话仍在', a2.body.items.length === 1,
   `${a2.body.items[0]?.messageCount} 条消息`);

// 打开会话,看消息(get-archive 按 characterCardId 取)
const detail = await api(key2, 'get-archive', { characterCardId: cardId });
ok('消息可加载', (detail.body.messages || []).length >= 4,
   `${(detail.body.messages || []).length} 条`);
ok('消息内容完整', (detail.body.messages || []).every(m => m.role && m.content !== undefined),
   (detail.body.messages || []).map(m => m.role).join(','));
ok('状态栏保留', (detail.body.messages || []).some(m => m.statusBar),
   `有 ${(detail.body.messages || []).filter(m => m.statusBar).length} 条带状态栏`);

// 换一个用户id,应该看不到别人的会话
const key3 = await login(550002);
const a3 = await api(key3, 'list-archives');
ok('用户数据隔离', a3.body.items.length === 0, `${a3.body.items.length} 条(应为 0)`);

const passed = R.filter(x => x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);
