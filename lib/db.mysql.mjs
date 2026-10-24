// MySQL 数据访问层
import mysql from 'mysql2/promise';

export const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wujie_tavern',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+08:00',
  supportBigNumbers: true,
  bigNumberStrings: false,
};

export const pool = mysql.createPool(config);

export async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
export async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}
export async function exec(sql, params = []) {
  const [r] = await pool.execute(sql, params);
  return r;
}

export async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export const now = () => Date.now();

export function rid(n = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = Buffer.alloc(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (let i = 0; i < n; i++) s += chars[buf[i] % chars.length];
  return s;
}

// ---------- 用户 ----------
export async function findUserById(id) {
  return q1('SELECT * FROM users WHERE id = ?', [id]);
}
export async function findUserByTelegram(tgId) {
  return q1('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
}

export async function createUser(tg, initialCredits = 2000) {
  const id = tg?.id ? 'u' + tg.id : 'u' + rid(16);
  const t = now();
  await exec(
    `INSERT INTO users (id, telegram_id, first_name, last_name, username, language_code, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, tg?.id ?? null, tg?.first_name ?? '旅行者', tg?.last_name ?? '',
     tg?.username ?? '', tg?.language_code ?? 'zh-hans', initialCredits, t, t]
  );
  await exec(
    `INSERT INTO credit_history (user_id, type, amount, balance, note, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, 'signup_bonus', initialCredits, initialCredits, '注册奖励', t]
  );
  // 初始化任务
  const tasks = [
    ['first_chat', 300, '完成第一次对话', 0],
    ['browse_cards', 100, '浏览 5 张角色卡', 1],
    ['daily_checkin', 200, '今日签到', 0],
    ['invite_friend', 800, '邀请一位好友', 0],
  ];
  for (const [key, reward, title, done] of tasks) {
    await exec(
      `INSERT INTO user_tasks (user_id, task_key, done, claimed, updated_at) VALUES (?,?,?,0,?)`,
      [id, key, done, t]
    );
  }
  return findUserById(id);
}

export async function addCredits(userId, amount, type, note = '') {
  return withTx(async conn => {
    const [rows] = await conn.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!rows.length) throw new Error('user not found');
    const balance = rows[0].balance + amount;
    if (balance < 0) throw new Error('INSUFFICIENT_CREDITS');
    const t = now();
    await conn.query('UPDATE users SET balance = ?, updated_at = ? WHERE id = ?', [balance, t, userId]);
    await conn.query(
      'INSERT INTO credit_history (user_id, type, amount, balance, note, created_at) VALUES (?,?,?,?,?,?)',
      [userId, type, amount, balance, note, t]
    );
    return balance;
  });
}

// ---------- apiKey ----------
export async function issueApiKey(userId) {
  const key = 'sk_xc_' + Buffer.from(
    Array.from({ length: 24 }, () => Math.floor(Math.random() * 256))
  ).toString('hex');
  const t = now();
  await exec('INSERT INTO api_keys (api_key, user_id, created_at, last_seen) VALUES (?,?,?,?)',
    [key, userId, t, t]);
  return key;
}

export async function userByApiKey(key) {
  const row = await q1(
    `SELECT u.* FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.api_key = ? AND k.revoked = 0 LIMIT 1`, [key]);
  if (row) await exec('UPDATE api_keys SET last_seen = ? WHERE api_key = ?', [now(), key]);
  return row;
}

// ---------- 角色卡 ----------
export function cardView(row) {
  let tags = [];
  try { tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []); } catch {}
  return {
    id: row.id,
    status: row.status,
    moderationStatus: row.moderation_status,
    popularity: row.popularity,
    popularityTier: row.popularity_tier,
    createdBy: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settingsCharCount: row.settings_char_count,
    worldBookCharCount: row.world_book_char_count,
    data: {
      name: row.name,
      nickname: row.nickname,
      tier: row.tier,
      tags,
      creator: row.creator,
      creator_notes: row.creator_notes,
      gender: row.gender,
      avatarUrl: row.avatar_url,
      posterUrl: row.poster_url,
      character_version: row.character_version,
    },
  };
}
