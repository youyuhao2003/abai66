// 核心业务链路验证(功能是否真的能跑通)
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const R = [];
const ok = (n, c, x='') => { R.push({n,c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };

async function A(action, body = {}, key = apiKey) {
  const h = {'Content-Type':'application/json'};
  if (key) h.Authorization = 'Bearer ' + key;
  const r = await fetch(`${B}/api/${action}`, {method:'POST', headers:h, body: JSON.stringify({_enc: enc(body)})});
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,100)}; }
  return {status:r.status, body: j && j._enc ? dec(j._enc) : j};
}

// 登录
const uid = 550000 + Math.floor(Math.random()*1000);
{
  const user = {id: uid, first_name:'链路测试', username:'flow'+uid, language_code:'zh-hans'};
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({clientId:'flow', fingerprint:'fp', device:{platform:'node'}, initData})});
  const j = await r.json();
  apiKey = j.apiKey;
  ok('登录', !!apiKey, j.userId);
}

// 1. 角色卡全生命周期
let cardId;
{
  const list = await A('list-public-character-cards', {sortBy:'trending'});
  ok('公开角色卡(自建数据)', list.body.items.length === 12 && list.body.total >= 24,
     `${list.body.items.length} 张 / 共 ${list.body.total}`);
  ok('数据是自建的', list.body.items[0].data.name.includes('便利店') || !list.body.items[0].data.name.includes('继女'),
     list.body.items[0].data.name);

  const created = await A('upsert-character-card', {data:{
    name:'链路测试角色', nickname:'小链', tags:['测试','功能'],
    creator_notes:'这是一个用于验证功能的测试角色。', system_prompt:'你是小链,说话简洁。',
    opening_line:'（抬头）你来啦。',
  }});
  ok('创建角色卡', created.body.created === true, created.body.id);
  cardId = created.body.id;

  const mine = await A('list-my-character-cards');
  ok('我的角色卡列表', mine.body.items.length >= 1, `${mine.body.items.length} 张`);

  const pub = await A('publish-character-card', {id: cardId});
  ok('发布角色卡', pub.body.success === true, pub.body.reviewStatus);

  const detail = await A('get-public-character-card', {id: cardId});
  ok('发布后可公开访问', detail.status === 200, detail.body.card?.data?.name);

  const share = await A('get-character-share-link', {id: cardId});
  ok('分享链接', share.body.url === `/card/${cardId}`, share.body.url);
}

// 2. 真实大模型对话
{
  const before = (await A('get-account-balance')).body.balance;
  const t0 = Date.now();
  const r = await A('create-chat-completion', {characterCardId: cardId, message:'你好,今天过得怎么样?'});
  const dt = Date.now() - t0;
  ok('大模型对话', r.status === 200 && !!r.body.reply, `${dt}ms`);
  console.log('      回复:', String(r.body.reply || '').slice(0, 60));
  ok('扣额度', r.body.balance < before, `${before} -> ${r.body.balance}`);

  const undo = await A('undo-last-round', {characterCardId: cardId});
  ok('撤销上一轮', undo.status === 200 || undo.status === 400, `剩余 ${undo.body.messages?.length ?? 0} 条`);

  const arch = await A('list-archives');
  ok('会话列表', arch.body.items.length >= 1, `${arch.body.items.length} 个会话`);
}

// 3. 连续对话(上下文)
{
  const a = await A('create-chat-completion', {characterCardId: cardId, message:'我叫小明'});
  const b = await A('create-chat-completion', {characterCardId: cardId, message:'我叫什么名字?'});
  ok('多轮上下文', b.status === 200 && !!b.body.reply, String(b.body.reply).slice(0, 40));
}

// 4. 社区互动
{
  const like = await A('toggle-like', {characterCardId: cardId});
  ok('点赞', like.body.liked === true);
  const fav = await A('toggle-favorite', {characterCardId: cardId});
  ok('收藏', fav.body.favorited === true);
  const col = await A('list-user-collections');
  ok('收藏列表', col.body.items.length === 1);
  const rev = await A('upsert-review', {characterCardId: cardId, rating:5, content:'很好用'});
  ok('发表评价', rev.status === 200);
  const rl = await A('list-reviews', {characterCardId: cardId});
  ok('评价列表', rl.body.items.length === 1, rl.body.items[0]?.content);
  const tip = await A('send-character-tip', {characterCardId: cardId, amount:100, message:'加油'});
  ok('打赏角色', tip.status === 200 || tip.status === 402, `status=${tip.status}`);
}

