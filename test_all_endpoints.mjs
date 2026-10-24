// 全端点冒烟测试:156 个端点逐个调用,验证不崩溃
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
let cardId = null;
let archiveCard = null;

async function A(action, body = {}, key = apiKey) {
  const h = {'Content-Type':'application/json'};
  if (key) h.Authorization = 'Bearer ' + key;
  const r = await fetch(`${B}/api/${action}`, {method:'POST', headers:h, body: JSON.stringify({_enc: enc(body)})});
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,100)}; }
  return {status:r.status, body: j && j._enc ? dec(j._enc) : j};
}

// 登录
{
  const user = {id: 660001, first_name:'冒烟测试', username:'smoke', language_code:'zh-hans'};
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({clientId:'smoke', fingerprint:'fp', device:{platform:'node'}, initData})});
  const j = await r.json();
  apiKey = j.apiKey;
  console.log('login:', j.userId, j.apiKey ? 'OK' : 'FAIL');
}

// 取一张卡
{
  const r = await A('list-public-character-cards', {sortBy:'trending'});
  cardId = r.body.items?.[0]?.id;
  console.log('cardId:', cardId);
}

// 每个端点的测试参数
const CASES = {
  'upsert-character-card': { data: { name:'冒烟角色', nickname:'小烟', tags:['测试'], creator_notes:'测试设定', system_prompt:'测试指令' } },
  'migrate-character-card': { id: null },
  'import-character-card-png': { cardData: { name:'导入角色', nickname:'导入' } },
  'list-my-character-cards': {},
  'list-public-character-cards': { sortBy:'trending' },
  'get-character-card': { id: null },
  'get-public-character-card': { id: null },
  'create-chat-completion': { message:'你好', characterCardId: null },
  'undo-last-round': { characterCardId: null },
  'refresh-greeting': { characterCardId: null },
  'save-user-message': { message:'测试消息', characterCardId: null },
  'get-archive': { characterCardId: null },
  'list-archives': {},
  'get-archive-messages': { characterCardId: null, limit: 10 },
  'create-archive': { characterCardId: null },
  'update-archive': { characterCardId: null, title:'新标题' },
  'import-chat-history': { characterCardId: null, messages:[{role:'user',content:'导入'}] },
  'upload-image': { url:'/x.png', prompt:'测试' },
  'list-user-images': {},
  'gen-image-for-message': { prompt:'场景' },
  'list-character-images': {},
  'list-user-generated-images': {},
  'review-image': { id:'none', approved:true },
  'list-gallery-images': {},
  'gen-options-for-message': { context:'在便利店' },
  'gen-status-bar-for-message': {},
  'gen-knowledge-from-messages': { characterCardId: null },
  'get-knowledge': { characterCardId: null },
  'update-knowledge-entries': { characterCardId: null, items:[{title:'t',content:'c'}] },
  'gen-character-card': { idea:'一个图书管理员' },
  'list-workshop-character-cards': {},
  'gen-miniapp': { idea:'一个记账小程序' },
  'get-miniapp-gen-task': { miniappId:'none' },
  'get-miniapp-gen-spec': { miniappId:'none' },
  'review-character-card': { id:null, status:'approved' },
  'gen-card-review': { id:null },
  'get-card-review': { id:null },
  'list-top-authors': {},
  'get-author-stats': {},
  'search-character-cards': { keyword:'雨' },
  'get-character-card-i18n': { id:null, language:'zh-Hans' },
  'upsert-world-book': { name:'测试世界书', entries:[{key:'a',content:'b'}] },
  'get-world-book': { id:'none' },
  'list-my-world-books': {},
  'list-public-world-books': {},
  'get-public-world-book': { id:'none' },
  'review-world-book': { id:'none' },
  'extract-world-book': { text:'这是一个赛博都市的世界观' },
  'get-character-miniapp': { miniappId:'none' },
  'stream-miniapp-completion': { messages:[{role:'user',content:'你好'}] },
  'miniapp-draw-generate': { prompt:'霓虹', count:1 },
  'miniapp-kv-get': { key:'foo' },
  'miniapp-kv-put': { key:'foo', value:'bar' },
  'miniapp-kv-delete': { key:'foo' },
  'miniapp-chat-insert': { content:'小程序消息' },
  'miniapp-chat-list': {},
  'miniapp-chat-timeline': {},
  'gamefy-bundle-begin': {},
  'gamefy-bundle-put': {},
  'gamefy-bundle-finish': {},
  'scan-miniapp': {},
  'create-payment-link': { packageId:'pkg_60' },
  'get-order-status': { orderId:'none' },
  'track-payment-link-opened': { orderId:'none' },
  'list-order-history': {},
  'list-recharge-packages': {},
  'create-checkin': {},
  'get-checkin-credits': {},
  'get-checkin-daily-summary': {},
  'get-user-profile': {},
  'get-public-user-profile': { userId:'u660001' },
  'get-account-balance': {},
  'update-user-profile': { firstName:'冒烟' },
  'bind-account': { provider:'google', externalId:'g123' },
  'get-user-preferences': {},
  'update-user-preferences': { preferences:{ theme:'dark' } },
  'get-model-settings': {},
  'update-model-settings': { settings:{ defaultModel:'deepseek-v4.1-flash' } },
  'get-model-options': {},
  'calculate-model-price': { modelId:'deepseek-v4.1-flash', tokens:1000 },
  'calculate-image-price': { engineId:'art-v3', count:2 },
  'calculate-plot-options-price': {},
  'get-top-queries': {},
  'list-credit-history': {},
  'upsert-review': { characterCardId:null, rating:5, content:'很好' },
  'list-reviews': { characterCardId:null },
  'get-like-stats': { characterCardId:null },
  'toggle-like': { characterCardId:null },
  'toggle-favorite': { characterCardId:null },
  'list-user-collections': {},
  'delete-review': { id:0 },
  'toggle-pin-review': { id:0 },
  'redeem-code': { code:'NOT_EXIST' },
  'create-redeem-code': { credits:1000, total:10 },
  'list-redeem-codes': {},
  'report-tg-start-param': { startParam:'test' },
  'report-write-access': { granted:true },
  'get-bot-reachability': {},
  'get-user-tasks': {},
  'claim-task-reward': { key:'first_chat' },
  'repair-chat-streak': {},
  'claim-streak-milestone': { days:3 },
  'claim-streak-cycle': {},
  'get-character-reward-progress': { characterCardId:null },
  'claim-character-reward': { characterCardId:null, at:10 },
  'list-character-card-tier-up': {},
  'claim-character-card-tier-up': {},
  'send-character-tip': { characterCardId:null, amount:100, message:'加油' },
  'list-character-tips': { characterCardId:null },
  'unlock-character-gallery': {},
  'create-character-bounty': { title:'测试悬赏', description:'描述', rewardCredits:500, slots:1 },
  'reserve-bounty-slot': { bountyId:'none' },
  'claim-bounty-reward': { claimId:'none' },
  'abandon-bounty-claim': { claimId:'none' },
  'list-active-bounties': {},
  'list-my-active-bounty-claims': {},
  'get-bounty-claim-progress': { claimId:'none' },
  'list-bounty-claims': { bountyId:'none' },
  'mark-bounty-low-quality': { claimId:'none' },
  'toggle-follow': { userId:'u660001' },
  'list-user-follows': {},
  'get-leaderboard': {},
  'submit-report': { targetType:'card', targetId:'x', reason:'spam' },
  'publish-character-card': { id:null },
  'get-publish-log': {},
  'get-character-card-studio-editable': { id:null },
  'get-character-share-link': { id:null },
  'init-knowledge': { characterCardId:null },
  'get-notifications': {},
  'save-announcement': { title:'测试公告', body:'内容' },
  'get-announcements': {},
  'delete-announcement': { id:'none' },
  'get-ambassador-dashboard': {},
  'get-invite-code-stats': {},
  'get-daily-invite-stats': {},
  'get-daily-rebate-stats': {},
  'bind-invite-code': { code:'NOTEXIST' },
  'get-commission-records': {},
  'redeem-commission': {},
  'withdraw-commission': { amount:100 },
  'miniapp-completions': { messages:[{role:'user',content:'你好'}] },
  'miniapp-models-list': {},
  'miniapp-user-info': {},
  'miniapp-draw-generate': { prompt:'测试', count:1 },
  'miniapp-launch-check': {},
  'generate-image': { prompt:'测试', engineId:'art-v3', count:1 },
  'get-generation-task': { taskId:'none' },
  'calculate-generation-price': { engineId:'art-v3', count:1 },
  'list-text-to-image-engines': {},
  'list-text-to-image-logs': {},
  'delete-text-to-image-log': { taskId:'none' },
  'create-ticket': { subject:'测试工单', content:'内容', category:'other' },
  'list-tickets': {},
  'get-ticket': { id:'none' },
  'append-ticket-message': { ticketId:'none', content:'追加' },
  'close-ticket': { ticketId:'none' },
};

