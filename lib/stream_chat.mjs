// 流式对话:SSE 推正文 → 状态栏 → 剧情选项
import { q, q1, exec, now, rid, addCredits } from './db.mysql.mjs';
import { chatStream } from './llm.mjs';
import {
  getUserSettings, buildPrompt, splitStatusBlock, parseStatusBlock,
  genStatusBar, genPlotOptions, extractKnowledge,
  getModelInfo, CONSTS,
} from './chat_engine.mjs';
import { safeJson } from './actions_part1.mjs';
import { isDirectiveType, buildDirectivePrompt, DIRECTIVE_TYPES, CHAT_ERRORS } from './directives.mjs';

async function ensureArchive(userId, cardId) {
  let a = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?', [userId, cardId]);
  if (!a) {
    await exec('INSERT INTO archives (user_id, character_card_id, message_count, updated_at) VALUES (?,?,0,?)',
      [userId, cardId, now()]);
    a = await q1('SELECT * FROM archives WHERE user_id=? AND character_card_id=?', [userId, cardId]);
  }
  return a;
}

export async function handleStreamChat(req, res, user, body) {
  const text = String(body.message || '').trim().slice(0, CONSTS.MAX_CHAT_MESSAGE_LENGTH);
  const directiveType = body.directiveType || null;
  const directiveText = String(body.directiveText || '').trim().slice(0, 1000);

  // SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (!text && !directiveType) {
      send('error', { message: 'message is required.' });
      return res.end();
    }
    if (directiveType && !isDirectiveType(directiveType)) {
      send('error', { message: '未知的指令类型。' });
      return res.end();
    }

    const card = await q1('SELECT * FROM character_cards WHERE id=?', [body.characterCardId]);
    if (!card) { send('error', { message: '角色卡不存在' }); return res.end(); }
    if (card.is_banned) {
      send('error', { message: '很抱歉，该角色已被下架。', banned: true });
      return res.end();
    }

    const settings = await getUserSettings(user.id);
    const a = await ensureArchive(user.id, card.id);

    const histRows = await q(
      `SELECT role, content FROM messages WHERE archive_id=? AND status<>? ORDER BY id DESC LIMIT 60`,
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

    let userTurn = text;
    let storedContent = text;
    if (directiveType) {
      userTurn = buildDirectivePrompt(directiveType, directiveText);
      storedContent = text || `【${DIRECTIVE_TYPES[directiveType].label}】${directiveText}`;
    }

    const prompt = buildPrompt({
      card: cardData, settings, persona, knowledge,
      history: histRows, userText: userTurn,
    });

    const mi = await getModelInfo(settings.modelId);
    const backend = mi.backend;
    const maxTokens = settings.contentFormat === 'script'
      ? settings.scriptMaxOutputTokens : Math.min(settings.maxOutputTokens, mi.maxTokens || 3200);

    // 先落用户消息
    const t = now();
    if (directiveType) {
      await exec(
        `INSERT INTO message_directives (user_id, archive_id, type, text, created_at) VALUES (?,?,?,?,?)`,
        [user.id, a.id, directiveType, directiveText.slice(0, 1000), t]);
    }
    await exec(
      `INSERT INTO messages (archive_id, role, status, content, directive, directive_text, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [a.id, 'user', 'ok', storedContent, directiveType, directiveType ? directiveText : null, t]);

    // ---- 流式生成正文 ----
    let full = '';
    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      for await (const delta of chatStream({
        system: prompt.system, messages: prompt.messages,
        model: backend, maxTokens, temperature: 0.9,
      })) {
        if (aborted) break;
        full += delta;
        send('delta', { text: delta });
      }
    } catch (e) {
      send('error', { message: CHAT_ERRORS.upstreamError, detail: String(e.message).slice(0, 160) });
      await exec(
        `INSERT INTO messages (archive_id, role, status, content, created_at) VALUES (?,?,?,?,?)`,
        [a.id, 'assistant', 'failed', full, now()]);
      return res.end();
    }

    // ---- 剥离状态栏 ----
    const { speech, statusBlock } = splitStatusBlock(full);
    let msgStatus = 'ok';
    if (!speech && statusBlock) msgStatus = 'status_only';
    else if (!speech) msgStatus = 'failed';

    if (!speech && msgStatus !== 'ok') {
      send('warning', { message: msgStatus === 'status_only'
        ? CHAT_ERRORS.statusBlockOnly : CHAT_ERRORS.emptyResponse });
    }

    // ---- 状态栏 + 选项(并发) ----
    const fullHistory = [...histRows, { role: 'user', content: userTurn }];
    const [barResult, optionResult] = await Promise.all([
      (async () => {
        if (statusBlock) return { rows: parseStatusBlock(statusBlock), text: statusBlock, generated: false };
        if (!settings.statusBarAuto) return { rows: null, text: null, generated: false };
        const rows = await genStatusBar({ card: cardData, settings, history: fullHistory });
        return { rows, text: rows.map(r => `${r.emoji} ${r.key}: ${r.value}`).join('\n'), generated: true };
      })(),
      (async () => {
        if (!settings.plotAuto || !speech) return [];
        return genPlotOptions({
          card: cardData, settings,
          history: [...fullHistory, { role: 'assistant', content: speech }],
        });
      })(),
    ]);

    // ---- 落库 ----
    const t2 = now();
    await exec(
      `INSERT INTO messages (archive_id, role, status, content, status_bar, plot_options, model_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [a.id, 'assistant', msgStatus, speech, barResult.text,
       JSON.stringify(optionResult), settings.modelId, t2 + 1]);
    await exec('UPDATE archives SET message_count=message_count+2, updated_at=? WHERE id=?', [t2, a.id]);
    await exec('UPDATE character_cards SET chat_count=chat_count+1 WHERE id=?', [card.id]);

    // ---- 计费(按字符估算 token) ----
    const estTokens = Math.ceil(full.length / 1.6);
    let cost = Math.max(1, Math.ceil((estTokens / 1000) * mi.creditPer1k));
    if (barResult.generated) cost += 10;
    if (optionResult.length) cost += 20;
    if (settings.knowledgeEnabled) cost += 50;

    const balance = await addCredits(user.id, -cost, 'chat', `对话 · ${mi.displayName}`);
    await exec("UPDATE user_tasks SET done=1, updated_at=? WHERE user_id=? AND task_key='first_chat'",
      [now(), user.id]);

    send('status', { rows: barResult.rows || [] });
    if (optionResult.length) send('options', { items: optionResult });
    send('done', {
      messageStatus: msgStatus,
      credits: cost, balance,
      model: mi.displayName, modelSource: mi.source,
      promptStats: prompt.stats,
      speechChars: speech.length,
    });

    res.end();

      // 异步抽记忆
    if (settings.knowledgeEnabled && speech) {
      extractKnowledge({
        user, card: cardData,
        history: [...fullHistory, { role: 'assistant', content: speech }],
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[stream]', e);
    try { send('error', { message: String(e.message || e).slice(0, 200) }); } catch {}
    res.end();
  }
}
