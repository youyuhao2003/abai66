// MySQL 版端到端测试(含真实大模型)
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const R = [];
const ok = (n, c, x='') => { R.push({n, c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };

async function A(action, body = {}, key = apiKey) {
  const headers = {'Content-Type':'application/json'};
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(`${B}/api/${action}`, {method:'POST', headers, body: JSON.stringify({_enc: enc(body)})});
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,150)}; }
  return {status: r.status, body: j && j._enc ? dec(j._enc) : j};
}

// Auth
{
  const user = {id: 771122, first_name:'MySQL测试', username:'mysqltester', language_code:'zh-hans'};
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({clientId:'e2e-mysql', fingerprint:'fp', device:{ua:'node'}, initData})});
  const j = await r.json();
  ok('auth-webapp 签发 apiKey', r.status===200 && !!j.apiKey, j.userId);
  apiKey = j.apiKey;
}

ok('未登录受保护接口 -> 401', (await A('get-account-balance',{},null)).status === 401);

// 列表(MySQL 查询)
{
  const r = await A('list-public-character-cards', {sortBy:'trending'});
  ok('角色卡列表(MySQL)', r.status===200 && r.body.items.length>0, `items=${r.body.items?.length} total=${r.body.total}`);
  ok('latest 排序', (await A('list-public-character-cards', {sortBy:'latest'})).status===200);
  const cid = r.body.items[0].id;
  const d = await A('get-public-character-card', {id: cid});
  ok('角色卡详情', d.status===200 && !!d.body.card.data.name, d.body.card?.data?.name);
  globalThis.cardId = cid;
}

// 余额 / 签到
{
  const b = await A('get-account-balance');
  ok('余额', b.status===200, `balance=${b.body.balance}`);
  const c = await A('create-checkin');
  ok('签到(事务加额度)', c.status===200 && c.body.success, `+${c.body.credits} -> ${c.body.balance}`);
  ok('重复签到拦截', (await A('create-checkin')).body.alreadyCheckedIn === true);
  const h = await A('list-credit-history', {limit:10});
  ok('额度流水(MySQL)', Array.isArray(h.body.items) && h.body.items.length>0, `${h.body.items?.length} 条`);
}

// 任务
{
  const t = await A('get-user-tasks');
  ok('任务列表', t.body.items.length===4);
  const claim = await A('claim-task-reward', {key:'first_chat'});
  ok('未完成任务不可领', claim.status===400);
}

// 真实大模型对话
console.log('\n--- 调用真实大模型 (deepseek-v4.1-flash) ---');
{
  const before = (await A('get-account-balance')).body.balance;
  const t0 = Date.now();
  const r = await A('create-chat-completion', {
    characterCardId: globalThis.cardId,
    message: '今天下雨了，你还在等谁？',
    modelId: 'deepseek-v4.1-flash',
  });
  const dt = Date.now() - t0;
  if (r.status === 200) {
    ok('大模型回复', !!r.body.reply, `${dt}ms, ${String(r.body.reply).slice(0,40)}…`);
    ok('token 计量并扣额度', r.body.credits > 0 && r.body.balance < before,
       `tokens=${r.body.usage?.completion_tokens} cost=${r.body.credits}`);
    ok('对话历史落库', r.body.history.length >= 2, `${r.body.history.length} 条`);
  } else {
    ok('大模型回复', false, `status=${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
    ok('token 计量并扣额度', false);
    ok('对话历史落库', false);
  }
}

// 会话回读
{
  const a = await A('get-archive', {characterCardId: globalThis.cardId});
  ok('get-archive 回读', a.status===200 && a.body.messages.length>=2, `${a.body.messages?.length} 条`);
}

// 充值 + 回调
{
  const pkg = await A('list-recharge-packages');
  ok('充值档位(MySQL)', pkg.body.packages.length===6);
  const before = (await A('get-account-balance')).body.balance;
  const o = await A('create-payment-link', {packageId: pkg.body.packages[2].id});
  ok('创建订单', o.status===200, o.body.orderId);
  const pay = await A('simulate-payment-callback', {orderId: o.body.orderId});
  ok('支付回调(事务 + 首充双倍)', pay.status===200, `+${pay.body.credits}, ${before} -> ${pay.body.balance}`);
}

// 兑换码(防重复)
{
  const a1 = await A('redeem-code', {code:'XINGYE2026'});
  ok('兑换码首次可用', a1.status===200, `+${a1.body.credits}`);
  const a2 = await A('redeem-code', {code:'XINGYE2026'});
  ok('同用户重复兑换被拦', a2.status===400, a2.body.error);
}

// 绘图
{
  const r = await A('generate-image', {prompt:'雨夜霓虹街道', engineId:'art-v3', count:2});
  ok('绘图任务落库', r.status===200 && r.body.images.length===2, `-${r.body.credits}`);
}

// 收藏
{
  const t = await A('toggle-favorite', {characterCardId: globalThis.cardId});
  ok('收藏切换', t.status===200 && t.body.favorited===true);
  const l = await A('list-user-collections');
  ok('收藏列表(JOIN 查询)', l.body.items.length===1);
}

// 加密密封
{
  const r = await fetch(`${B}/api/get-account-balance`, {method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+apiKey},
    body: JSON.stringify({_enc:'AAAA'+Buffer.from('garbage').toString('base64')})});
  ok('篡改密文 -> 400', r.status===400);
}

const p = R.filter(x=>x.c).length;
console.log(`\n===== ${p}/${R.length} 通过 =====`);
process.exit(p===R.length?0:1);
