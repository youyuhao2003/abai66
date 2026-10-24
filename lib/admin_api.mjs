// 后台管理端点
import { q, q1, exec, now, rid, addCredits } from './db.mysql.mjs';
import { safeJson } from './actions_part1.mjs';
import { invalidate } from './config.mjs';

async function log(actor, action, target, detail, ip) {
  try {
    await exec(
      `INSERT INTO admin_logs (actor, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)`,
      [actor, action, target, detail ? JSON.stringify(detail) : null, ip, now()]);
  } catch {}
}

export const adminActions = {
  // ---------- 概览 ----------
  'overview': async () => {
    const today = new Date().setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 86400000;

    const [users, newToday, cards, msgs, orders, revenue, credits, sessions] = await Promise.all([
      q1('SELECT COUNT(*) c FROM users'),
      q1('SELECT COUNT(*) c FROM users WHERE created_at >= ?', [today]),
      q1('SELECT COUNT(*) c FROM character_cards'),
      q1('SELECT COUNT(*) c FROM messages'),
      q1("SELECT COUNT(*) c FROM orders WHERE status='paid'"),
      q1("SELECT COALESCE(SUM(price),0) s FROM orders WHERE status='paid'"),
      q1('SELECT COALESCE(SUM(balance),0) s FROM users'),
      q1('SELECT COUNT(DISTINCT user_id) c FROM sessions WHERE last_seen >= ?', [weekAgo]),
    ]);

    // 近 7 天每天的新增用户和对话
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d0 = today - i * 86400000;
      const d1 = d0 + 86400000;
      const u = await q1('SELECT COUNT(*) c FROM users WHERE created_at >= ? AND created_at < ?', [d0, d1]);
      const m = await q1('SELECT COUNT(*) c FROM messages WHERE created_at >= ? AND created_at < ?', [d0, d1]);
      const o = await q1("SELECT COUNT(*) c FROM orders WHERE status='paid' AND created_at >= ? AND created_at < ?", [d0, d1]);
      daily.push({
        date: new Date(d0).toISOString().slice(5, 10),
        users: u.c, messages: m.c, orders: o.c,
      });
    }

    const topCards = await q(
      `SELECT id, nickname, name, view_count, like_count, chat_count, comment_count
       FROM character_cards ORDER BY (like_count*3 + favorite_count*8 + comment_count*15 + chat_count*2) DESC LIMIT 5`);

    return {
      success: true,
      stats: {
        users: users.c, newUsersToday: newToday.c, activeUsers7d: sessions.c,
        cards: cards.c, messages: msgs.c,
        paidOrders: orders.c, revenue: Number(revenue.s),
        totalCredits: Number(credits.s),
      },
      daily,
      topCards,
    };
  },

  // ---------- 用户管理 ----------
  'list-users': async (ctx, body) => {
    const limit = Math.min(100, Number(body.limit) || 20);
    const offset = Math.max(0, Number(body.offset) || 0);
    const kw = body.keyword ? `%${body.keyword}%` : null;
    const status = body.status || null;

    const where = [];
    const params = [];
    if (kw) { where.push('(id LIKE ? OR first_name LIKE ? OR username LIKE ?)'); params.push(kw, kw, kw); }
    if (status) { where.push('status = ?'); params.push(status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await q(
      `SELECT id, first_name, last_name, username, telegram_id, status, ban_reason,
              balance, member, member_until, checkin_streak, invite_code, invited_by,
              last_ip, last_login_at, created_at
       FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]);
    const total = await q1(`SELECT COUNT(*) c FROM users ${w}`, params);

    return {
      success: true,
      total: total.c,
      items: rows.map(u => ({
        id: u.id, name: u.first_name, username: u.username, telegramId: u.telegram_id,
        status: u.status, banReason: u.ban_reason,
        balance: u.balance, member: !!u.member, memberUntil: Number(u.member_until),
        checkinStreak: u.checkin_streak, inviteCode: u.invite_code, invitedBy: u.invited_by,
        lastIp: u.last_ip, lastLoginAt: Number(u.last_login_at || 0), createdAt: Number(u.created_at),
      })),
    };
  },

  'get-user': async (ctx, body) => {
    const u = await q1('SELECT * FROM users WHERE id=?', [body.userId]);
    if (!u) return { __status: 404, error: '用户不存在' };

    const credits = await q(
      `SELECT type, amount, balance, note, created_at AS at FROM credit_history
       WHERE user_id=? ORDER BY id DESC LIMIT 30`, [body.userId]);
    const sess = await q(
      `SELECT id, device_name, platform, ip, last_seen, revoked FROM sessions
       WHERE user_id=? ORDER BY last_seen DESC LIMIT 10`, [body.userId]);
    const orders = await q(
      `SELECT id, credits, price, status, created_at FROM orders
       WHERE user_id=? ORDER BY id DESC LIMIT 10`, [body.userId]);
    const archives = await q1('SELECT COUNT(*) c FROM archives WHERE user_id=?', [body.userId]);
    const invites = await q1('SELECT COUNT(*) c FROM invites WHERE inviter_id=?', [body.userId]);

    return {
      success: true,
      user: {
        id: u.id, name: u.first_name, username: u.username, telegramId: u.telegram_id,
        languageCode: u.language_code, status: u.status, banReason: u.ban_reason,
        balance: u.balance, member: !!u.member, memberUntil: Number(u.member_until),
        firstRecharge: !!u.first_recharge, checkinStreak: u.checkin_streak,
        inviteCode: u.invite_code, invitedBy: u.invited_by,
        lastIp: u.last_ip, lastLoginAt: Number(u.last_login_at || 0),
        createdAt: Number(u.created_at),
      },
      credits: credits.map(c => ({ ...c, at: Number(c.at) })),
      sessions: sess.map(s => ({ ...s, lastSeen: Number(s.last_seen), revoked: !!s.revoked })),
      orders: orders.map(o => ({ ...o, price: Number(o.price), createdAt: Number(o.created_at) })),
      counts: { archives: archives.c, invites: invites.c },
    };
  },

  'adjust-credits': async (ctx, body) => {
    const amount = Math.trunc(Number(body.amount));
    if (!Number.isFinite(amount) || amount === 0) return { __status: 400, error: '金额无效' };
    const u = await q1('SELECT id FROM users WHERE id=?', [body.userId]);
    if (!u) return { __status: 404, error: '用户不存在' };
    const balance = await addCredits(body.userId, amount, 'admin_adjust', body.note || '管理员调整');
    await log(ctx.actor, 'adjust_credits', body.userId, { amount, note: body.note }, ctx.ip);
    return { success: true, balance };
  },

  'set-user-status': async (ctx, body) => {
    const status = body.status;
    if (!['active', 'banned', 'deleted'].includes(status)) return { __status: 400, error: '状态无效' };
    const u = await q1('SELECT id FROM users WHERE id=?', [body.userId]);
    if (!u) return { __status: 404, error: '用户不存在' };

    if (status === 'banned') {
      await exec("UPDATE users SET status='banned', ban_reason=?, banned_at=?, updated_at=? WHERE id=?",
        [body.reason || '违规', now(), now(), body.userId]);
      await exec('UPDATE api_keys SET revoked=1 WHERE user_id=?', [body.userId]);
      await exec('UPDATE sessions SET revoked=1 WHERE user_id=?', [body.userId]);
    } else {
      await exec("UPDATE users SET status=?, ban_reason=NULL, banned_at=NULL, updated_at=? WHERE id=?",
        [status, now(), body.userId]);
    }
    await log(ctx.actor, 'set_user_status', body.userId, { status, reason: body.reason }, ctx.ip);
    return { success: true };
  },

  'set-member': async (ctx, body) => {
    const u = await q1('SELECT id FROM users WHERE id=?', [body.userId]);
    if (!u) return { __status: 404, error: '用户不存在' };
    const days = Math.trunc(Number(body.days) || 0);
    const until = days > 0 ? Date.now() + days * 86400000 : 0;
    await exec('UPDATE users SET member=?, member_until=?, updated_at=? WHERE id=?',
      [days > 0 ? 1 : 0, until, now(), body.userId]);
    await log(ctx.actor, 'set_member', body.userId, { days }, ctx.ip);
    return { success: true, memberUntil: until };
  },

  // ---------- 文字模型 ----------
  'list-text-models': async () => {
    const rows = await q('SELECT * FROM admin_text_models ORDER BY sort, id');
    return {
      success: true,
      items: rows.map(m => ({
        id: m.id, name: m.name, displayName: m.display_name, backend: m.backend,
        provider: m.provider, creditPer1k: m.credit_per_1k, tier: m.tier,
        maxTokens: m.max_tokens, temperature: Number(m.temperature),
        enabled: !!m.enabled, vipOnly: !!m.vip_only, sort: m.sort,
        description: m.description, updatedAt: Number(m.updated_at),
      })),
    };
  },

  'save-text-model': async (ctx, body) => {
    const m = body.model || body;
    const id = Math.trunc(Number(m.id));
    if (!id) return { __status: 400, error: 'id 必填' };
    const name = String(m.name || '').slice(0, 64);
    const backend = String(m.backend || '').slice(0, 64);
    if (!name || !backend) return { __status: 400, error: 'name 和 backend 必填' };

    const exist = await q1('SELECT id FROM admin_text_models WHERE id=?', [id]);
    const vals = [
      name, String(m.displayName || name).slice(0, 64), backend,
      String(m.provider || 'custom').slice(0, 64),
      Math.max(0, Math.trunc(Number(m.creditPer1k) || 0)),
      ['low', 'mid', 'high'].includes(m.tier) ? m.tier : 'low',
      Math.min(32000, Math.max(64, Math.trunc(Number(m.maxTokens) || 800))),
      Math.min(2, Math.max(0, Number(m.temperature) || 0.9)),
      m.enabled === false ? 0 : 1,
      m.vipOnly ? 1 : 0,
      Math.trunc(Number(m.sort) || 0),
      String(m.description || '').slice(0, 255),
      now(),
    ];

    if (exist) {
      await exec(
        `UPDATE admin_text_models SET name=?, display_name=?, backend=?, provider=?,
         credit_per_1k=?, tier=?, max_tokens=?, temperature=?, enabled=?, vip_only=?,
         sort=?, description=?, updated_at=? WHERE id=?`,
        [...vals, id]);
    } else {
      await exec(
        `INSERT INTO admin_text_models
         (id,name,display_name,backend,provider,credit_per_1k,tier,max_tokens,temperature,
          enabled,vip_only,sort,description,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, ...vals]);
    }
    await log(ctx.actor, 'save_text_model', String(id), { name, backend }, ctx.ip);
    invalidate();
    return { success: true, id };
  },

  'delete-text-model': async (ctx, body) => {
    await exec('DELETE FROM admin_text_models WHERE id=?', [Math.trunc(Number(body.id))]);
    await log(ctx.actor, 'delete_text_model', String(body.id), null, ctx.ip);
    invalidate();
    return { success: true };
  },

  'test-text-model': async (ctx, body) => {
    const m = await q1('SELECT * FROM admin_text_models WHERE id=?', [Math.trunc(Number(body.id))]);
    if (!m) return { __status: 404, error: '模型不存在' };
    const { chat } = await import('./llm.mjs');
    const t0 = Date.now();
    try {
      const r = await chat({
        system: '你是一个测试助手。',
        messages: [{ role: 'user', content: String(body.prompt || '用一句话自我介绍').slice(0, 500) }],
        model: m.backend, maxTokens: 200,
      });
      return {
        success: true, ok: true, latency: Date.now() - t0,
        reply: r.content.slice(0, 300), usage: r.usage, model: r.model,
      };
    } catch (e) {
      return { success: true, ok: false, latency: Date.now() - t0, error: String(e.message).slice(0, 300) };
    }
  },

  // ---------- 生图模型 ----------
  'list-image-models': async () => {
    const rows = await q('SELECT * FROM admin_image_models ORDER BY sort, id');
    return {
      success: true,
      items: rows.map(m => ({
        id: m.id, name: m.name, provider: m.provider, endpoint: m.endpoint,
        apiKey: m.api_key ? '••••' + String(m.api_key).slice(-4) : '',
        hasKey: !!m.api_key, modelName: m.model_name,
        credit: m.credit, width: m.width, height: m.height,
        aspectRatio: m.aspect_ratio, resolution: m.resolution, styleId: m.style_id,
        steps: m.steps, cfgScale: Number(m.cfg_scale),
        extraParams: safeJson(m.extra_params, null),
        enabled: !!m.enabled, sort: m.sort, description: m.description,
        updatedAt: Number(m.updated_at),
      })),
    };
  },

  'save-image-model': async (ctx, body) => {
    const m = body.model || body;
    const id = String(m.id || '').trim().slice(0, 32);
    if (!id) return { __status: 400, error: 'id 必填' };
    const name = String(m.name || '').slice(0, 64);
    if (!name) return { __status: 400, error: 'name 必填' };

    const exist = await q1('SELECT * FROM admin_image_models WHERE id=?', [id]);
    // apiKey:传空字符串表示不修改
    let apiKey = exist ? exist.api_key : '';
    if (typeof m.apiKey === 'string' && m.apiKey && !m.apiKey.startsWith('••••')) {
      apiKey = m.apiKey.slice(0, 255);
    }

    const vals = [
      name, String(m.provider || 'placeholder').slice(0, 64),
      String(m.endpoint || '').slice(0, 512), apiKey,
      String(m.modelName || '').slice(0, 128),
      Math.max(1, Math.trunc(Number(m.credit) || 100)),
      Math.min(2048, Math.max(128, Math.trunc(Number(m.width) || 512))),
      Math.min(2048, Math.max(128, Math.trunc(Number(m.height) || 512))),
      String(m.aspectRatio || 'PORTRAIT').slice(0, 16),
      String(m.resolution || 'SD').slice(0, 8),
      Math.trunc(Number(m.styleId) || 0),
      Math.min(150, Math.max(1, Math.trunc(Number(m.steps) || 28))),
      Math.min(30, Math.max(1, Number(m.cfgScale) || 7)),
      m.extraParams ? JSON.stringify(m.extraParams) : null,
      m.enabled === false ? 0 : 1,
      Math.trunc(Number(m.sort) || 0),
      String(m.description || '').slice(0, 255),
      now(),
    ];

    if (exist) {
      await exec(
        `UPDATE admin_image_models SET name=?, provider=?, endpoint=?, api_key=?, model_name=?,
         credit=?, width=?, height=?, aspect_ratio=?, resolution=?, style_id=?, steps=?,
         cfg_scale=?, extra_params=?, enabled=?, sort=?, description=?, updated_at=?
         WHERE id=?`, [...vals, id]);
    } else {
      await exec(
        `INSERT INTO admin_image_models
         (id,name,provider,endpoint,api_key,model_name,credit,width,height,aspect_ratio,
          resolution,style_id,steps,cfg_scale,extra_params,enabled,sort,description,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, ...vals]);
    }
    await log(ctx.actor, 'save_image_model', id, { name, provider: m.provider }, ctx.ip);
    invalidate();
    return { success: true, id };
  },

  'delete-image-model': async (ctx, body) => {
    await exec('DELETE FROM admin_image_models WHERE id=?', [String(body.id)]);
    await log(ctx.actor, 'delete_image_model', String(body.id), null, ctx.ip);
    invalidate();
    return { success: true };
  },

  // ---------- 全局配置 ----------
  'list-config': async () => {
    const rows = await q('SELECT * FROM admin_config ORDER BY group_name, k');
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.group_name]) grouped[r.group_name] = [];
      grouped[r.group_name].push({
        key: r.k, value: r.v, label: r.label, type: r.type,
      });
    }
    return { success: true, groups: grouped };
  },

  'save-config': async (ctx, body) => {
    const items = body.items || {};
    for (const [k, v] of Object.entries(items)) {
      await exec(
        `INSERT INTO admin_config (k, v, updated_at) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at)`,
        [String(k).slice(0, 64), String(v ?? ''), now()]);
    }
    await log(ctx.actor, 'save_config', null, items, ctx.ip);
    invalidate();
    return { success: true };
  },

  // ---------- 角色卡管理 ----------
  'list-cards': async (ctx, body) => {
    const limit = Math.min(100, Number(body.limit) || 20);
    const offset = Math.max(0, Number(body.offset) || 0);
    const kw = body.keyword ? `%${body.keyword}%` : null;
    const where = kw ? 'WHERE (name LIKE ? OR nickname LIKE ? OR creator LIKE ?)' : '';
    const params = kw ? [kw, kw, kw] : [];

    const rows = await q(
      `SELECT id, name, nickname, tier, status, owner_id, popularity, view_count,
              like_count, chat_count, comment_count, is_banned, created_at
       FROM character_cards ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = await q1(`SELECT COUNT(*) c FROM character_cards ${where}`, params);
    return { success: true, total: total.c, items: rows };
  },

  'set-card-status': async (ctx, body) => {
    const id = body.cardId;
    if (body.banned) {
      await exec('UPDATE character_cards SET is_banned=1, ban_reason=?, updated_at=? WHERE id=?',
        [body.reason || '违规', now(), id]);
    } else {
      await exec('UPDATE character_cards SET is_banned=0, ban_reason=NULL, updated_at=? WHERE id=?',
        [now(), id]);
    }
    await log(ctx.actor, 'set_card_status', id, { banned: !!body.banned }, ctx.ip);
    return { success: true };
  },

  // ---------- 订单 ----------
  'list-orders': async (ctx, body) => {
    const limit = Math.min(100, Number(body.limit) || 20);
    const offset = Math.max(0, Number(body.offset) || 0);
    const status = body.status || null;
    const where = status ? 'WHERE status=?' : '';
    const params = status ? [status] : [];
    const rows = await q(
      `SELECT o.*, u.first_name FROM orders o LEFT JOIN users u ON u.id=o.user_id
       ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = await q1(`SELECT COUNT(*) c FROM orders ${where}`, params);
    return { success: true, total: total.c, items: rows };
  },

  // ---------- 后台日志 ----------
  'list-logs': async (ctx, body) => {
    const rows = await q(
      'SELECT * FROM admin_logs ORDER BY id DESC LIMIT ?', [Math.min(200, Number(body.limit) || 50)]);
    return { success: true, items: rows.map(r => ({ ...r, at: Number(r.created_at), detail: safeJson(r.detail, null) })) };
  },
};
