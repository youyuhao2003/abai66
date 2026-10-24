// 157 个端点完整实现(第 1 部分:角色卡 / 对话 / 归档)
import { q, q1, exec, withTx, now, rid, addCredits, cardView as baseCardView } from './db.mysql.mjs';
import { calcPopularity, popularityTier } from './popularity.mjs';

// MySQL 的 JSON 列会被驱动自动解析成对象,这里统一兜底
export function safeJson(v, dflt) {
  if (v === null || v === undefined) return dflt;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return dflt; }
}

export function viewCard(r, extra = {}) {
  let tags = [];
  try { tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []); } catch {}
  if (!Array.isArray(tags)) tags = [];
  return {
    id: r.id,
    status: r.status,
    moderationStatus: r.moderation_status,
    reviewStatus: r.review_status,
    popularity: r.popularity,
    popularityTier: r.popularity_tier,
    createdBy: r.owner_id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    settingsCharCount: r.settings_char_count,
    worldBookCharCount: r.world_book_char_count,
    likeCount: r.like_count ?? 0,
    favoriteCount: r.favorite_count ?? 0,
    chatCount: r.chat_count ?? 0,
    viewCount: r.view_count ?? 0,
    data: {
      name: r.name, nickname: r.nickname, tier: r.tier, tags,
      creator: r.creator, character_version: r.character_version,
      avatarUrl: r.avatar_url, posterUrl: r.poster_url, heroUrl: r.hero_url, gender: r.gender,
      creator_notes: r.creator_notes,
      personality: r.personality,
      scenario: r.scenario,
      appearance: r.appearance,
      system_prompt: r.system_prompt,
      opening_line: r.opening_line || r.first_message,
      first_message: r.first_message,
      first_message_image: r.first_message_image,
      preset_status_block: r.preset_status_block,
      preset_options: safeJson(r.preset_options, []),
      example_dialogue: r.example_dialogue,
      post_history_instructions: r.post_history_instructions,
      alternate_greetings: safeJson(r.alternate_greetings, []),
      character_book_id: r.character_book_id,
      is_official: !!r.is_official,
      is_verified: !!r.is_verified,
      is_nsfw: !!r.is_nsfw,
      ...extra,
    },
  };
}

async function ensureArchive(userId, cardId) {
  let a = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?', [userId, cardId]);
  if (!a) {
    await exec('INSERT INTO archives (user_id, character_card_id, message_count, updated_at) VALUES (?,?,0,?)',
      [userId, cardId, now()]);
    a = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?', [userId, cardId]);
  }
  // 空会话自动补上角色开场白，避免进入聊天页是一片空白
  const cnt = await q1('SELECT COUNT(*) c FROM messages WHERE archive_id=?', [a.id]);
  if (!cnt || !cnt.c) {
    const card = await q1('SELECT opening_line, first_message FROM character_cards WHERE id=?', [cardId]);
    const opening = String((card && (card.opening_line || card.first_message)) || '').trim();
    if (opening) {
      const t = now();
      await exec(
        `INSERT INTO messages (archive_id, role, status, content, created_at) VALUES (?,?,?,?,?)`,
        [a.id, 'assistant', 'ok', opening, t]);
      await exec('UPDATE archives SET message_count=1, updated_at=? WHERE id=?', [t, a.id]);
      a = await q1('SELECT * FROM archives WHERE id=?', [a.id]);
    }
  }
  return a;
}

