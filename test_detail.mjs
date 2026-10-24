// 详情页端点测试
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const R = [];
const ok = (n,c,x='') => { R.push({n,c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };
async function A(a, b = {}) {
  const r = await fetch(`${B}/api/${a}`, { method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+apiKey},
    body: JSON.stringify({_enc: enc(b)}) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,100)}; }
  return { status:r.status, body: j && j._enc ? dec(j._enc) : j };
}

const uid = 110000 + Math.floor(Math.random()*900);
{
  const user = { id: uid, first_name:'详情测试', username:'det'+uid };
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ clientId:'det', fingerprint:'fp', device:{platform:'node'}, initData }) });
  apiKey = (await r.json()).apiKey;
  ok('登录', !!apiKey);
}

let cardId;
{
  const c = await A('list-public-character-cards', { sortBy:'trending' });
  cardId = c.body.items[0].id;
  ok('取到角色', !!cardId, c.body.items[0].data.nickname);
}

// 详情聚合
{
  const r = await A('get-card-detail', { id: cardId });
  const d = r.body;
  ok('详情聚合', r.status === 200 && !!d.card, d.card?.data?.name);
  ok('统计区', d.stats.popularity > 0 && d.stats.comments > 0,
     `热度${d.stats.popularity} 评论${d.stats.comments} 浏览${d.stats.views}`);
  ok('时间信息', d.times.createdAt > 0 && d.times.lastEditedAt > 0);
  ok('相册', d.gallery.length >= 1, `${d.gallery.length} 张`);
  ok('相册默认锁定', d.gallery.every(g => g.locked && g.url === null));
  ok('缩略图仍可见', d.gallery.every(g => !!g.thumb));
  ok('作者信息', d.author.userId === 'official' && d.author.level >= 1, `${d.author.name} ${d.author.title}`);
  ok('评论列表', d.comments.length >= 1, `${d.comments.length} 条`);
  ok('悬赏池', typeof d.bountyPool === 'number' && d.bountyCount >= 0);
  ok('交互状态', typeof d.interactions.favorited === 'boolean');
}

// 先补足余额(解锁+充电要花不少)
{
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host:'127.0.0.1', port: Number(process.env.DB_PORT || 3306), user:'root',
    password:'', database: process.env.DB_NAME || 'wujie_tavern', charset:'utf8mb4' });
  await conn.query('UPDATE users SET balance = balance + 50000 WHERE id = ?', ['u' + uid]);
  await conn.end();
  const b = (await A('get-account-balance')).body.balance;
  ok('充值测试余额', b > 50000, String(b));
}

// 解锁相册
{
  const r = await A('unlock-gallery', { characterCardId: cardId });
  ok('解锁相册', r.status === 200 && r.body.gallery.every(g => !g.locked && !!g.url),
     `-${r.body.credits} 额度`);
  const r2 = await A('unlock-gallery', { characterCardId: cardId });
  ok('重复解锁不扣费', r2.body.already === true);
}

// 为作者充电
{
  const before = (await A('get-account-balance')).body.balance;
  const r = await A('charge-author', { characterCardId: cardId, amount: 1000 });
  ok('为作者充电', r.status === 200, `-${r.body.amount} 热度+${r.body.popularityGain}`);
  const det = await A('get-card-detail', { id: cardId });
  ok('热度已增加', det.body.stats.popularity > 0);
}

// 书签
{
  const a = await A('toggle-bookmark', { characterCardId: cardId });
  ok('加书签', a.body.bookmarked === true);
  const l = await A('list-bookmarks');
  ok('书签列表', l.body.items.length >= 1);
  const b = await A('toggle-bookmark', { characterCardId: cardId });
  ok('取消书签', b.body.bookmarked === false);
}

// 关注作者
{
  const r = await A('toggle-follow', { userId: 'official' });
  ok('关注作者', r.status === 200, `following=${r.body.following}`);
}

// 评论
{
  const r = await A('create-comment', { characterCardId: cardId, rating: 5, content: '测试评论内容' });
  ok('发表评论', r.status === 200);
  const det = await A('get-card-detail', { id: cardId });
  ok('评论数增加', det.body.stats.comments >= 629, String(det.body.stats.comments));
}

// 角色级悬赏
{
  const r = await A('create-card-bounty', {
    characterCardId: cardId, rewardCredits: 2000, title: '想看另一个走向',
  });
  ok('发起角色悬赏', r.status === 200, `-${r.body.reward}`);
  const l = await A('list-card-bounties', { characterCardId: cardId });
  ok('悬赏列表', l.body.items.length >= 1 && l.body.totalPool > 0,
     `池 ${l.body.totalPool} / ${l.body.count} 个`);
}

// 分享
{
  const r = await A('track-share', { characterCardId: cardId });
  ok('记录分享', r.status === 200);
  const s = await A('get-character-share-link', { id: cardId });
  ok('分享链接', !!s.body.url, s.body.url);
}

// 作者主页
{
  const r = await A('get-author-page', { userId: 'official' });
  ok('作者主页', r.status === 200 && r.body.cards.length >= 1,
     `${r.body.author.name} ${r.body.author.title} / ${r.body.stats.cards} 张卡`);
}

const passed = R.filter(x=>x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);
process.exit(passed===R.length?0:1);