// 先把 null 替换成真实 cardId
for (const k of Object.keys(CASES)) {
  const v = CASES[k];
  for (const f of ['id','characterCardId']) {
    if (v[f] === null) v[f] = cardId;
  }
}

const { actions } = await import('./lib/actions_registry.mjs');
const all = Object.keys(actions);

const results = [];
for (const a of all) {
  const body = CASES[a] || {};
  let r;
  try { r = await A(a, body); }
  catch (e) { r = { status: -1, body: { error: String(e.message) } }; }
  const ok = r.status >= 200 && r.status < 400;
  const internal = r.status === 500;
  results.push({ a, status: r.status, ok, internal });
  const tag = internal ? 'BROKEN' : (ok ? 'OK ' : 'ERR');
  console.log(`${String(r.status).padStart(4)} ${tag} ${a}${ok ? '' : '  -> ' + JSON.stringify(r.body).slice(0, 90)}`);
}

const broken = results.filter(x => x.internal);
const errs = results.filter(x => !x.ok && !x.internal);
console.log(`\n===== 端点 ${all.length} 个:OK ${results.filter(x=>x.ok).length} / 内部错误 ${broken.length} / 业务拒绝 ${errs.length} =====`);
if (broken.length) console.log('BROKEN:', broken.map(x=>x.a).join(', '));
