// 用户系统端点
import { q, q1, exec, now, addCredits, rid } from './db.mysql.mjs';
import {
  register, login, listSessions, revokeSession, revokeAllExcept,
  getMembership, subscribe, getInviteStats, ensureInviteCode, audit,
} from './users.mjs';

function userView(u) {
  return {
    userId: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    username: u.username,
    languageCode: u.language_code,
    telegramId: u.telegram_id,
    status: u.status,
    balance: u.balance,
    member: !!u.member,
    memberUntil: Number(u.member_until),
    inviteCode: u.invite_code,
    invitedBy: u.invited_by,
    checkinStreak: u.checkin_streak,
    lastCheckinAt: Number(u.last_checkin_at),
    lastLoginAt: Number(u.last_login_at || 0),
    createdAt: Number(u.created_at),
  };
}

export const userActions = {
  // 当前用户资料
  'get-user-profile': async ({ user }) => {
    const u = await q1('SELECT * FROM users WHERE id = ?', [user.id]);
    const v = userView(u);
    const fav = await q1('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?', [user.id]);
    const chats = await q1('SELECT COUNT(*) AS c FROM archives WHERE user_id = ?', [user.id]);
    const inv = await q1('SELECT COUNT(*) AS c FROM invites WHERE inviter_id = ?', [user.id]);
    return {
      ...v,
      firstRechargeDone: !!(await q1('SELECT first_recharge FROM users WHERE id = ?', [user.id]))?.first_recharge,
      favoritesCount: fav.c,
      chatCount: chats.c,
      invitedCount: inv.c,
    };
  },

  'update-user-profile': async ({ user }, body) => {
    const allow = { firstName: 'first_name', lastName: 'last_name', languageCode: 'language_code' };
    for (const [k, col] of Object.entries(allow)) {
      const v = body[k];
      if (typeof v === 'string' && v.trim()) {
        await exec(`UPDATE users SET ${col} = ?, updated_at = ? WHERE id = ?`,
          [v.trim().slice(0, 64), now(), user.id]);
      }
    }
    await audit(user.id, 'update_profile', user.id, body);
    return { success: true };
  },

  'get-account-balance': async ({ user }) => {
    const u = await q1('SELECT balance, member, member_until FROM users WHERE id = ?', [user.id]);
    return {
      balance: u.balance,
      member: !!u.member && Number(u.member_until) > now(),
      bonusRate: (!!u.member && Number(u.member_until) > now()) ? 66 : 0,
    };
  },

  // 邀请
  'get-invite-code': async ({ user }) => ({ code: await ensureInviteCode(user.id) }),
  'get-invite-stats': async ({ user }) => getInviteStats(user.id),
  'bind-invite-code': async ({ user }, body) => {
    const u = await q1('SELECT invited_by, created_at FROM users WHERE id = ?', [user.id]);
    if (u.invited_by) return { __status: 400, error: '你已经绑定过邀请码了。' };
    if (now() - Number(u.created_at) > 7 * 86400000) {
      return { __status: 400, error: '注册超过 7 天,无法绑定邀请码。' };
    }
    const inviter = await q1('SELECT id FROM users WHERE invite_code = ?', [String(body.code || '').toUpperCase()]);
    if (!inviter) return { __status: 404, error: '邀请码无效。' };
    if (inviter.id === user.id) return { __status: 400, error: '不能绑定自己的邀请码。' };
    await exec('UPDATE users SET invited_by = ? WHERE id = ?', [inviter.id, user.id]);
    await exec(
      `INSERT INTO invites (inviter_id, invitee_id, code, reward_inviter, reward_invitee, status, created_at)
       VALUES (?,?,?,800,500,'settled',?)`,
      [inviter.id, user.id, body.code, now()]);
    await addCredits(inviter.id, 800, 'invite_reward', '邀请奖励');
    await addCredits(user.id, 500, 'invite_bonus', '受邀奖励');
    return { success: true, inviterReward: 800, inviteeReward: 500 };
  },

  // 会话
  'list-sessions': async ({ user }) => ({ items: await listSessions(user.id) }),
  'revoke-session': async ({ user }, body) => {
    try { return await revokeSession(user.id, body.sessionId); }
    catch (e) { return { __status: 404, error: e.message || '会话不存在' }; }
  },
  'revoke-other-sessions': async ({ user }, body) => revokeAllExcept(user.id, body.keepSessionId),

  // 会员
  'get-membership': async ({ user }) => getMembership(user.id),
  'subscribe-membership': async ({ user }, body) => subscribe(user.id, body.plan || 'monthly'),

  // 账号注销:软删除用户,清理关联数据避免重新注册时唯一键冲突
  'delete-account': async ({ user }, body) => {
    if (body.confirm !== true) return { __status: 400, error: '需要确认。' };
    await exec("UPDATE users SET status='deleted', updated_at=? WHERE id=?", [now(), user.id]);
    await exec('UPDATE api_keys SET revoked=1 WHERE user_id=?', [user.id]);
    await exec('UPDATE sessions SET revoked=1 WHERE user_id=?', [user.id]);
    // 清理会撞唯一键的业务数据
    for (const sql of [
      'DELETE FROM user_tasks WHERE user_id=?',
      'DELETE FROM favorites WHERE user_id=?',
      'DELETE FROM likes WHERE user_id=?',
      'DELETE FROM bookmarks WHERE user_id=?',
      'DELETE FROM follows WHERE follower_id=?',
      'DELETE FROM personas WHERE user_id=?',
      'DELETE FROM user_settings WHERE user_id=?',
      'DELETE FROM user_preferences WHERE user_id=?',
      'DELETE FROM knowledge_memories WHERE user_id=?',
      'DELETE FROM knowledge_entries WHERE user_id=?',
    ]) {
      try { await exec(sql, [user.id]); } catch {}
    }
    await audit(user.id, 'delete_account', user.id);
    return { success: true };
  },

  // 审计
  'list-my-audit': async ({ user }, body) => {
    const rows = await q(
      `SELECT action, target, ip, created_at AS at FROM audit_logs
       WHERE actor_id = ? ORDER BY id DESC LIMIT ?`, [user.id, Math.min(100, Number(body.limit) || 30)]);
    return { items: rows.map(r => ({ ...r, at: Number(r.at) })) };
  },
};

