// 角色卡详情页端点
import { q, q1, exec, withTx, now, rid, addCredits } from './db.mysql.mjs';
import { viewCard, safeJson } from './actions_part1.mjs';
import { calcPopularity, popularityTier, TIER_LABELS } from './popularity.mjs';

const AUTHOR_TITLES = [
  [0, '初出茅庐'], [10, '小有名气'], [50, '一方名家'], [200, '文坛巨擘'],
  [500, '一代宗师'], [1000, '帝师太傅'], [2000, '传奇作者'],
];

function authorTitle(level) {
  let t = '初出茅庐';
  for (const [lv, name] of AUTHOR_TITLES) if (level >= lv) t = name;
  return t;
}

export const cardDetailActions = {
  /** 详情页聚合数据:一次拿到所有区块 */
  'get-card-detail': async ({ user }, body) => {
    const id = body.id || body.characterCardId;
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [id]);
    if (!r) return { __status: 404, error: '角色卡不存在' };
    if (r.is_banned) {
      return { __status: 403, error: r.ban_reason || '该角色已下架', banned: true };
    }

    await exec('UPDATE character_cards SET view_count = view_count + 1 WHERE id=?', [r.id]);

    // 相册
    const gallery = await q(
      'SELECT * FROM character_gallery WHERE character_card_id=? ORDER BY sort, id', [r.id]);

    // 是否解锁
    let unlocked = false;
    if (user) {
      const u = await q1('SELECT * FROM gallery_unlocks WHERE user_id=? AND character_card_id=?',
        [user.id, r.id]);
      unlocked = !!u;
    }

    // 作者
    const ownerId = r.owner_id;
    let author = await q1('SELECT id, first_name, username, photo_url FROM users WHERE id=?', [ownerId]);
    if (!author) author = { id: ownerId, first_name: '无界创镜官方', username: 'official', photo_url: null };
    const lvl = await q1('SELECT * FROM author_levels WHERE user_id=?', [ownerId]);
    const authorCards = await q1(
      "SELECT COUNT(*) c FROM character_cards WHERE owner_id=? AND status='public'", [ownerId]);

    // 评论
    const comments = await q(
      `SELECT c.*, u.first_name FROM card_reviews c LEFT JOIN users u ON u.id=c.user_id
       WHERE c.character_card_id=? ORDER BY c.is_pinned DESC, c.id DESC LIMIT 20`, [r.id]);
    const commentAgg = await q1(
      'SELECT COUNT(*) c, COALESCE(AVG(rating),0) a FROM card_reviews WHERE character_card_id=?', [r.id]);

    // 悬赏池
    const bounties = await q(
      'SELECT * FROM card_bounties WHERE character_card_id=? AND status=? ORDER BY id DESC LIMIT 10',
      [r.id, 'open']);

    // 用户交互状态
    let liked = false, favorited = false, bookmarked = false, followed = false;
    if (user) {
      liked = !!(await q1("SELECT id FROM likes WHERE user_id=? AND target_type='card' AND target_id=?",
        [user.id, r.id]));
      favorited = !!(await q1('SELECT id FROM favorites WHERE user_id=? AND character_card_id=?',
        [user.id, r.id]));
      bookmarked = !!(await q1('SELECT id FROM bookmarks WHERE user_id=? AND character_card_id=?',
        [user.id, r.id]));
      followed = !!(await q1('SELECT id FROM follows WHERE follower_id=? AND following_id=?',
        [user.id, ownerId]));
    }

    // 我的会话(如果聊过)
    let archive = null;
    if (user) {
      const a = await q1(
        `SELECT id, message_count, updated_at FROM archives
         WHERE user_id=? AND character_card_id=? AND deleted=0`, [user.id, r.id]);
      if (a) archive = { id: a.id, messageCount: a.message_count, updatedAt: Number(a.updated_at) };
    }

    const card = viewCard(r);

    return {
      success: true,
      card,
      stats: (() => { const p = calcPopularity({
          likes: r.like_count, favorites: r.favorite_count, comments: r.comment_count,
          chats: r.chat_count, views: r.view_count });
        const t = popularityTier(p);
        return {
          popularity: p, popularityTier: t, tierLabel: TIER_LABELS[t],
          comments: r.comment_count || 0,
          rating: Number(commentAgg.a),
          views: r.view_count, likes: r.like_count, favorites: r.favorite_count,
          chats: r.chat_count, bookmarks: r.bookmark_count, shares: r.share_count,
        };
      })(),
      times: {
        createdAt: Number(r.created_at),
        firstPublishedAt: r.first_published_at ? Number(r.first_published_at) : null,
        lastEditedAt: r.last_edited_at ? Number(r.last_edited_at) : null,
      },
      gallery: gallery.map(g => ({
        id: g.id,
        url: unlocked ? g.url : null,
        thumb: g.url,
        caption: g.caption,
        unlockCredits: g.unlock_credits,
        locked: !unlocked,
      })),
      galleryUnlocked: unlocked,
      author: {
        userId: ownerId,
        name: author?.first_name || '匿名',
        avatarUrl: author?.photo_url || null,
        level: lvl?.level ?? 1,
        title: lvl?.title || authorTitle(lvl?.level ?? 1),
        cards: authorCards.c,
        following: followed,
      },
      comments: comments.map(c => ({
        id: c.id, userId: c.user_id, userName: c.first_name || '用户',
        rating: c.rating, content: c.content, pinned: !!c.is_pinned,
        likes: c.likes, at: Number(c.created_at),
      })),
      bounties: bounties.map(b => ({
        id: b.id, title: b.title, rewardCredits: b.reward_credits, at: Number(b.created_at),
      })),
      bountyPool: r.bounty_pool,
      bountyCount: r.bounty_count,
      authorCharged: r.author_charged,
      interactions: { liked, favorited, bookmarked, followed },
      archive,
    };
  },

  /** 解锁相册 */
  'unlock-gallery': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!r) return { __status: 404, error: '角色卡不存在' };

    const exist = await q1('SELECT * FROM gallery_unlocks WHERE user_id=? AND character_card_id=?',
      [user.id, r.id]);
    if (exist) return { success: true, already: true };

    const imgs = await q(
      'SELECT unlock_credits FROM character_gallery WHERE character_card_id=?', [r.id]);
    if (!imgs.length) return { __status: 400, error: '该角色暂无相册' };
    const cost = imgs.reduce((s, x) => s + (x.unlock_credits || 0), 0) || 500;

    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: `需要 ${cost} 额度` };

    await exec('INSERT INTO gallery_unlocks (user_id, character_card_id, unlocked_all, created_at) VALUES (?,?,1,?)',
      [user.id, r.id, now()]);
    const balance = await addCredits(user.id, -cost, 'gallery', '解锁角色相册');

    const gallery = await q(
      'SELECT * FROM character_gallery WHERE character_card_id=? ORDER BY sort, id', [r.id]);
    return {
      success: true, credits: cost, balance,
      gallery: gallery.map(g => ({
        id: g.id, url: g.url, caption: g.caption, unlockCredits: g.unlock_credits, locked: false,
      })),
    };
  },

  /** 为作者充电 */
  'charge-author': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!r) return { __status: 404, error: '角色卡不存在' };
    if (r.owner_id === user.id) return { __status: 400, error: '不能给自己充电' };

    const amount = Math.min(100000, Math.max(1, Number(body.amount) || 0));
    if (!amount) return { __status: 400, error: '金额无效' };

    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < amount) return { __status: 402, error: '额度不足' };

    const gain = Math.floor(amount / 10);

    await exec(
      `INSERT INTO author_charges (user_id, author_id, character_card_id, amount, popularity_gain, created_at)
       VALUES (?,?,?,?,?,?)`, [user.id, r.owner_id, r.id, amount, gain, now()]);
    await exec(
      'UPDATE character_cards SET author_charged = author_charged + ?, popularity = popularity + ? WHERE id=?',
      [amount, gain, r.id]);
    await exec(
      `INSERT INTO author_levels (user_id, total_charge, updated_at) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE total_charge = total_charge + ?, updated_at = VALUES(updated_at)`,
      [r.owner_id, amount, now(), amount]);

    // 重算等级:只升不降
    const lvl = await q1('SELECT total_charge, level FROM author_levels WHERE user_id=?', [r.owner_id]);
    const byCharge = Math.max(1, Math.floor(Number(lvl.total_charge) / 1000));
    const newLevel = Math.max(Number(lvl.level) || 1, byCharge);
    await exec('UPDATE author_levels SET level=?, title=? WHERE user_id=?',
      [newLevel, authorTitle(newLevel), r.owner_id]);

    const balance = await addCredits(user.id, -amount, 'author_charge', '为作者充电');
    return { success: true, amount, popularityGain: gain, balance };
  },

  /** 书签 */
  'toggle-bookmark': async ({ user }, body) => {
    const id = body.characterCardId;
    if (!id) return { __status: 400, error: 'characterCardId is required' };
    const exist = await q1('SELECT id FROM bookmarks WHERE user_id=? AND character_card_id=?', [user.id, id]);
    if (exist) {
      await exec('DELETE FROM bookmarks WHERE id=?', [exist.id]);
      await exec('UPDATE character_cards SET bookmark_count=GREATEST(bookmark_count-1,0) WHERE id=?', [id]);
      return { success: true, bookmarked: false };
    }
    await exec('INSERT INTO bookmarks (user_id, character_card_id, created_at) VALUES (?,?,?)',
      [user.id, id, now()]);
    await exec('UPDATE character_cards SET bookmark_count=bookmark_count+1 WHERE id=?', [id]);
    return { success: true, bookmarked: true };
  },

  'list-bookmarks': async ({ user }) => {
    const rows = await q(
      `SELECT c.* FROM bookmarks b JOIN character_cards c ON c.id=b.character_card_id
       WHERE b.user_id=? ORDER BY b.id DESC`, [user.id]);
    return { success: true, items: rows.map(r => viewCard(r)) };
  },

  /** 记录分享 */
  'track-share': async ({ user }, body) => {
    if (!body.characterCardId) return { __status: 400, error: 'characterCardId is required' };
    await exec('UPDATE character_cards SET share_count=share_count+1 WHERE id=?', [body.characterCardId]);
    return { success: true };
  },

  /** 角色级悬赏 */
  'create-card-bounty': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!r) return { __status: 404, error: '角色卡不存在' };
    const reward = Math.min(100000, Math.max(100, Number(body.rewardCredits) || 1000));
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < reward) return { __status: 402, error: `需要 ${reward} 额度` };

    const id = 'cbty_' + rid(12);
    await addCredits(user.id, -reward, 'card_bounty', '发布角色悬赏');
    await exec(
      `INSERT INTO card_bounties (id, character_card_id, creator_id, title, reward_credits, status, created_at)
       VALUES (?,?,?,?,?,'open',?)`,
      [id, r.id, user.id, String(body.title || '悬赏').slice(0, 255), reward, now()]);
    await exec(
      'UPDATE character_cards SET bounty_pool = bounty_pool + ?, bounty_count = bounty_count + 1 WHERE id=?',
      [reward, r.id]);

    return { success: true, id, reward };
  },

  'list-card-bounties': async (ctx, body) => {
    const rows = await q(
      `SELECT b.*, u.first_name FROM card_bounties b LEFT JOIN users u ON u.id=b.creator_id
       WHERE b.character_card_id=? AND b.status='open' ORDER BY b.id DESC LIMIT 20`,
      [body.characterCardId]);
    const agg = await q1(
      'SELECT COALESCE(SUM(reward_credits),0) s, COUNT(*) c FROM card_bounties WHERE character_card_id=? AND status=?',
      [body.characterCardId, 'open']);
    return {
      success: true,
      items: rows.map(b => ({ id: b.id, title: b.title, rewardCredits: b.reward_credits,
        creatorName: b.first_name, at: Number(b.created_at) })),
      totalPool: Number(agg.s), count: agg.c,
    };
  },

  /** 评论 */
  'create-comment': async ({ user }, body) => {
    const content = String(body.content || '').trim().slice(0, 2000);
    if (!content) return { __status: 400, error: '请输入评论内容' };
    const rating = Math.min(5, Math.max(1, Number(body.rating) || 5));

    const exist = await q1('SELECT * FROM card_reviews WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    if (exist) {
      await exec('UPDATE card_reviews SET rating=?, content=?, updated_at=? WHERE id=?',
        [rating, content, now(), exist.id]);
      return { success: true, id: exist.id, updated: true };
    }
    await exec(
      'INSERT INTO card_reviews (user_id,character_card_id,rating,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [user.id, body.characterCardId, rating, content, now(), now()]);
    await exec('UPDATE character_cards SET comment_count = comment_count + 1 WHERE id=?',
      [body.characterCardId]);
    return { success: true, updated: false };
  },

  /** 作者主页 */
  'get-author-page': async ({ user }, body) => {
    const authorId = body.userId;
    let u = await q1('SELECT id, first_name, username, photo_url, created_at FROM users WHERE id=?', [authorId]);
    if (!u) {
      u = { id: authorId, first_name: '无界创镜官方', username: 'official', photo_url: null, created_at: now() };
    }

    const lvl = await q1('SELECT * FROM author_levels WHERE user_id=?', [authorId]);
    const cards = await q(
      "SELECT * FROM character_cards WHERE owner_id=? AND status='public' ORDER BY popularity DESC LIMIT 30",
      [authorId]);
    const agg = await q1(
      `SELECT COUNT(*) c, COALESCE(SUM(popularity),0) pop, COALESCE(SUM(like_count),0) likes,
              COALESCE(SUM(author_charged),0) charged
       FROM character_cards WHERE owner_id=? AND status='public'`, [authorId]);
    const followers = await q1('SELECT COUNT(*) c FROM follows WHERE following_id=?', [authorId]);

    let following = false;
    if (user) {
      following = !!(await q1('SELECT id FROM follows WHERE follower_id=? AND following_id=?',
        [user.id, authorId]));
    }

    return {
      success: true,
      author: {
        userId: u.id, name: u.first_name, username: u.username, avatarUrl: u.photo_url,
        level: lvl?.level ?? 1, title: lvl?.title || authorTitle(lvl?.level ?? 1),
        createdAt: Number(u.created_at), following,
      },
      stats: {
        cards: agg.c, popularity: Number(agg.pop), likes: Number(agg.likes),
        charged: Number(agg.charged), followers: followers.c,
      },
      cards: cards.map(r => viewCard(r)),
    };
  },
};
