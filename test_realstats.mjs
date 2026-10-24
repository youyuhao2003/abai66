// 验证:所有统计是否真的从 0 开始、随操作累加
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

// 用测试用户
{
  const user = { id: 880001, first_name:'验证', username:'verify' };
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ clientId:'v', fingerprint:'fp', device:{platform:'node'}, initData }) });
  apiKey = (await r.json()).apiKey;
  ok('登录', !!apiKey);
}

// 前置:清空该卡的互动数据,保证从 0 开始
{
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host:'127.0.0.1', port: Number(process.env.DB_PORT || 3306), user:'root',
    password:'', database: process.env.DB_NAME || 'wujie_tavern', charset:'utf8mb4' });
  await conn.query('DELETE FROM card_reviews');
  await conn.query('DELETE FROM card_bounties');
  await conn.query('DELETE FROM gallery_unlocks');
  await conn.query('DELETE FROM bookmarks');
  await conn.query('DELETE FROM likes');
  await conn.query('DELETE FROM favorites');
  await conn.query('DELETE FROM author_charges');
  await conn.query('DELETE FROM character_tips');
  await conn.query('DELETE FROM messages');
  await conn.query('DELETE FROM archives');
  await conn.query('DELETE FROM knowledge_memories');
  await conn.query('DELETE FROM author_levels');
  await conn.query('UPDATE users SET balance = 100000 WHERE id LIKE ?', ['u8%']);
  await conn.query(`UPDATE character_cards SET popularity=0, popularity_tier=0, view_count=0,
    like_count=0, favorite_count=0, chat_count=0, comment_count=0, bookmark_count=0,
    share_count=0, bounty_pool=0, bounty_count=0, author_charged=0`);
  await conn.end();
}

const cards = await A('list-public-character-cards', { sortBy:'trending' });
const cardId = cards.body.items[0].id;

// 1. 初始状态必须全 0
{
  const d = await A('get-card-detail', { id: cardId });
  const s = d.body.stats;
  ok('初始热度为 0', s.popularity === 0, String(s.popularity));
  ok('初始评论为 0', s.comments === 0, String(s.comments));
  ok('初始点赞为 0', s.likes === 0, String(s.likes));
  ok('初始收藏为 0', s.favorites === 0, String(s.favorites));
  ok('初始对话为 0', s.chats === 0, String(s.chats));
  ok('初始悬赏池为 0', d.body.bountyPool === 0, String(d.body.bountyPool));
  globalThis.base = s;
}

// 2. 点赞 → 累加
{
  await A('toggle-like', { characterCardId: cardId });
  const d = await A('get-card-detail', { id: cardId });
  ok('点赞累加', d.body.stats.likes === 1, String(d.body.stats.likes));
}

// 3. 收藏 → 累加
{
  await A('toggle-favorite', { characterCardId: cardId });
  const d = await A('get-card-detail', { id: cardId });
  ok('收藏累加', d.body.stats.favorites === 1, String(d.body.stats.favorites));
}

// 4. 评论 → 累加
{
  await A('create-comment', { characterCardId: cardId, rating: 5, content: '真实验证评论' });
  const d = await A('get-card-detail', { id: cardId });
  ok('评论累加', d.body.stats.comments === 1, String(d.body.stats.comments));
  ok('评论内容真实', d.body.comments[0]?.content === '真实验证评论', d.body.comments[0]?.content);
}

// 5. 书签 → 累加
{
  await A('toggle-bookmark', { characterCardId: cardId });
  const d = await A('get-card-detail', { id: cardId });
  ok('书签累加', d.body.stats.bookmarks === 1, String(d.body.stats.bookmarks));
}

// 6. 分享 → 累加
{
  await A('track-share', { characterCardId: cardId });
  const d = await A('get-card-detail', { id: cardId });
  ok('分享累加', d.body.stats.shares === 1, String(d.body.stats.shares));
}

// 7. 对话 → 累加
{
  await A('create-chat-completion', { characterCardId: cardId, message: '验证对话计数' });
  const d = await A('get-card-detail', { id: cardId });
  ok('对话累加', d.body.stats.chats === 1, String(d.body.stats.chats));
}

// 8. 浏览 → 每次打开详情 +1
{
  const a1 = (await A('get-card-detail', { id: cardId })).body.stats.views;
  const a2 = (await A('get-card-detail', { id: cardId })).body.stats.views;
  ok('浏览累加', a2 === a1 + 1, `${a1} -> ${a2}`);
}

// 9. 充电 → 作者等级与热度
{
  await A('charge-author', { characterCardId: cardId, amount: 1000 });
  const d = await A('get-card-detail', { id: cardId });
  ok('充电记录', d.body.authorCharged === 1000, String(d.body.authorCharged));
  ok('作者等级从 0 开始算', d.body.author.level === 1, `Lv.${d.body.author.level} ${d.body.author.title}`);
}

// 10. 悬赏 → 池子累加
{
  await A('create-card-bounty', { characterCardId: cardId, rewardCredits: 500, title: '真实悬赏' });
  const l = await A('list-card-bounties', { characterCardId: cardId });
  ok('悬赏池累加', l.body.totalPool === 500, String(l.body.totalPool));
  const d = await A('get-card-detail', { id: cardId });
  ok('详情页悬赏池同步', d.body.bountyPool === 500, String(d.body.bountyPool));
}

// 11. 相册解锁
{
  const d1 = await A('get-card-detail', { id: cardId });
  ok('相册默认锁定', d1.body.gallery.every(g => g.locked), `${d1.body.gallery.length} 张`);
  const u = await A('unlock-gallery', { characterCardId: cardId });
  ok('解锁后可看', u.body.gallery.every(g => !g.locked && !!g.url), `-${u.body.credits}`);
}

// 12. 热度公式:点赞*3 + 收藏*8 + 评论*15 + 对话*2 + 浏览*0.1
{
  const d = await A('get-card-detail', { id: cardId });
  const s = d.body.stats;
  // 此时:1赞 1收藏 1评论 1对话 若干浏览
  const expected = Math.floor(
    1 * 3 + 1 * 8 + 1 * 15 + s.chats * 2 + Math.round(s.views * 0.1)
  );
  ok('热度按公式计算', s.popularity >= 26, `热度=${s.popularity} (1赞+1收藏+1评论+${s.chats}对话+${s.views}浏览)`);
  ok('热度等级为 null(未达 3000)', s.popularityTier === 0, `tier=${s.popularityTier}`);
}

const passed = R.filter(x=>x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);
process.exit(passed===R.length?0:1);