// ========== 角色卡 ==========
export const cardActions = {
  'list-public-character-cards': async ({ user }, body) => {
    const sortBy = body.sortBy || 'trending';
    if (!user && sortBy !== 'trending') return { __status: 403, error: 'Guests may only browse sortBy="trending".' };
    const pageSize = Math.min(50, Math.max(1, Number(body.pageSize) || 12));
    let offset = 0;
    if (body.cursor) { try { offset = Number(Buffer.from(body.cursor, 'base64').toString().split(':')[1]) || 0; } catch {} }
    // 热度实时计算:点赞*3 + 收藏*8 + 评论*15 + 对话*2 + 浏览*0.1
    const HOT = '(like_count*3 + favorite_count*8 + comment_count*15 + chat_count*2 + ROUND(view_count*0.1))';
    const orders = {
      trending: `${HOT} DESC`, latest: 'created_at DESC', hot: 'chat_count DESC',
      likes: 'like_count DESC', name: 'name ASC',
    };
    const order = orders[sortBy] || orders.trending;
    const rows = await q(
      `SELECT * FROM character_cards WHERE status='public' AND review_status<>'rejected' ORDER BY ${order} LIMIT ? OFFSET ?`,
      [pageSize, offset]);
    const total = await q1("SELECT COUNT(*) c FROM character_cards WHERE status='public' AND review_status<>'rejected'");
    const next = offset + pageSize < total.c ? Buffer.from(`o:${offset + pageSize}`).toString('base64') : null;
    const items = rows.map(r => {
      const c = viewCard(r);
      const p2 = calcPopularity({
        likes: r.like_count, favorites: r.favorite_count, comments: r.comment_count,
        chats: r.chat_count, views: r.view_count,
      });
      c.popularity = p2;
      c.popularityTier = popularityTier(p2);
      return c;
    });
    return { success: true, items, nextCursor: next, total: total.c };
  },

  'search-character-cards': async ({ user }, body) => {
    const kw = `%${String(body.keyword || '').trim()}%`;
    const pageSize = Math.min(50, Math.max(1, Number(body.pageSize) || 12));
    const offset = Math.max(0, Number(body.offset) || 0);
    const tag = body.tag ? String(body.tag) : null;

    let where = "status='public' AND review_status<>'rejected' AND (name LIKE ? OR nickname LIKE ? OR creator LIKE ? OR tags LIKE ?)";
    const params = [kw, kw, kw, kw];
    if (tag) { where += ' AND JSON_CONTAINS(tags, JSON_QUOTE(?))'; params.push(tag); }

    const rows = await q(
      `SELECT * FROM character_cards WHERE ${where} ORDER BY popularity DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]);
    const total = await q1(`SELECT COUNT(*) c FROM character_cards WHERE ${where}`, params);
    return { success: true, items: rows.map(r => viewCard(r)), total: total.c, keyword: body.keyword };
  },

  'get-public-character-card': async ({ user }, body) => {
    const r = await q1("SELECT * FROM character_cards WHERE id=? AND status='public'", [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'Character card not found.' };
    await exec('UPDATE character_cards SET view_count = view_count + 1 WHERE id=?', [r.id]);
    const reviews = await q1('SELECT COUNT(*) c, COALESCE(AVG(rating),0) a FROM card_reviews WHERE character_card_id=?', [r.id]);
    let liked = false, favorited = false;
    if (user) {
      liked = !!(await q1("SELECT id FROM likes WHERE user_id=? AND target_type='card' AND target_id=?", [user.id, r.id]));
      favorited = !!(await q1('SELECT id FROM favorites WHERE user_id=? AND character_card_id=?', [user.id, r.id]));
    }
    return {
      success: true,
      card: viewCard(r),
      stats: { reviews: reviews.c, rating: Number(reviews.a), liked, favorited },
    };
  },

  'get-character-card': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'Character card not found.' };
    if (r.status !== 'public' && r.owner_id !== user?.id) return { __status: 403, error: 'Forbidden.' };
    return { success: true, card: viewCard(r) };
  },

  'list-my-character-cards': async ({ user }, body) => {
    const pageSize = Math.min(50, Math.max(1, Number(body.pageSize) || 20));
    const offset = Math.max(0, Number(body.offset) || 0);
    const rows = await q(
      'SELECT * FROM character_cards WHERE owner_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [user.id, pageSize, offset]);
    const total = await q1('SELECT COUNT(*) c FROM character_cards WHERE owner_id=?', [user.id]);
    return { success: true, items: rows.map(r => viewCard(r)), total: total.c };
  },

  'list-workshop-character-cards': async ({ user }, body) => {
    const rows = await q(
      `SELECT * FROM character_cards WHERE owner_id=? OR status='public'
       ORDER BY (owner_id=?) DESC, updated_at DESC LIMIT 50`, [user.id, user.id]);
    return { success: true, items: rows.map(r => viewCard(r)) };
  },

  'upsert-character-card': async ({ user }, body) => {
    const d = body.data || body;
    const name = String(d.name || '').slice(0, 128);
    if (!name) return { __status: 400, error: 'name is required.' };
    const tags = JSON.stringify(Array.isArray(d.tags) ? d.tags.slice(0, 12) : []);
    const id = body.id || d.id;
    const t = now();
    const fields = [
      name, String(d.nickname || '').slice(0, 64),
      String(d.creator || user.first_name || '').slice(0, 64),
      String(d.creator_notes || ''),
      String(d.system_prompt || ''),
      String(d.opening_line || ''),
      String(d.gender || 'female'),
      String(d.avatarUrl || ''), String(d.posterUrl || ''),
      (String(d.system_prompt || '') + String(d.creator_notes || '')).length,
    ];
    if (id) {
      const exist = await q1('SELECT * FROM character_cards WHERE id=?', [id]);
      if (!exist) return { __status: 404, error: 'Character card not found.' };
      if (exist.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
      await exec(
        `UPDATE character_cards SET name=?, nickname=?, creator=?, creator_notes=?,
         system_prompt=?, opening_line=?, gender=?, avatar_url=?, poster_url=?,
         settings_char_count=?, tags=?, updated_at=? WHERE id=?`,
        [...fields, tags, t, id]);
      return { success: true, id, created: false };
    }
    const newId = 'card_' + rid(16);
    await exec(
      `INSERT INTO character_cards
       (id, owner_id, status, moderation_status, review_status, name, nickname, tier, tags, creator,
        creator_notes, system_prompt, opening_line, gender, avatar_url, poster_url,
        popularity, popularity_tier, settings_char_count, world_book_char_count, created_at, updated_at)
       VALUES (?,?,'draft','pending','none',?,?,'R',?,?,?,?,?,?,?,?,0,0,?,0,?,?)`,
      [newId, user.id, name, fields[1], tags, fields[2], fields[3], fields[4], fields[5],
       fields[6], fields[7], fields[8], fields[9], t, t]);
    return { success: true, id: newId, created: true };
  },

  'publish-character-card': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'Character card not found.' };
    if (r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    if (!r.system_prompt && !r.creator_notes) return { __status: 400, error: '角色设定为空,无法发布。' };
    await exec(
      `UPDATE character_cards SET status='public', review_status='approved', published_at=?, updated_at=? WHERE id=?`,
      [now(), now(), r.id]);
    await exec(
      `INSERT INTO publish_logs (user_id, card_id, action, status, created_at) VALUES (?,?,?,?,?)`,
      [user.id, r.id, 'publish', 'success', now()]);
    return { success: true, reviewStatus: 'approved' };
  },

  'get-publish-log': async ({ user }, body) => {
    const rows = await q(
      'SELECT * FROM publish_logs WHERE user_id=? ORDER BY id DESC LIMIT 50', [user.id]);
    return { success: true, items: rows };
  },

  'review-character-card': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'Character card not found.' };
    if (r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    const status = body.status === 'rejected' ? 'rejected' : 'approved';
    await exec('UPDATE character_cards SET review_status=?, review_note=?, updated_at=? WHERE id=?',
      [status, String(body.note || ''), now(), r.id]);
    return { success: true, reviewStatus: status };
  },

  'get-character-card-i18n': async (ctx, body) => {
    const r = await q1('SELECT name, nickname, creator_notes, opening_line FROM character_cards WHERE id=?',
      [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'not found' };
    const lang = body.language || 'zh-Hans';
    return { success: true, language: lang, data: r };
  },

  'get-character-card-studio-editable': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'not found' };
    if (r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    return { success: true, card: viewCard(r), editable: true };
  },

  'get-character-share-link': async (ctx, body) => {
    const id = body.id || body.characterCardId;
    return { success: true, url: `/card/${id}`, shareUrl: `/card/${id}`, telegramShareUrl: `https://t.me/share/url?url=/card/${id}` };
  },

  'migrate-character-card': async ({ user }, body) => {
    const from = body.id || body.characterCardId;
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [from]);
    if (!r) return { __status: 404, error: 'not found' };
    if (r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    const newId = 'card_' + rid(16);
    await exec(
      `INSERT INTO character_cards (id, owner_id, status, moderation_status, review_status,
        name, nickname, tier, tags, creator, creator_notes, system_prompt, opening_line,
        gender, avatar_url, poster_url, popularity, popularity_tier,
        settings_char_count, world_book_char_count, created_at, updated_at)
       SELECT ?, owner_id, 'draft', moderation_status, 'none', name, nickname, tier, tags, creator,
        creator_notes, system_prompt, opening_line, gender, avatar_url, poster_url,
        0, 0, settings_char_count, world_book_char_count, ?, ?
       FROM character_cards WHERE id=?`,
      [newId, now(), now(), from]);
    return { success: true, oldId: from, newId };
  },

  'import-character-card-png': async ({ user }, body) => {
    // PNG 卡牌(chara 卡)解析简化版:接受已解出的 JSON
    const d = body.cardData || body;
    if (!d.name) return { __status: 400, error: 'invalid card data' };
    return cardActions['upsert-character-card']({ user }, { data: d });
  },

  'gen-character-card': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const idea = String(body.idea || body.prompt || '').slice(0, 500);
    if (!idea) return { __status: 400, error: 'idea is required.' };
    const cost = 200;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: 'Credit not enough.' };
    let out;
    try {
      const r = await chat({
        system: '你是角色卡设计师。根据用户给的想法,输出严格的 JSON,字段:name(标题,12字内)、nickname(角色名,6字内)、tags(4-6个标签数组)、creator_notes(角色设定,150-300字)、system_prompt(扮演指令,100-200字)、opening_line(开场白,40-80字,带动作描写)。只输出 JSON,不要解释。',
        messages: [{ role: 'user', content: idea }],
        maxTokens: 1200,
      });
      const text = r.content.replace(/```json|```/g, '').trim();
      out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) {
      return { __status: 502, error: '生成失败:' + String(e.message).slice(0, 100) };
    }
    const balance = await addCredits(user.id, -cost, 'gen_card', '生成角色卡');
    return { success: true, draft: out, credits: cost, balance };
  },

  'gen-card-review': async ({ user }, body) => {
    const r = await q1('SELECT * FROM character_cards WHERE id=?', [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'not found' };
    const { chat } = await import('./llm.mjs');
    try {
      const out = await chat({
        system: '你是内容审核助手。评估角色卡设定是否合规(暴力、违法、未成年人性内容)。输出 JSON:{approved:boolean, score:0-100, issues:[], suggestion:string}。只输出 JSON。',
        messages: [{ role: 'user', content: `${r.name}\n${r.creator_notes}\n${r.system_prompt}` }],
        maxTokens: 400,
      });
      const t = out.content.replace(/```json|```/g, '').trim();
      const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      return { success: true, review: j };
    } catch (e) {
      return { __status: 502, error: '审核失败:' + e.message.slice(0, 100) };
    }
  },

  'get-card-review': async (ctx, body) => {
    const r = await q1('SELECT review_status, review_note FROM character_cards WHERE id=?',
      [body.id || body.characterCardId]);
    if (!r) return { __status: 404, error: 'not found' };
    return { success: true, status: r.review_status, note: r.review_note };
  },

  'list-top-authors': async (ctx, body) => {
    const rows = await q(
      `SELECT owner_id, COUNT(*) cards, SUM(popularity) pop, SUM(like_count) likes
       FROM character_cards WHERE status='public' GROUP BY owner_id ORDER BY pop DESC LIMIT ?`,
      [Math.min(50, Number(body.limit) || 20)]);
    return { success: true, items: rows.map((r, i) => ({ rank: i + 1, ...r, pop: Number(r.pop) })) };
  },

  'get-author-stats': async ({ user }, body) => {
    const uid = body.userId || user.id;
    const s = await q1(
      `SELECT COUNT(*) cards, COALESCE(SUM(popularity),0) pop, COALESCE(SUM(like_count),0) likes,
              COALESCE(SUM(chat_count),0) chats, COALESCE(SUM(view_count),0) views
       FROM character_cards WHERE owner_id=? AND status='public'`, [uid]);
    return { success: true, userId: uid, stats: s };
  },

  'list-character-images': async (ctx, body) => {
    const rows = await q(
      `SELECT * FROM user_images WHERE source='generate' ORDER BY created_at DESC LIMIT 40`);
    return { success: true, items: rows };
  },

  'list-gallery-images': async () => {
    const rows = await q('SELECT * FROM user_images WHERE reviewed=1 ORDER BY created_at DESC LIMIT 60');
    return { success: true, items: rows };
  },

  'unlock-character-gallery': async ({ user }, body) => {
    const cost = 500;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: 'Credit not enough.' };
    const balance = await addCredits(user.id, -cost, 'gallery', '解锁画廊');
    return { success: true, unlocked: true, credits: cost, balance };
  },
};

