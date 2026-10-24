// 端到端验证:模拟前端走完整加密通道
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const results = [];
function ok(name, cond, extra='') {
  results.push({name, pass: !!cond});
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

async function callAction(action, body = {}, key = apiKey) {
  const headers = {'Content-Type':'application/json'};
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(`${B}/api/${action}`, {method:'POST', headers, body: JSON.stringify({_enc: enc(body)})});
  const j = await r.json();
  return {status: r.status, body: j && j._enc ? dec(j._enc) : j};
}

// 1. 401 未授权
{
  const r = await callAction('get-account-balance', {}, null);
  ok('未登录访问受保护接口 -> 401', r.status === 401, `status=${r.status}`);
}

// 2. 公开列表可匿名
{
  const r = await callAction('list-public-character-cards', {sortBy:'trending'}, null);
  ok('匿名调用公开列表 -> 200', r.status === 200, `items=${r.body?.items?.length}`);
  ok('匿名非 trending 被拒 -> 403', (await callAction('list-public-character-cards',{sortBy:'latest'},null)).status === 403);
}

// 3. 登录
{
  const user = {id: 880022, first_name:'测试员', username:'tester', language_code:'zh-hans'};
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({clientId:'e2e', fingerprint:'fp', device:{ua:'node'}, initData})});
  const j = await r.json();
  ok('auth-webapp 签发 apiKey', r.status === 200 && !!j.apiKey, j.userId);
  apiKey = j.apiKey;
}

// 4. 余额
{
  const r = await callAction('get-account-balance');
  ok('鉴权后可读余额', r.status === 200 && typeof r.body.balance === 'number', `balance=${r.body?.balance}`);
}

// 5. 签到
{
  const r = await callAction('create-checkin');
  ok('签到成功并加额度', r.status === 200 && r.body.success, `+${r.body?.credits} -> ${r.body?.balance}`);
  const again = await callAction('create-checkin');
  ok('重复签到被拦', again.body.alreadyCheckedIn === true);
}

// 6. 对话
{
  const list = await callAction('list-public-character-cards', {sortBy:'trending'});
  const cardId = list.body.items[0].id;
  const before = (await callAction('get-account-balance')).body.balance;
  const r = await callAction('create-chat-completion', {characterCardId: cardId, message:'你好'});
  ok('对话返回回复并扣额度', r.status === 200 && !!r.body.reply && r.body.balance < before,
     `-${r.body?.credits}, reply=${String(r.body?.reply).slice(0,16)}…`);
  const arch = await callAction('get-archive', {characterCardId: cardId});
  ok('对话历史已落库', arch.body.messages.length >= 2, `${arch.body.messages.length} 条`);
}

// 7. 充值 + 支付回调
{
  const pkg = await callAction('list-recharge-packages');
  const before = (await callAction('get-account-balance')).body.balance;
  const order = await callAction('create-payment-link', {packageId: pkg.body.packages[2].id});
  ok('创建订单', order.status === 200 && !!order.body.orderId, order.body.orderId);
  const st = await callAction('get-order-status', {orderId: order.body.orderId});
  ok('查询订单状态 pending', st.body.order.status === 'pending');
  const pay = await callAction('simulate-payment-callback', {orderId: order.body.orderId});
  const after = (await callAction('get-account-balance')).body.balance;
  ok('支付回调到账(首充双倍)', pay.status === 200 && after > before, `+${pay.body?.credits}, ${before} -> ${after}`);
}

// 8. 兑换码
{
  const r = await callAction('redeem-code', {code:'XINGYE2026'});
  ok('兑换码可用', r.status === 200 && r.body.success, `+${r.body?.credits}`);
  const bad = await callAction('redeem-code', {code:'NOT_EXIST'});
  ok('无效兑换码被拒', bad.status === 404);
}

// 9. 任务
{
  const t = await callAction('get-user-tasks');
  ok('任务列表', Array.isArray(t.body.items) && t.body.items.length === 4);
  const claim = await callAction('claim-task-reward', {key:'first_chat'});
  ok('领取已完成任务奖励', claim.status === 200, `+${claim.body?.credits}`);
  const dup = await callAction('claim-task-reward', {key:'first_chat'});
  ok('重复领取被拦', dup.status === 400);
}

// 10. 绘图
{
  const r = await callAction('generate-image', {prompt:'雨夜霓虹', engineId:'art-v3', count:2});
  ok('绘图生成', r.status === 200 && r.body.images.length === 2, `-${r.body?.credits}`);
}

// 11. 越权
{
  const other = await callAction('get-order-status', {orderId:'ord_not_exist'});
  ok('不存在订单 -> 404', other.status === 404);
}

// 12. 加密密封性
{
  const r = await fetch(`${B}/api/get-account-balance`, {method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+apiKey},
    body: JSON.stringify({_enc:'AAAA'+Buffer.from('garbage').toString('base64')})});
  ok('篡改密文 -> 400', r.status === 400);
}

const passed = results.filter(x=>x.pass).length;
console.log(`\n===== ${passed}/${results.length} 通过 =====`);
process.exit(passed === results.length ? 0 : 1);
