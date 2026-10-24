// 对话设置 / 人设 / 长期记忆 端点
import { q, q1, exec, now } from './db.mysql.mjs';
import {
  LIMITS, CONSTS, MODEL_REGISTRY, DEFAULTS,
  getUserSettings, saveUserSettings, parseStatusBlock,
} from './chat_engine.mjs';

export const engineActions = {
  // ---------- 设置 ----------
  'get-chat-settings': async ({ user }) => {
    const s = await getUserSettings(user.id);
    return {
      success: true,
      settings: s,
      limits: LIMITS,
      constants: {
        MAX_CHARACTER_TOKENS_RATIO: CONSTS.MAX_CHARACTER_TOKENS_RATIO,
        MAX_CHAT_MESSAGE_LENGTH: CONSTS.MAX_CHAT_MESSAGE_LENGTH,
        MAX_PERSONAS_PER_USER: CONSTS.MAX_PERSONAS_PER_USER,
        MAX_USER_PERSONA_LENGTH: CONSTS.MAX_USER_PERSONA_LENGTH,
        MIN_CONTEXT_TO_OUTPUT_RATIO: CONSTS.MIN_CONTEXT_TO_OUTPUT_RATIO,
        NON_VIP_MAX_CONTEXT_TOKENS: CONSTS.NON_VIP_MAX_CONTEXT_TOKENS,
        KNOWLEDGE_AUTO_GEN_COST: CONSTS.KNOWLEDGE_AUTO_GEN_COST,
      },
      models: Object.entries(MODEL_REGISTRY).map(([id, m]) => ({
        id: Number(id), name: m.displayName, tier: m.tier, creditPer1k: m.creditPer1k,
      })),
    };
  },

  'update-chat-settings': async ({ user }, body) => {
    const u = await q1('SELECT member, member_until FROM users WHERE id=?', [user.id]);
    const isVip = !!u.member && Number(u.member_until) > now();
    const saved = await saveUserSettings(user.id, body.settings || body, isVip);
    return { success: true, settings: saved };
  },

  // ---------- 我的人设 ----------
  'list-personas': async ({ user }) => {
    const rows = await q('SELECT * FROM personas WHERE user_id=? ORDER BY id DESC', [user.id]);
    const s = await getUserSettings(user.id);
    return {
      success: true,
      activePersonaId: s.activePersonaId,
      maxCount: CONSTS.MAX_PERSONAS_PER_USER,
      items: rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        active: r.id === s.activePersonaId,
        createdAt: Number(r.created_at),
      })),
    };
  },

  'upsert-persona': async ({ user }, body) => {
    const name = String(body.name || '').trim().slice(0, 64);
    if (!name) return { __status: 400, error: '请填写人设名称' };
    const desc = String(body.description || '').slice(0, CONSTS.MAX_USER_PERSONA_LENGTH);

    if (body.id) {
      const exist = await q1('SELECT * FROM personas WHERE id=? AND user_id=?', [body.id, user.id]);
      if (!exist) return { __status: 404, error: '人设不存在' };
      await exec('UPDATE personas SET name=?, description=?, updated_at=? WHERE id=?',
        [name, desc, now(), body.id]);
      return { success: true, id: body.id };
    }

    const cnt = await q1('SELECT COUNT(*) c FROM personas WHERE user_id=?', [user.id]);
    if (cnt.c >= CONSTS.MAX_PERSONAS_PER_USER) {
      return { __status: 400, error: `人设数量已达上限(${CONSTS.MAX_PERSONAS_PER_USER})` };
    }
    await exec('INSERT INTO personas (user_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)',
      [user.id, name, desc, now(), now()]);
    const row = await q1('SELECT id FROM personas WHERE user_id=? ORDER BY id DESC LIMIT 1', [user.id]);
    return { success: true, id: row.id };
  },

  'delete-persona': async ({ user }, body) => {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return { __status: 400, error: '请指定人设 id' };
    await exec('DELETE FROM personas WHERE id=? AND user_id=?', [id, user.id]);
    const s = await getUserSettings(user.id);
    if (s.activePersonaId === id) {
      await saveUserSettings(user.id, { activePersonaId: null });
    }
    return { success: true };
  },

  'activate-persona': async ({ user }, body) => {
    const id = body.id ? Number(body.id) : null;
    if (id) {
      const exist = await q1('SELECT id FROM personas WHERE id=? AND user_id=?', [id, user.id]);
      if (!exist) return { __status: 404, error: '人设不存在' };
    }
    const saved = await saveUserSettings(user.id, { activePersonaId: id });
    return { success: true, activePersonaId: saved.activePersonaId };
  },

  // ---------- 长期记忆 ----------
  'list-knowledge': async ({ user }, body) => {
    const rows = await q(
      `SELECT * FROM knowledge_memories WHERE user_id=? AND character_card_id=?
       ORDER BY id DESC LIMIT ?`,
      [user.id, body.characterCardId, Math.min(200, Number(body.limit) || 50)]);
    return {
      success: true,
      items: rows.map(r => ({
        id: r.id, kind: r.kind, content: r.content, at: Number(r.created_at),
      })),
    };
  },

  'delete-knowledge': async ({ user }, body) => {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return { __status: 400, error: '请指定记忆 id' };
    await exec('DELETE FROM knowledge_memories WHERE id=? AND user_id=?', [id, user.id]);
    return { success: true };
  },

  'regenerate-knowledge': async ({ user }, body) => {
    const E = await import('./chat_engine.mjs');
    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) return { __status: 404, error: '角色卡不存在' };
    const a = await q1('SELECT id FROM archives WHERE user_id=? AND character_card_id=?',
      [user.id, card.id]);
    if (!a) return { __status: 400, error: '还没有对话' };
    const hist = await q('SELECT role, content FROM messages WHERE archive_id=? ORDER BY id DESC LIMIT 20', [a.id]);
    hist.reverse();
    await exec('DELETE FROM knowledge_memories WHERE user_id=? AND character_card_id=?',
      [user.id, card.id]);
    const saved = await E.extractKnowledge({
      user, card: { name: card.name, nickname: card.nickname }, history: hist,
    });
    return { success: true, saved };
  },

  // ---------- 状态栏解析(给前端演示/调试) ----------
  'parse-status-block': async (ctx, body) => ({
    success: true,
    rows: parseStatusBlock(String(body.text || '')),
  }),
};