// ================= 管理后台 API =================
export const adminActions = {
  'admin:stats': async () => {
    const users = await q1('SELECT COUNT(*) AS c FROM users');
    const today = new Date().setHours(0, 0, 0, 0);
    const newUsers = await q1('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [today]);
    const activeUsers = await q1('SELECT COUNT(*) AS c FROM sessions WHERE last_seen >= ? AND revoked = 0', [Date.now() - 86400000]);
    const cards = await q1("SELECT COUNT(*) AS c FROM character_cards WHERE status='public'");
    const orders = await q1("SELECT COUNT(*) AS c, COALESCE(SUM(price),0) AS s FROM orders WHERE status='paid'");
    const credits = await q1('SELECT COALESCE(SUM(balance),0) AS s FROM users');
    const msgs = await q1('SELECT COUNT(*) AS c FROM messages');
    const llm = await q1('SELECT COUNT(*) AS c, COALESCE(SUM(completion_tokens),0) AS t FROM llm_logs');
    return {
      users: users.c, newUsersToday: newUsers.c, activeUsers24h: activeUsers.c,
      cards: cards.c, paidOrders: orders.c, revenue: Number(orders.s),
      totalCredits: Number(credits.s), messages: msgs.c,
      llmCalls: llm.c, llmTokens: Number(llm.t),
    };
  },

  'admin:list-users': async (ctx, body) => {
    const limit = Math.min(100, Number(body.limit) || 30);
    const offset = Math.max(0, Number(body.offset) || 0);
    const kw = body.keyword ? `%${body.keyword}%` : null;
    const where = kw ? 'WHERE first_name LIKE ? OR username LIKE ? OR id LIKE ?' : '';
    const params = kw ? [kw, kw, kw, limit, offset] : [limit, offset];
    const rows = await q(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);
    const total = await q1(`SELECT COUNT(*) AS c FROM users ${where}`, kw ? [kw, kw, kw] : []);
    return { items: rows.map(userView), total: total.c };
  },

  'admin:get-user': async (ctx, body) => {
    const u = await q1('SELECT * FROM users WHERE id = ?', [body.userId]);
    if (!u) return { __status: 404, error: '用户不存在' };
    const hist = await q(
      'SELECT type, amount, balance, note, created_at AS at FROM credit_history WHERE user_id = ? ORDER BY id DESC LIMIT 30',
      [body.userId]);
    const sess = await listSessions(body.userId);
    const invite = await q1('SELECT COUNT(*) AS c FROM invites WHERE inviter_id = ?', [body.userId]);
    return {
      user: userView(u),
      credits: hist.map(h => ({ ...h, at: Number(h.at) })),
      sessions: sess,
      invitedCount: invite.c,
    };
  },

  'admin:adjust-credits': async (ctx, body) => {
    const amount = Math.trunc(Number(body.amount));
    if (!Number.isFinite(amount) || amount === 0) return { __status: 400, error: '金额无效' };
    const balance = await addCredits(body.userId, amount, 'admin_adjust', body.note || '管理员调整');
    await audit('admin', 'adjust_credits', body.userId, { amount, note: body.note }, null, 'admin');
    return { success: true, balance };
  },

  'admin:ban-user': async (ctx, body) => {
    const { banUser } = await import('./users.mjs');
    await banUser('admin', body.userId, body.reason || '违规');
    return { success: true };
  },

  'admin:unban-user': async (ctx, body) => {
    const { unbanUser } = await import('./users.mjs');
    await unbanUser('admin', body.userId);
    return { success: true };
  },

  'admin:audit-logs': async (ctx, body) => {
    const rows = await q(
      `SELECT actor_id, actor_type, action, target, ip, created_at AS at
       FROM audit_logs ORDER BY id DESC LIMIT ?`, [Math.min(200, Number(body.limit) || 50)]);
    return { items: rows.map(r => ({ ...r, at: Number(r.at) })) };
  },
};
