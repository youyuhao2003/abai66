// 用户系统:注册 / 登录 / 会话 / 邀请 / 会员 / 封禁 / 审计
import crypto from 'node:crypto';
import { q, q1, exec, withTx, now, rid, addCredits } from './db.mysql.mjs';
import { cfgInt } from './config.mjs';

// ---------- 密码 ----------
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { hash, salt };
}
export function verifyPassword(password, hash, salt) {
  const calc = crypto.scryptSync(password, salt, 32).toString('hex');
  if (calc.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
}

// ---------- 邀请码 ----------
export function genInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function ensureInviteCode(userId) {
  const u = await q1('SELECT invite_code FROM users WHERE id = ?', [userId]);
  if (u?.invite_code) return u.invite_code;
  for (let i = 0; i < 10; i++) {
    const code = genInviteCode();
    try {
      await exec('UPDATE users SET invite_code = ? WHERE id = ?', [code, userId]);
      return code;
    } catch { /* 冲突重试 */ }
  }
  throw new Error('cannot allocate invite code');
}

// ---------- 注册 ----------
/**
 * register({ telegramId, firstName, lastName, username, languageCode, invitedBy, ip })
 */
export async function register(profile, opts = {}) {
  const { invitedBy = null, ip = '', clientId = '', userAgent = '', platform = '' } = opts;

  if (profile?.telegramId) {
    const exist = await q1('SELECT * FROM users WHERE telegram_id = ?', [profile.telegramId]);
    if (exist) {
      if (exist.status === 'banned') throw Object.assign(new Error('账号已被封禁'), { code: 'BANNED' });
      return { user: exist, created: false };
    }
  }

  return withTx(async conn => {
    const id = profile?.telegramId ? 'u' + profile.telegramId : 'u' + rid(16);
    const t = now();
    const inviteCode = genInviteCode();

    // 处理邀请
    let inviter = null;
    if (invitedBy) {
      const [rows] = await conn.query('SELECT * FROM users WHERE invite_code = ? LIMIT 1', [invitedBy]);
      inviter = rows[0] ?? null;
    }

    // 注册赠送额度:读后台配置(必须在 INSERT 之前声明)
    const signupBonus = await cfgInt('economy.signupBonus', 2000).catch(() => 2000);
    const base = signupBonus;

    await conn.query(
      `INSERT INTO users
       (id, telegram_id, first_name, last_name, username, language_code, photo_url, status,
        invite_code, invited_by, last_ip, last_login_at, balance, created_at, updated_at)
       VALUES (?,?,?,?,?,?,NULL,'active',?,?,?,?,?,?,?)`,
      [id, profile?.telegramId ?? null, profile?.firstName ?? '旅行者',
       profile?.lastName ?? '', profile?.username ?? '', profile?.languageCode ?? 'zh-hans',
       inviteCode, inviter?.id ?? null, ip, t, signupBonus, t, t]
    );

    // 初始额度记录
    await conn.query(
      `INSERT INTO credit_history (user_id, type, amount, balance, note, created_at)
       VALUES (?,?,?,?,?,?)`, [id, 'signup_bonus', base, base, '注册奖励', t]);

    // 邀请奖励
    if (inviter) {
      const inviterReward = 800, inviteeReward = 500;
      await conn.query(
        `INSERT INTO invites (inviter_id, invitee_id, code, reward_inviter, reward_invitee, status, created_at)
         VALUES (?,?,?,?,?,'settled',?)`,
        [inviter.id, id, invitedBy, inviterReward, inviteeReward, t]);
      await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [inviterReward, inviter.id]);
      await conn.query(
        `INSERT INTO credit_history (user_id, type, amount, balance, note, created_at)
         SELECT id, 'invite_reward', ?, balance, ?, ? FROM users WHERE id = ?`,
        [inviterReward, '邀请奖励 · ' + id, t, inviter.id]);
      await conn.query(
        `INSERT INTO credit_history (user_id, type, amount, balance, note, created_at)
         SELECT id, 'invite_bonus', ?, balance, ?, ? FROM users WHERE id = ?`,
        [inviteeReward, '受邀奖励', t, id]);
      await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [inviteeReward, id]);
    }

    // 初始化任务(注销后重新注册时可能有残留,用 upsert 覆盖)
    const tasks = [
      ['first_chat', 0], ['browse_cards', 1], ['daily_checkin', 0], ['invite_friend', 0],
    ];
    for (const [key, done] of tasks) {
      await conn.query(
        `INSERT INTO user_tasks (user_id, task_key, done, claimed, updated_at) VALUES (?,?,?,0,?)
         ON DUPLICATE KEY UPDATE done=VALUES(done), claimed=0, updated_at=VALUES(updated_at)`,
        [id, key, done, t]);
    }

    await conn.query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target, detail, ip, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [id, 'user', 'register', id, JSON.stringify({ invitedBy, platform }), ip, t]);

    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [id]);
    return { user: rows[0], created: true };
  });
}