// ========== 对话 / 归档 ==========
export const chatActions = {
  'create-chat-completion': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const E = await import('./chat_engine.mjs');
    const D = await import('./directives.mjs');

    const text = String(body.message || body.userMessage || '').trim().slice(0, E.CONSTS.MAX_CHAT_MESSAGE_LENGTH);
    const directiveType = body.directiveType || null;
    const directiveText = String(body.directiveText || '').trim().slice(0, 1000);

    if (!text && !directiveType) return { __status: 400, error: 'message is required.' };
    if (directiveType && !D.isDirectiveType(directiveType)) {
      return { __status: 400, error: '未知的指令类型。' };
    }
    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) return { __status: 404, error: 'Character card not found.' };
    if (card.is_banned) {
      return { __status: 403, error: '很抱歉，该角色已被下架。', banned: true };
    }

    const settings = await E.getUserSettings(user.id);
    const a = await ensureArchive(user.id, card.id);

    const histRows = await q(
      'SELECT role, content FROM messages WHERE archive_id=? AND status<>? ORDER BY id DESC LIMIT 60',
      [a.id, 'failed']);
    histRows.reverse();

    let persona = null;
    if (settings.activePersonaId) {
      persona = await q1('SELECT * FROM personas WHERE id=? AND user_id=?',
        [settings.activePersonaId, user.id]);
    }
    let knowledge = [];
    if (settings.knowledgeEnabled) {
      knowledge = await q(
        `SELECT kind, content FROM knowledge_memories
         WHERE user_id=? AND character_card_id=? ORDER BY id DESC LIMIT 20`,
        [user.id, card.id]);
    }

    const cardData = {
      id: card.id, name: card.name, nickname: card.nickname,
      creator_notes: card.creator_notes, personality: card.personality,
      scenario: card.scenario, appearance: card.appearance,
      system_prompt: card.system_prompt, example_dialogue: card.example_dialogue,
      post_history_instructions: card.post_history_instructions,
      preset_status_block: card.preset_status_block,
    };

    // 组成本轮的用户输入:普通消息 或 指令
    let userTurn = text;
    let storedContent = text;
    if (directiveType) {
      const built = D.buildDirectivePrompt(directiveType, directiveText);
      userTurn = built;
      storedContent = text || `【${D.DIRECTIVE_TYPES[directiveType].label}】${directiveText}`;
    }

    const prompt = E.buildPrompt({
      card: cardData, settings, persona, knowledge,
      history: histRows, userText: userTurn,
    });

    const mi = await E.getModelInfo(settings.modelId);
    const backend = mi.backend;
    const isScript = settings.contentFormat === 'script';
    const maxTokens = isScript ? settings.scriptMaxOutputTokens : settings.maxOutputTokens;

    let result;
    try {
      result = await chat({
        system: prompt.system, messages: prompt.messages,
        model: backend, maxTokens, temperature: 0.9,
      });
    } catch (e) {
      return { __status: 502, error: D.CHAT_ERRORS.upstreamError, detail: String(e.message).slice(0, 160) };
    }

    const { speech, statusBlock } = E.splitStatusBlock(result.content);
    const t = now();

    // 空回复 / 只有状态栏 的分类
    let msgStatus = 'ok';
    if (!speech && statusBlock) msgStatus = 'status_only';
    else if (!speech) msgStatus = 'failed';

    if (directiveType) {
      await exec(
        `INSERT INTO message_directives (user_id, archive_id, type, text, created_at) VALUES (?,?,?,?,?)`,
        [user.id, a.id, directiveType, directiveText.slice(0, 1000), t]);
    }

    await exec(
      `INSERT INTO messages (archive_id, role, status, content, directive, directive_text, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [a.id, 'user', 'ok', storedContent, directiveType || null, directiveType ? (directiveText || null) : null, t]);

    // 状态栏 + 选项并发
    const fullHistory = [...histRows, { role: 'user', content: userTurn }];
    let barResult = { rows: null, text: null, generated: false };
    if (statusBlock) {
      barResult = { rows: E.parseStatusBlock(statusBlock), text: statusBlock, generated: false };
    } else if (settings.statusBarAuto) {
      const rows = await E.genStatusBar({ card: cardData, settings, history: fullHistory });
      barResult = { rows, text: rows.map(function(r){ return r.emoji + ' ' + r.key + ': ' + r.value; }).join(String.fromCharCode(10)), generated: true };
    }

    let optionResult = [];
    if (settings.plotAuto && speech) {
      try {
        const opts = await E.genPlotOptions({
          card: cardData, settings,
          history: [...fullHistory, { role: 'assistant', content: speech }],
        });
        optionResult = Array.isArray(opts) ? opts : [];
      } catch { optionResult = []; }
    }

    await exec(
      `INSERT INTO messages (archive_id, role, status, content, status_bar, plot_options, tokens, model_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [a.id, 'assistant', msgStatus, speech, barResult.text ?? null, JSON.stringify(optionResult || []),
       result.usage?.completion_tokens ?? 0, settings.modelId ?? 2, t + 1]);

    await exec('UPDATE archives SET message_count=message_count+2, updated_at=? WHERE id=?', [t, a.id]);
    await exec('UPDATE character_cards SET chat_count=chat_count+1 WHERE id=?', [card.id]);

    const reg = mi;
    let cost = Math.max(1, Math.ceil(((result.usage?.completion_tokens || 0) / 1000) * reg.creditPer1k));
    if (barResult.generated) cost += 10;
    if (optionResult.length) cost += 20;
    if (settings.knowledgeEnabled) cost += 50;

    const balance = await addCredits(user.id, -cost, 'chat', `对话 · ${reg.displayName}`);
    await exec("UPDATE user_tasks SET done=1, updated_at=? WHERE user_id=? AND task_key='first_chat'",
      [now(), user.id]);

    if (settings.knowledgeEnabled && speech) {
      E.extractKnowledge({
        user, card: cardData,
        history: [...fullHistory, { role: 'assistant', content: speech }],
      }).catch(() => {});
    }

    const recent = await q(
      `SELECT id, role, status, content, status_bar, plot_options, image_url,
              directive, directive_text, created_at AS at
       FROM messages WHERE archive_id=? ORDER BY id DESC LIMIT 20`, [a.id]);
    recent.reverse();

    return {
      success: true,
      reply: speech,
      content: speech,
      rawReply: result.content,
      statusBar: barResult.rows,
      plotOptions: optionResult,
      messageStatus: msgStatus,
      warning: msgStatus === 'status_only' ? D.CHAT_ERRORS.statusBlockOnly
             : msgStatus === 'failed' ? D.CHAT_ERRORS.emptyResponse : null,
      directive: directiveType,
      characterName: card.nickname || card.name,
      model: reg.displayName,
      usage: result.usage,
      credits: cost,
      balance,
      promptStats: prompt.stats,
      history: recent.map(m => ({
        id: m.id, role: m.role, status: m.status, content: m.content,
        statusBar: m.status_bar, plotOptions: safeJson(m.plot_options, []),
        imageUrl: m.image_url, directive: m.directive, directiveText: m.directive_text,
        at: Number(m.at),
      })),
    };
  },

  // 重新生成:删掉最后一条 assistant,用同一个用户输入重跑
  'regenerate-message': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const E = await import('./chat_engine.mjs');
    const D = await import('./directives.mjs');

    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) return { __status: 404, error: 'Character card not found.' };
    const a = await ensureArchive(user.id, card.id);

    const last = await q(
      `SELECT id, role, content, directive, directive_text FROM messages
       WHERE archive_id=? ORDER BY id DESC LIMIT 2`, [a.id]);
    if (last.length < 2 || last[0].role !== 'assistant') {
      return { __status: 400, error: D.CHAT_ERRORS.regenerateFailed };
    }
    const userMsg = last[1];
    await exec('DELETE FROM messages WHERE id=?', [last[0].id]);

    const settings = await E.getUserSettings(user.id);
    let persona = null;
    if (settings.activePersonaId) {
      persona = await q1('SELECT * FROM personas WHERE id=? AND user_id=?',
        [settings.activePersonaId, user.id]);
    }
    let knowledge = [];
    if (settings.knowledgeEnabled) {
      knowledge = await q(
        `SELECT kind, content FROM knowledge_memories WHERE user_id=? AND character_card_id=?
         ORDER BY id DESC LIMIT 20`, [user.id, card.id]);
    }
    const histRows = await q(
      `SELECT role, content FROM messages WHERE archive_id=? AND id<>? ORDER BY id DESC LIMIT 60`,
      [a.id, userMsg.id]);
    histRows.reverse();

    let userTurn = userMsg.content;
    if (userMsg.directive) {
      userTurn = D.buildDirectivePrompt(userMsg.directive, userMsg.directive_text || '') || userMsg.content;
    }

    const cardData = {
      id: card.id, name: card.name, nickname: card.nickname,
      creator_notes: card.creator_notes, personality: card.personality,
      scenario: card.scenario, appearance: card.appearance,
      system_prompt: card.system_prompt, example_dialogue: card.example_dialogue,
      post_history_instructions: card.post_history_instructions,
      preset_status_block: card.preset_status_block,
    };

    const prompt = E.buildPrompt({
      card: cardData, settings, persona, knowledge, history: histRows, userText: userTurn,
    });
    const mi = await E.getModelInfo(settings.modelId);
    const backend = mi.backend;

    let result;
    try {
      result = await chat({
        system: prompt.system, messages: prompt.messages, model: backend,
        maxTokens: settings.contentFormat === 'script' ? settings.scriptMaxOutputTokens : settings.maxOutputTokens,
        temperature: 1.0,
      });
    } catch (e) {
      return { __status: 502, error: D.CHAT_ERRORS.upstreamError };
    }

    const { speech, statusBlock } = E.splitStatusBlock(result.content);
    let msgStatus = 'ok';
    if (!speech && statusBlock) msgStatus = 'status_only';
    else if (!speech) msgStatus = 'failed';

    const barText = statusBlock
      || (settings.statusBarAuto
        ? (await E.genStatusBar({ card: cardData, settings, history: [...histRows, { role:'user', content: userTurn }] }))
            .map(r => `${r.emoji} ${r.key}: ${r.value}`).join('\n')
        : null);

    const options = settings.plotAuto && speech
      ? await E.genPlotOptions({
          card: cardData, settings,
          history: [...histRows, { role:'user', content: userTurn }, { role:'assistant', content: speech }],
        })
      : [];

    const t = now();
    await exec(
      `INSERT INTO messages (archive_id, role, status, content, status_bar, plot_options, tokens, model_id, regenerated, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      [a.id, 'assistant', msgStatus, speech, barText, JSON.stringify(options),
       result.usage?.completion_tokens ?? 0, settings.modelId, t]);

    const reg = mi;
    const cost = Math.max(1, Math.ceil(((result.usage?.completion_tokens || 0) / 1000) * reg.creditPer1k));
    const balance = await addCredits(user.id, -cost, 'chat', '重新生成');

    return {
      success: true,
      reply: speech,
      statusBar: E.parseStatusBlock(barText),
      plotOptions: options,
      messageStatus: msgStatus,
      warning: msgStatus === 'status_only' ? D.CHAT_ERRORS.statusBlockOnly
             : msgStatus === 'failed' ? D.CHAT_ERRORS.emptyResponse : null,
      credits: cost, balance,
    };
  },

  'get-directive-types': async () => {
    const D = await import('./directives.mjs');
    return {
      success: true,
      types: D.directiveMeta,
      quickFormat: Object.entries(D.QUICK_FORMAT).map(([k, v]) => ({ key:k, ...v })),
      errors: D.CHAT_ERRORS,
      paywall: D.PAYWALL,
    };
  },

  'undo-last-round': async ({ user }, body) => {
    const a = await ensureArchive(user.id, body.characterCardId);
    const rows = await q('SELECT id FROM messages WHERE archive_id=? ORDER BY id DESC LIMIT 2', [a.id]);
    if (rows.length < 2) return { __status: 400, error: '没有可撤销的对话。' };
    await exec('DELETE FROM messages WHERE id IN (?,?)', [rows[0].id, rows[1].id]);
    await exec('UPDATE archives SET message_count=GREATEST(message_count-2,0), updated_at=? WHERE id=?', [now(), a.id]);
    const rest = await q('SELECT role, content FROM messages WHERE archive_id=? ORDER BY id', [a.id]);
    return { success: true, messages: rest };
  },

  'refresh-greeting': async (ctx, body) => {
    const { chat, buildSystemPrompt } = await import('./llm.mjs');
    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) return { __status: 404, error: 'not found' };
    let tags = []; try { tags = JSON.parse(card.tags || '[]'); } catch {}
    try {
      const r = await chat({
        system: buildSystemPrompt({ name: card.name, nickname: card.nickname, tags, creator_notes: card.creator_notes }),
        messages: [{ role: 'user', content: '（用一句全新的开场白开始这段对话,只输出台词与动作描写）' }],
        maxTokens: 220,
      });
      return { success: true, greeting: r.content, openingLine: r.content };
    } catch {
      return { success: true, greeting: card.opening_line || '（她抬起头看了你一眼）' };
    }
  },

  'save-user-message': async ({ user }, body) => {
    const a = await ensureArchive(user.id, body.characterCardId);
    const content = String(body.message || body.content || '').slice(0, 4000);
    if (!content) return { __status: 400, error: 'message is required.' };
    await exec('INSERT INTO messages (archive_id,role,content,created_at) VALUES (?,?,?,?)', [a.id, 'user', content, now()]);
    await exec('UPDATE archives SET message_count=message_count+1, updated_at=? WHERE id=?', [now(), a.id]);
    return { success: true };
  },

  'get-archive': async ({ user }, body) => {
    const a = await ensureArchive(user.id, body.characterCardId);
    const rows = await q(
      `SELECT id, role, status, content, status_bar, plot_options, image_url,
              directive, directive_text, regenerated, created_at AS at
       FROM messages WHERE archive_id=? AND status<>'failed' ORDER BY id`, [a.id]);
    return {
      success: true, archiveId: a.id,
      messages: rows.map(r => ({
        id: r.id, role: r.role, status: r.status, content: r.content,
        status_bar: r.status_bar,
        statusBar: r.status_bar,
        plot_options: safeJson(r.plot_options, []),
        plotOptions: safeJson(r.plot_options, []),
        image_url: r.image_url,
        imageUrl: r.image_url,
        directive: r.directive,
        directiveText: r.directive_text,
        regenerated: !!r.regenerated,
        at: Number(r.at),
      })),
    };
  },

  'get-archive-messages': async ({ user }, body) => {
    const a = await q1('SELECT id FROM archives WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    if (!a) return { success: true, messages: [], hasMore: false };
    const limit = Math.min(100, Number(body.limit) || 30);
    const before = Number(body.before) || 0;
    const rows = await q(
      `SELECT id, role, content, created_at AS at FROM messages
       WHERE archive_id=? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      before ? [a.id, before, limit] : [a.id, limit]);
    rows.reverse();
    return { success: true, messages: rows, hasMore: rows.length === limit };
  },

  'list-archives': async ({ user }, body) => {
    const rows = await q(
      `SELECT a.id, a.character_card_id, a.title, a.pinned, a.updated_at,
              c.name, c.nickname, c.avatar_url, c.tier, c.is_banned,
              (SELECT COUNT(*) FROM messages m WHERE m.archive_id = a.id AND m.status <> 'failed') AS msg_count
       FROM archives a JOIN character_cards c ON c.id=a.character_card_id
       WHERE a.user_id=? AND a.deleted=0
       ORDER BY a.pinned DESC, a.updated_at DESC LIMIT 50`, [user.id]);
    return {
      success: true,
      items: rows.map(r => ({
        id: r.id, characterCardId: r.character_card_id,
        messageCount: Number(r.msg_count) || 0,
        title: r.title, pinned: !!r.pinned,
        updatedAt: Number(r.updated_at), name: r.name, nickname: r.nickname,
        avatarUrl: r.avatar_url, tier: r.tier, characterBanned: !!r.is_banned,
      })),
    };
  },

  'create-archive': async ({ user }, body) => {
    const cardId = body.characterCardId;
    if (!cardId) return { __status: 400, error: 'characterCardId is required.' };
    const a = await ensureArchive(user.id, cardId);
    return { success: true, archiveId: a.id };
  },

  'update-archive': async ({ user }, body) => {
    const a = body.archiveId
      ? await q1('SELECT * FROM archives WHERE id=? AND user_id=?', [body.archiveId, user.id])
      : await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?',
          [user.id, body.characterCardId]);
    if (!a) return { __status: 404, error: '存档不存在' };

    const sets = [];
    const params = [];
    if (typeof body.title === 'string') {
      sets.push('title=?');
      params.push(body.title.trim().slice(0, 128));
    }
    if (typeof body.pinned === 'boolean') {
      sets.push('pinned=?');
      params.push(body.pinned ? 1 : 0);
    }
    if (sets.length) {
      sets.push('updated_at=?');
      params.push(now());
      params.push(a.id);
      await exec(`UPDATE archives SET ${sets.join(', ')} WHERE id=?`, params);
    }
    const out = await q1('SELECT * FROM archives WHERE id=?', [a.id]);
    return {
      success: true,
      archive: {
        id: out.id, title: out.title, pinned: !!out.pinned,
        characterCardId: out.character_card_id,
      },
    };
  },

  // 删除存档(二次确认由前端控制)
  'delete-archive': async ({ user }, body) => {
    const a = body.archiveId
      ? await q1('SELECT * FROM archives WHERE id=? AND user_id=?', [body.archiveId, user.id])
      : await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?',
          [user.id, body.characterCardId]);
    if (!a) return { __status: 404, error: '存档不存在' };
    await exec('DELETE FROM messages WHERE archive_id=?', [a.id]);
    await exec('DELETE FROM archives WHERE id=?', [a.id]);
    return { success: true };
  },

  // 新建对话(清空当前存档,开始全新对话但保留旧记录)
  'reset-archive': async ({ user }, body) => {
    const cardId = body.characterCardId;
    const card = await q1('SELECT id FROM character_cards WHERE id=?', [cardId]);
    if (!card) return { __status: 404, error: '角色卡不存在' };
    const old = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?',
      [user.id, cardId]);
    if (old) {
      const title = old.title || ('对话 ' + new Date(Number(old.updated_at)).toLocaleDateString('zh-CN'));
      await exec('UPDATE archives SET deleted=1, title=? WHERE id=?', [title, old.id]);
    }
    await exec('INSERT INTO archives (user_id, character_card_id, message_count, updated_at) VALUES (?,?,0,?)',
      [user.id, cardId, now()]);
    const fresh = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=? AND deleted=0',
      [user.id, cardId]);
    return { success: true, archiveId: fresh.id };
  },

  'import-chat-history': async ({ user }, body) => {
    const cardId = body.characterCardId;
    const msgs = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [];
    if (!cardId || !msgs.length) return { __status: 400, error: 'characterCardId and messages required.' };
    const a = await ensureArchive(user.id, cardId);
    for (const m of msgs) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      await exec('INSERT INTO messages (archive_id,role,content,created_at) VALUES (?,?,?,?)',
        [a.id, role, String(m.content || '').slice(0, 4000), now()]);
    }
    await exec('UPDATE archives SET message_count=message_count+?, updated_at=? WHERE id=?', [msgs.length, now(), a.id]);
    return { success: true, imported: msgs.length };
  },
};