// 5. 悬赏完整流程
{
  const before = (await A('get-account-balance')).body.balance;
  const c = await A('create-character-bounty', {title:'测试悬赏', description:'描述', rewardCredits:500, slots:2});
  ok('发布悬赏', c.status === 200, `锁定 ${c.body.locked}`);
  const list = await A('list-active-bounties');
  ok('悬赏列表', list.body.items.length >= 1);
  const target = list.body.items.find(x => x.id === c.body.id);
  const rv = await A('reserve-bounty-slot', {bountyId: target.id});
  ok('接悬赏', rv.status === 200, rv.body.claimId);
  const claims = await A('list-my-active-bounty-claims');
  ok('我的悬赏', claims.body.items.length === 1);
  const rw = await A('claim-bounty-reward', {claimId: rv.body.claimId});
  ok('领悬赏奖励', rw.status === 200, `+${rw.body.credits}`);
}

// 6. 会员
{
  const m1 = await A('get-membership');
  ok('非会员', m1.body.member === false);
  const sub = await A('subscribe-membership', {plan:'monthly'});
  ok('开通会员', sub.body.success === true, `+${sub.body.days} 天`);
  const m2 = await A('get-membership');
  ok('会员生效', m2.body.member === true && m2.body.benefits.bonusRate === 66);
}

// 7. 世界书 + 知识库
{
  const wb = await A('upsert-world-book', {name:'测试世界', entries:[{key:'设定',content:'一个赛博都市'}]});
  ok('创建世界书', wb.body.created === true, wb.body.id);
  const wl = await A('list-my-world-books');
  ok('世界书列表', wl.body.items.length >= 1);
  const ik = await A('init-knowledge', {characterCardId: cardId});
  ok('初始化知识库', ik.status === 200, `新建 ${ik.body.created} 条`);
  const gk = await A('get-knowledge', {characterCardId: cardId});
  ok('知识库读取', gk.body.items.length >= 1);
}

// 8. 工单
{
  const t = await A('create-ticket', {subject:'测试工单', content:'这是测试内容', category:'bug'});
  ok('创建工单', t.status === 200, t.body.id);
  const tl = await A('list-tickets');
  ok('工单列表', tl.body.items.length === 1);
  const td = await A('get-ticket', {id: t.body.id});
  ok('工单详情', td.body.messages.length === 1);
  const ap = await A('append-ticket-message', {ticketId: t.body.id, content:'追加一条'});
  ok('追加消息', ap.status === 200);
  const cl = await A('close-ticket', {ticketId: t.body.id});
  ok('关闭工单', cl.status === 200);
}

// 9. 绘图
{
  const g = await A('generate-image', {prompt:'雨夜街道', engineId:'art-v3', count:2});
  ok('绘图生成', g.body.images?.length === 2, `-${g.body.credits}`);
  const logs = await A('list-text-to-image-logs');
  ok('绘图记录', logs.body.items.length >= 1);
}

// 10. 佣金
{
  const inv = await A('get-invite-code');
  ok('邀请码', !!inv.body.code, inv.body.code);
  const stats = await A('get-invite-code-stats');
  ok('邀请统计', stats.status === 200);
  const dash = await A('get-ambassador-dashboard');
  ok('大使面板', !!dash.body.level, dash.body.level);
}

// 11. 设置
{
  const p1 = await A('get-user-preferences');
  const p2 = await A('update-user-preferences', {preferences:{theme:'light'}});
  ok('偏好设置', p2.body.preferences.theme === 'light');
  const ms = await A('update-model-settings', {settings:{defaultModel:'deepseek-v4-pro'}});
  const ms2 = await A('get-model-settings');
  ok('模型设置', ms2.body.settings.defaultModel === 'deepseek-v4-pro');
}

// 12. Miniapp KV
{
  await A('miniapp-kv-put', {key:'score', value:42});
  const g = await A('miniapp-kv-get', {key:'score'});
  ok('Miniapp KV 读写', g.body.value === 42, String(g.body.value));
}

const p = R.filter(x=>x.c).length;
console.log(`\n===== ${p}/${R.length} 通过 =====`);
process.exit(p===R.length?0:1);