// ---------- 登录(签发会话) ----------
export async function login(user, ctx = {}) {
  const { ip = '', userAgent = '', platform = '', clientId = '' } = ctx;
  const t = now();

  if (user.status === 'banned') {
    throw Object.assign(new Error('账号已被封禁'), { code: 'BANNED', reason: user.ban_reason });
  }
  if (user.status === 'deleted') {
    throw Object.assign(new Error('账号不存在'), { code: 'GONE' });
  }

  const apiKey = 'sk_xc_' + crypto.randomBytes(24).toString('hex');
  const sessionId = 'sess_' + rid(20);

  await withTx(async conn => {
    await conn.query(
      `INSERT INTO api_keys (api_key, user_id, created_at, last_seen) VALUES (?,?,?,?)`,
      [apiKey, user.id, t, t]);
    await conn.query(
      `INSERT INTO sessions (id, user_id, api_key, device_name, platform, user_agent, ip, client_id, created_at, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [sessionId, user.id, apiKey, deviceName(userAgent), platform, userAgent.slice(0, 500), ip, clientId, t, t]);
    await conn.query('UPDATE users SET last_login_at = ?, last_ip = ?, updated_at = ? WHERE id = ?',
      [t, ip, t, user.id]);
    await conn.query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target, detail, ip, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [user.id, 'user', 'login', sessionId, JSON.stringify({ platform }), ip, t]);
  });

  return { apiKey, userId: user.id, sessionId };
}

function deviceName(ua = '') {
  if (/iPhone|iPad/i.test(ua)) return 'iOS 设备';
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/Windows/i.test(ua)) return 'Windows 桌面';
  if (/Macintosh/i.test(ua)) return 'macOS 桌面';
  if (/Linux/i.test(ua)) return 'Linux 设备';
  return '未知设备';
}

// ---------- 会话管理 ----------
export async function listSessions(userId) {
  const rows = await q(
    `SELECT id, device_name, platform, ip, created_at, last_seen, revoked
     FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50`, [userId]);
  return rows.map(r => ({
    id: r.id, deviceName: r.device_name, platform: r.platform, ip: r.ip,
    createdAt: Number(r.created_at), lastSeen: Number(r.last_seen), revoked: !!r.revoked,
  }));
}

export async function revokeSession(userId, sessionId) {
  const s = await q1('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!s) throw new Error('会话不存在');
  await withTx(async conn => {
    await conn.query('UPDATE sessions SET revoked = 1 WHERE id = ?', [sessionId]);
    await conn.query('UPDATE api_keys SET revoked = 1 WHERE api_key = ?', [s.api_key]);
    await conn.query('INSERT INTO revoked_keys (api_key, revoked_at, reason) VALUES (?,?,?)',
      [s.api_key, now(), 'user_revoked']);
  });
  return { success: true };
}

export async function revokeAllExcept(userId, keepSessionId) {
  const rows = await q('SELECT id, api_key FROM sessions WHERE user_id = ? AND revoked = 0 AND id <> ?',
    [userId, keepSessionId || '']);
  await withTx(async conn => {
    for (const r of rows) {
      await conn.query('UPDATE sessions SET revoked = 1 WHERE id = ?', [r.id]);
      await conn.query('UPDATE api_keys SET revoked = 1 WHERE api_key = ?', [r.api_key]);
    }
  });
  return { success: true, revoked: rows.length };
}

// ---------- 会员 ----------
export async function getMembership(userId) {
  const u = await q1('SELECT member, member_until FROM users WHERE id = ?', [userId]);
  const active = !!u.member && Number(u.member_until) > now();
  const last = await q1(
    'SELECT * FROM memberships WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
  return {
    member: active,
    expiresAt: Number(u.member_until),
    plan: last?.plan ?? null,
    benefits: { bonusRate: active ? 66 : 0, dailyCheckin: active ? 2000 : 800 },
  };
}

export async function subscribe(userId, plan = 'monthly', orderId = null) {
  const PLANS = {
    monthly: { days: 30, price: 9.9 },
    quarterly: { days: 90, price: 25.9 },
    yearly: { days: 365, price: 88.0 },
  };
  const p = PLANS[plan];
  if (!p) throw new Error('未知套餐');

  return withTx(async conn => {
    const [rows] = await conn.query('SELECT member_until FROM users WHERE id = ? FOR UPDATE', [userId]);
    const cur = Number(rows[0].member_until) || 0;
    const start = Math.max(cur, now());
    const expires = start + p.days * 86400000;
    await conn.query('UPDATE users SET member = 1, member_until = ?, updated_at = ? WHERE id = ?',
      [expires, now(), userId]);
    await conn.query(
      `INSERT INTO memberships (user_id, plan, price, days, started_at, expires_at, status, order_id)
       VALUES (?,?,?,?,?,?,'active',?)`,
      [userId, plan, p.price, p.days, start, expires, orderId]);
    return { success: true, plan, expiresAt: expires, days: p.days, price: p.price };
  });
}

// ---------- 邀请 ----------
export async function getInviteStats(userId) {
  const code = await ensureInviteCode(userId);
  const total = await q1('SELECT COUNT(*) AS c FROM invites WHERE inviter_id = ?', [userId]);
  const reward = await q1(
    'SELECT COALESCE(SUM(reward_inviter),0) AS s FROM invites WHERE inviter_id = ?', [userId]);
  const recent = await q(
    `SELECT i.invitee_id, i.created_at, u.first_name
     FROM invites i LEFT JOIN users u ON u.id = i.invitee_id
     WHERE i.inviter_id = ? ORDER BY i.id DESC LIMIT 20`, [userId]);
  return {
    code,
    totalInvited: total.c,
    totalReward: Number(reward.s),
    recent: recent.map(r => ({
      userId: r.invitee_id, name: r.first_name, at: Number(r.created_at),
    })),
  };
}

// ---------- 封禁 ----------
export async function banUser(actorId, targetId, reason) {
  await withTx(async conn => {
    await conn.query(
      "UPDATE users SET status='banned', ban_reason=?, banned_at=?, updated_at=? WHERE id=?",
      [reason, now(), now(), targetId]);
    await conn.query('UPDATE api_keys SET revoked=1 WHERE user_id=?', [targetId]);
    await conn.query('UPDATE sessions SET revoked=1 WHERE user_id=?', [targetId]);
    await conn.query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target, detail, created_at)
       VALUES (?,?,?,?,?,?)`,
      [actorId, 'admin', 'ban_user', targetId, JSON.stringify({ reason }), now()]);
  });
  return { success: true };
}

export async function unbanUser(actorId, targetId) {
  await withTx(async conn => {
    await conn.query(
      "UPDATE users SET status='active', ban_reason=NULL, banned_at=NULL, updated_at=? WHERE id=?",
      [now(), targetId]);
    await conn.query(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target, created_at)
       VALUES (?,?,?,?,?)`, [actorId, 'admin', 'unban_user', targetId, now()]);
  });
  return { success: true };
}

// ---------- 审计 ----------
export async function audit(actorId, action, target = null, detail = null, ip = null, actorType = 'user') {
  try {
    await exec(
      `INSERT INTO audit_logs (actor_id, actor_type, action, target, detail, ip, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [actorId, actorType, action, target, detail ? JSON.stringify(detail) : null, ip, now()]);
  } catch {}
}