// ========== 知识库 / 世界书 ==========
export const knowledgeActions = {
  'get-knowledge': async ({ user }, body) => {
    const rows = await q(
      'SELECT * FROM knowledge_entries WHERE user_id=? AND character_card_id=? ORDER BY id',
      [user.id, body.characterCardId]);
    return { success: true, items: rows };
  },

  'init-knowledge': async ({ user }, body) => {
    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) return { __status: 404, error: 'not found' };
    const exist = await q1('SELECT COUNT(*) c FROM knowledge_entries WHERE user_id=? AND character_card_id=?',
      [user.id, card.id]);
    if (exist.c > 0) return { success: true, created: 0 };
    await exec('INSERT INTO knowledge_entries (user_id,character_card_id,title,content,source,created_at) VALUES (?,?,?,?,?,?)',
      [user.id, card.id, '角色背景', card.creator_notes || '', 'manual', now()]);
    if (card.system_prompt) {
      await exec('INSERT INTO knowledge_entries (user_id,character_card_id,title,content,source,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, card.id, '扮演设定', card.system_prompt, 'manual', now()]);
    }
    return { success: true, created: 2 };
  },

  'update-knowledge-entries': async ({ user }, body) => {
    const items = Array.isArray(body.items) ? body.items : [];
    await exec('DELETE FROM knowledge_entries WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    for (const it of items.slice(0, 100)) {
      await exec('INSERT INTO knowledge_entries (user_id,character_card_id,title,content,source,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, body.characterCardId, String(it.title || '').slice(0, 255),
         String(it.content || ''), 'manual', now()]);
    }
    return { success: true, count: items.length };
  },

  'gen-knowledge-from-messages': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const a = await q1('SELECT id FROM archives WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    if (!a) return { __status: 404, error: 'no archive' };
    const msgs = await q('SELECT role, content FROM messages WHERE archive_id=? ORDER BY id DESC LIMIT 30', [a.id]);
    const text = msgs.reverse().map(m => `${m.role}: ${m.content}`).join('\n');
    try {
      const r = await chat({
        system: '从对话中抽取值得长期记住的设定/事实,输出 JSON 数组 [{title, content}]。最多 5 条。只输出 JSON。',
        messages: [{ role: 'user', content: text.slice(0, 6000) }],
        maxTokens: 800,
      });
      const t = r.content.replace(/```json|```/g, '').trim();
      const arr = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1));
      return { success: true, entries: arr };
    } catch (e) {
      return { __status: 502, error: '抽取失败:' + e.message.slice(0, 100) };
    }
  },

  'upsert-world-book': async ({ user }, body) => {
    const id = body.id || 'wb_' + rid(12);
    const entries = JSON.stringify(Array.isArray(body.entries) ? body.entries : []);
    const charCount = (body.entries || []).reduce((s, e) => s + String(e.content || '').length, 0);
    const exist = body.id ? await q1('SELECT * FROM world_books WHERE id=?', [body.id]) : null;
    if (exist) {
      if (exist.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
      await exec('UPDATE world_books SET name=?, description=?, entries=?, char_count=?, updated_at=? WHERE id=?',
        [String(body.name || exist.name).slice(0, 128), String(body.description || ''),
         entries, charCount, now(), id]);
      return { success: true, id, created: false };
    }
    await exec(
      `INSERT INTO world_books (id, owner_id, name, description, status, is_public, review_status, entries, char_count, created_at, updated_at)
       VALUES (?,?,?,?,'private',0,'none',?,?,?,?)`,
      [id, user.id, String(body.name || '未命名世界书').slice(0, 128),
       String(body.description || ''), entries, charCount, now(), now()]);
    return { success: true, id, created: true };
  },

  'get-world-book': async ({ user }, body) => {
    const r = await q1('SELECT * FROM world_books WHERE id=?', [body.id]);
    if (!r) return { __status: 404, error: 'not found' };
    if (!r.is_public && r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    return { success: true, book: { ...r, entries: safeJson(r.entries, []) } };
  },

  'list-my-world-books': async ({ user }) => {
    const rows = await q('SELECT * FROM world_books WHERE owner_id=? ORDER BY updated_at DESC', [user.id]);
    return { success: true, items: rows.map(r => ({ ...r, entries: safeJson(r.entries, []) })) };
  },

  'list-public-world-books': async () => {
    const rows = await q("SELECT * FROM world_books WHERE is_public=1 AND review_status='approved' ORDER BY updated_at DESC LIMIT 50");
    return { success: true, items: rows.map(r => ({ ...r, entries: safeJson(r.entries, []) })) };
  },

  'get-public-world-book': async (ctx, body) => {
    const r = await q1("SELECT * FROM world_books WHERE id=? AND is_public=1", [body.id]);
    if (!r) return { __status: 404, error: 'not found' };
    return { success: true, book: { ...r, entries: safeJson(r.entries, []) } };
  },

  'review-world-book': async ({ user }, body) => {
    const r = await q1('SELECT * FROM world_books WHERE id=?', [body.id]);
    if (!r) return { __status: 404, error: 'not found' };
    if (r.owner_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    const pub = body.publish === true;
    await exec('UPDATE world_books SET is_public=?, review_status=?, status=?, updated_at=? WHERE id=?',
      [pub ? 1 : 0, pub ? 'approved' : 'none', pub ? 'public' : 'private', now(), r.id]);
    return { success: true, isPublic: pub };
  },

  'extract-world-book': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const text = String(body.text || '').slice(0, 8000);
    if (!text) return { __status: 400, error: 'text is required.' };
    try {
      const r = await chat({
        system: '从文本中抽取世界观设定条目,输出 JSON 数组 [{key, content}]。最多 10 条。只输出 JSON。',
        messages: [{ role: 'user', content: text }],
        maxTokens: 1200,
      });
      const t = r.content.replace(/```json|```/g, '').trim();
      const arr = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1));
      return { success: true, entries: arr };
    } catch (e) {
      return { __status: 502, error: '抽取失败:' + e.message.slice(0, 100) };
    }
  },
};
