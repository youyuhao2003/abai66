// 测试 SSE 流式端点
import { encryptPayload, decryptPayload } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
const u = { id: 990001, first_name: '旅行者', username: 'traveler' };
const initData = `user=${encodeURIComponent(JSON.stringify(u))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
const r = await fetch(B + '/api/auth-webapp', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ clientId:'s', fingerprint:'fp', device:{platform:'node'}, initData }) });
const k = (await r.json()).apiKey;

// 取角色
const lr = await fetch(B + '/api/list-public-character-cards', { method:'POST',
  headers:{'Content-Type':'application/json', Authorization:'Bearer ' + k},
  body: JSON.stringify({_enc: encryptPayload({ sortBy:'trending' })}) });
const lj = JSON.parse(await lr.text());
const lb = lj._enc ? decryptPayload(lj._enc) : lj;
const cardId = lb.items[0].id;
console.log('card:', lb.items[0].data.nickname, cardId);

console.log('\n=== 开始流式请求 ===');
const t0 = Date.now();
const res = await fetch(B + '/api/chat-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k },
  body: JSON.stringify({ characterCardId: cardId, message: '七个月了，你打算住到什么时候？' }),
});

console.log('status:', res.status, res.headers.get('content-type'));

const reader = res.body.getReader();
const dec = new TextDecoder();
let pending = '';
let firstDeltaAt = null;
let deltaCount = 0;
let totalChars = 0;
const events = [];

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  pending += dec.decode(value, { stream: true });
  const frames = pending.split('\n\n');
  pending = frames.pop() || '';

  for (const f of frames) {
    let ev = 'message', data = '';
    for (const ln of f.split('\n')) {
      if (ln.startsWith('event:')) ev = ln.slice(6).trim();
      else if (ln.startsWith('data:')) data += ln.slice(5).trim();
    }
    if (!data) continue;
    let obj; try { obj = JSON.parse(data); } catch { continue; }

    if (ev === 'delta') {
      if (firstDeltaAt === null) firstDeltaAt = Date.now() - t0;
      deltaCount++;
      totalChars += (obj.text || '').length;
    } else {
      events.push({ ev, obj, at: Date.now() - t0 });
    }
  }
}

console.log('\n=== 流式结果 ===');
console.log('首个 delta 到达:', firstDeltaAt, 'ms');
console.log('delta 数量:', deltaCount);
console.log('累计字符:', totalChars);
console.log('总耗时:', Date.now() - t0, 'ms');

for (const e of events) {
  console.log(`\n[${e.ev}] @${e.at}ms`);
  if (e.ev === 'status') {
    console.log('  状态栏', (e.obj.rows||[]).length, '项');
    (e.obj.rows||[]).slice(0,3).forEach(r => console.log(`   ${r.emoji} ${r.key}: ${r.value}`));
  } else if (e.ev === 'options') {
    console.log('  选项', (e.obj.items||[]).length, '条');
    (e.obj.items||[]).forEach(o => console.log(`   [${o.type}] ${o.text.slice(0,40)}`));
  } else if (e.ev === 'done') {
    console.log('  ', JSON.stringify(e.obj));
  } else if (e.ev === 'error') {
    console.log('  ERROR:', e.obj.message);
  } else if (e.ev === 'warning') {
    console.log('  WARN:', e.obj.message);
  }
}
