// 对话引擎:对齐对话协议的 prompt 组装、状态栏、剧情选项、长期记忆
import { q, q1, exec, now, rid, addCredits } from './db.mysql.mjs';
import { chat } from './llm.mjs';

// ========== 默认参数 ==========
export const LIMITS = {
  maxContextTokens:      { min: 7000, max: 68000, step: 1000, default: 10000 },
  maxOutputTokens:       { min: 300,  max: 3200,  step: 100,  default: 800 },
  maxCharacterTokens:    { min: 2000, max: 15000, step: 1000, default: 3000 },
  scriptMaxOutputTokens: { min: 300,  max: 800,   step: 100,  default: 500 },
  miniappMaxOutputTokens:{ min: 300,  max: 3000,  step: 100,  default: 800 },
  statusBarMaxTokens:    { min: 200,  max: 2000,  step: 100,  default: 300 },
};

export const CONSTS = {
  KNOWLEDGE_AUTO_GEN_COST: 200,
  MAX_CHARACTER_TOKENS_RATIO: 0.3,
  MAX_CHAT_MESSAGE_LENGTH: 2048,
  MAX_PERSONAS_PER_USER: 10,
  MAX_USER_PERSONA_LENGTH: 1000,
  MIN_CONTEXT_TO_OUTPUT_RATIO: 20,
  NON_VIP_MAX_CONTEXT_TOKENS: 16000,
};

export const MODEL_REGISTRY = {
  1: { displayName: 'Lite',     tier: 'low',  creditPer1k: 1 },
  2: { displayName: 'Flash',    tier: 'low',  creditPer1k: 3 },
  3: { displayName: 'Ultimate', tier: 'high', creditPer1k: 12 },
  4: { displayName: 'Prime',    tier: 'high', creditPer1k: 15 },
  5: { displayName: 'Max',      tier: 'mid',  creditPer1k: 8 },
  6: { displayName: 'Apex',     tier: 'mid',  creditPer1k: 9 },
  7: { displayName: 'Heart',    tier: 'high', creditPer1k: 12 },
  8: { displayName: 'Spark',    tier: 'mid',  creditPer1k: 7 },
};

// 映射到实际可用的底层模型
export const MODEL_BACKEND = {
  1: 'deepseek-v4.1-flash', 2: 'deepseek-v4.1-flash',
  3: 'deepseek-v4-pro', 4: 'deepseek-v4-pro',
  5: 'deepseek-v4-pro', 6: 'deepseek-v4-pro',
  7: 'deepseek-v4-pro', 8: 'deepseek-v4.1-flash',
};

// ---------- 后台配置优先 ----------
// 后台没配或没启用时,回落到上面的硬编码兜底
import { textModel as _tm } from './config.mjs';

/** 取模型信息(优先后台配置) */
export async function getModelInfo(id) {
  try {
    const m = await _tm(id);
    if (m) {
      return {
        displayName: m.displayName, tier: m.tier,
        creditPer1k: m.creditPer1k, backend: m.backend,
        maxTokens: m.maxTokens, temperature: m.temperature,
        vipOnly: m.vipOnly, source: 'admin',
      };
    }
  } catch {}
  const reg = MODEL_REGISTRY[id] || MODEL_REGISTRY[2];
  return {
    displayName: reg.displayName, tier: reg.tier,
    creditPer1k: reg.creditPer1k,
    backend: MODEL_BACKEND[id] || MODEL_BACKEND[2],
    maxTokens: 800, temperature: 0.9, vipOnly: false, source: 'fallback',
  };
}

/** 同步版本(仅用于不需要真实时性的展示) */
export function getModelInfoSync(id) {
  const reg = MODEL_REGISTRY[id] || MODEL_REGISTRY[2];
  return {
    displayName: reg.displayName, tier: reg.tier, creditPer1k: reg.creditPer1k,
    backend: MODEL_BACKEND[id] || MODEL_BACKEND[2], maxTokens: 800, temperature: 0.9,
    vipOnly: false, source: 'static',
  };
}

export const DEFAULTS = {
  modelId: 2,
  outputLanguageCode: 'zh-CN',
  contentFormat: 'roleplay',
  knowledgeEnabled: false,
  statusBarAuto: true,
  statusBarMaxTokens: 300,
  plotAuto: true,
  plotOptionsCount: 4,
  imageAutoGenerate: false,
  imageAutoSetBackground: false,
  imageCharacterWeight: 0.6,
  imageAspectRatio: 'PORTRAIT',
  imageResolution: 'SD',
  imageStyleId: 25,
  maxContextTokens: 10000,
  maxOutputTokens: 800,
  maxCharacterTokens: 3000,
  scriptMaxOutputTokens: 500,
};

// 按 step 对齐并夹紧
const snapCeil = (v, l) => Math.max(l.min, Math.min(l.max, Math.ceil(v / l.step) * l.step));
const snapFloor = (v, l) => Math.max(l.min, Math.min(l.max, Math.floor(v / l.step) * l.step));

export async function getUserSettings(userId) {
  let s = await q1('SELECT * FROM user_settings WHERE user_id=?', [userId]);
  if (!s) {
    await exec(`INSERT INTO user_settings (user_id, updated_at) VALUES (?,?)`, [userId, now()]);
    s = await q1('SELECT * FROM user_settings WHERE user_id=?', [userId]);
  }
  return {
    modelId: s.model_id,
    maxContextTokens: s.max_context_tokens,
    maxOutputTokens: s.max_output_tokens,
    maxCharacterTokens: s.max_character_tokens,
    scriptMaxOutputTokens: s.script_max_output_tokens,
    outputLanguageCode: s.output_language_code,
    contentFormat: s.content_format,
    knowledgeEnabled: !!s.knowledge_enabled,
    statusBarAuto: !!s.status_bar_auto,
    statusBarMaxTokens: s.status_bar_max_tokens,
    plotAuto: !!s.plot_auto,
    plotOptionsCount: s.plot_options_count,
    imageAutoGenerate: !!s.image_auto_generate,
    imageAutoSetBackground: !!s.image_auto_background,
    imageCharacterWeight: Number(s.image_character_weight),
    imageAspectRatio: s.image_aspect_ratio,
    imageResolution: s.image_resolution,
    imageStyleId: s.image_style_id,
    activePersonaId: s.active_persona_id,
  };
}

/** 保存设置,并把数值夹到合法区间 */
export async function saveUserSettings(userId, patch, isVip = false) {
  const cur = await getUserSettings(userId);
  const n = { ...cur, ...patch };

  n.maxContextTokens = snapCeil(Number(n.maxContextTokens), LIMITS.maxContextTokens);
  if (!isVip) n.maxContextTokens = Math.min(n.maxContextTokens, CONSTS.NON_VIP_MAX_CONTEXT_TOKENS);

  n.maxOutputTokens = snapCeil(Number(n.maxOutputTokens), LIMITS.maxOutputTokens);
  // 输出不能超过上下文的 1/20
  const maxByRatio = Math.floor(n.maxContextTokens / CONSTS.MIN_CONTEXT_TO_OUTPUT_RATIO);
  n.maxOutputTokens = Math.min(n.maxOutputTokens, Math.max(LIMITS.maxOutputTokens.min, maxByRatio));

  n.maxCharacterTokens = snapCeil(Number(n.maxCharacterTokens), LIMITS.maxCharacterTokens);
  // 人设最多占上下文的 30%
  n.maxCharacterTokens = Math.min(
    n.maxCharacterTokens,
    Math.floor(n.maxContextTokens * CONSTS.MAX_CHARACTER_TOKENS_RATIO));

  n.statusBarMaxTokens = snapCeil(Number(n.statusBarMaxTokens), LIMITS.statusBarMaxTokens);
  n.plotOptionsCount = Math.max(2, Math.min(6, Number(n.plotOptionsCount) || 4));
  n.imageCharacterWeight = Math.max(0, Math.min(1, Number(n.imageCharacterWeight)));
  if (!['roleplay', 'novel', 'script'].includes(n.contentFormat)) n.contentFormat = 'roleplay';
  if (!['zh-CN', 'zh-TW', 'en'].includes(n.outputLanguageCode)) n.outputLanguageCode = 'zh-CN';

  await exec(
    `UPDATE user_settings SET model_id=?, max_context_tokens=?, max_output_tokens=?,
     max_character_tokens=?, script_max_output_tokens=?, output_language_code=?, content_format=?,
     knowledge_enabled=?, status_bar_auto=?, status_bar_max_tokens=?, plot_auto=?, plot_options_count=?,
     image_auto_generate=?, image_auto_background=?, image_character_weight=?, image_aspect_ratio=?,
     image_resolution=?, image_style_id=?, active_persona_id=?, updated_at=?
     WHERE user_id=?`,
    [n.modelId, n.maxContextTokens, n.maxOutputTokens, n.maxCharacterTokens, n.scriptMaxOutputTokens,
     n.outputLanguageCode, n.contentFormat, n.knowledgeEnabled ? 1 : 0, n.statusBarAuto ? 1 : 0,
     n.statusBarMaxTokens, n.plotAuto ? 1 : 0, n.plotOptionsCount,
     n.imageAutoGenerate ? 1 : 0, n.imageAutoSetBackground ? 1 : 0, n.imageCharacterWeight,
     n.imageAspectRatio, n.imageResolution, n.imageStyleId, n.activePersonaId, now(), userId]);
  return n;
}

// ========== Prompt 组装 ==========
const LANG_NAME = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' };

const FORMAT_HINT = {
  roleplay: '以角色扮演方式回应:动作描写与对白交替,沉浸式互动。',
  novel: '以沉浸小说方式回应:连续叙事,第三人称视角,文笔细腻连贯。',
  script: '以互动影院方式回应:结构化影视式对话,先写场景标题,再写镜头与台词。',
};

/**
 * 组装完整 prompt
 * 返回 { system, messages, stats }
 */
export function buildPrompt({ card, settings, persona, knowledge, history, userText }) {
  const lang = LANG_NAME[settings.outputLanguageCode] || '简体中文';
  const fmt = FORMAT_HINT[settings.contentFormat] || FORMAT_HINT.roleplay;

  const parts = [];
  parts.push(`你正在扮演角色「${card.nickname || card.name}」，与用户进行沉浸式对话。`);

  if (card.name && card.nickname && card.name !== card.nickname) {
    parts.push(`作品名:${card.name}`);
  }

  // 人设区(受 maxCharacterTokens 限制)
  const charBudget = settings.maxCharacterTokens;
  const charParts = [];
  if (card.creator_notes) charParts.push(`背景设定:\n${card.creator_notes}`);
  if (card.personality) charParts.push(`性格特点:\n${card.personality}`);
  if (card.scenario) charParts.push(`场景设定:\n${card.scenario}`);
  if (card.appearance) charParts.push(`外观特征:\n${card.appearance}`);
  if (card.system_prompt) charParts.push(`额外指令:\n${card.system_prompt}`);

  let charText = charParts.join('\n\n');
  // 粗略按 1 字符 ≈ 1 token 截断
  if (charText.length > charBudget) charText = charText.slice(0, charBudget) + '…';
  if (charText) parts.push(charText);

  // 用户人设
  if (persona?.description) {
    const p = persona.description.slice(0, CONSTS.MAX_USER_PERSONA_LENGTH);
    parts.push(`用户扮演的角色({{user}}):\n${p}`);
  }

  // 示例对话
  if (card.example_dialogue) {
    const budget = Math.floor(charBudget * 0.3);
    parts.push(`对话示例(仅供参考语气):\n${card.example_dialogue.slice(0, budget)}`);
  }

  // 状态栏指令
  if (settings.statusBarAuto) {
    const sample = card.preset_status_block || '❤️ 好感度: 50%\n🧠 情绪: 平静\n🏠 场景: 室内';
    parts.push(
      `每次回复结束后，另起一个空行，输出角色状态栏：每行一条，格式为「emoji 键名: 值」，沿用下列键名：\n${sample}\n` +
      `注意：状态栏不要使用任何 markdown 标记（不要加 * ** - #），直接输出纯文本行。`
    );
  }

  // 长期记忆
  if (settings.knowledgeEnabled && knowledge?.length) {
    const mem = knowledge.slice(0, 20).map(k => `- [${k.kind}] ${k.content}`).join('\n');
    parts.push(`长期记忆(此前发生过的关键事实,请保持连贯):\n${mem}`);
  }

  // 写作风格
  parts.push(
    `输出要求:\n` +
    `- 语言:${lang}\n` +
    `- ${fmt}\n` +
    `- 不要提及自己是 AI 或模型\n` +
    `- 不要复述用户原话\n` +
    `- 称呼用户时使用中性自然的称呼(「你」「喂」或设定里给定的称呼);不要自行发明「宝宝」「老公」这类亲昵称呼,除非角色设定明确要求\n` +
    `- 语气、用词要贴合角色的年龄、职业与性格,不要过度热情或油腻`
  );

  // 视角规则
  parts.push(
    `【视角】\n` +
    `- 写角色自己的动作、神态、台词、心理。\n` +
    `- 也写「你」:①用户刚做的动作产生了什么身体效果(「被你掌心的力道按回去」「毯子被掀开的一瞬,凉气贴上皮肤」);` +
    `②「你」的感官与身体的被动反馈(手心触到的温度、听见的呼吸、皮肤上的潮意)。\n` +
    `- 不要给用户新增他没做的动作、不要替他说台词、不要写他的内心独白。用户抛什么,你只写它落下之后发生了什么。`
  );

  // 写作技法(决定质感的是什么)
  parts.push(
    `【写法】\n` +
    `- 感官密度:每段至少两处具体身体感受——温度、湿度、触感、力道、颤抖、呼吸、声音的质感。` +
    `不要写「她很紧张」,写「膝盖本能地并拢,又被按回去」。\n` +
    `- 微动作代替形容:睫毛、喉结、耳根、指尖、脚趾、指甲掐进掌心、抓着床单/衣角/靠垫。\n` +
    `- 台词要碎:用破折号表现被打断(「哥——」),用省略号表现说不下去(「你干嘛啊……」),` +
    `重要的话说到一半自己咽回去。不要写完整流畅的长句台词。\n` +
    `- 分段要按节拍:一个动作/一句话/一次反应各成一段,段落短。\n` +
    `- 场景里要有具体物件:毯子、丝带、拖鞋、遥控器、杯子、掉漆的缝。让身体和物件发生接触。\n` +
    `- 长度:400 字左右,不得少于 350 字。不足就是漏了节拍,回去补,不要靠重复情绪词凑数。\n` +
    `- 人称:始终用「你」指用户,不要写「他」「她」来指用户。角色自己用「她/他」或名字。\n` +
    `- 至少一处台词被截断:用破折号(「哥——」)或省略号(「你干嘛啊……」),让角色说到一半停下。`
  );

  // 结构示范(教节拍,不教内容)
  parts.push(
    `【每回合至少写满这 5 个节拍】\n` +
    `① 你的动作落下后,她的身体第一反应(哪个部位、什么感觉、有没有躲)\n` +
    `② 一句不完整的台词(用——或……断开)\n` +
    `③ 一个微动作 + 一句嘴硬或反击\n` +
    `④ 环境细节(风、光、声音、物件) + 她的下意识小动作\n` +
    `⑤ 一句情绪漏底的话(很短,可以只是一个称呼)\n\n` +
    `五个节拍都写到,自然就是 350 字以上。少了哪一个,读起来就是"干"。`
  );

  // 历史后指令
  if (card.post_history_instructions) {
    parts.push(card.post_history_instructions);
  }

  const system = parts.join('\n\n');

  // 历史裁剪:按 maxContextTokens 估算
  const budget = settings.maxContextTokens - Math.min(charText.length, charBudget) - 400;
  const msgs = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const len = String(m.content || '').length;
    if (used + len > budget) break;
    used += len;
    msgs.unshift({ role: m.role, content: m.content });
  }
  msgs.push({ role: 'user', content: userText });

  return {
    system,
    messages: msgs,
    stats: { systemChars: system.length, historyUsed: msgs.length - 1, budget },
  };
}

/** 从回复里剥离状态栏,返回 { speech, statusBlock }
 *  策略:从末尾倒序扫描,连续的状态行才算状态栏;遇到第一条非状态行立即停止。
 *  这样正文中间出现的「XX: YY」不会被误抽。
 */
export function splitStatusBlock(reply) {
  const raw = String(reply || '');
  const lines = raw.split('\n');

  // 单行是否是状态行:emoji + 短键名 + 冒号 + 值
  const isStatusLine = t => {
    if (!t) return false;
    const s = t.replace(/^[\*_]+|[\*_]+$/g, '').trim();
    if (!s) return false;
    // 必须以 emoji / 符号开头
    if (!/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u2B00-\u2BFF]/u.test(s)) return false;
    // 键名 1-12 字,后接冒号
    return /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u2B00-\u2BFF]+\s*[^\s:：]{1,12}\s*[:：]\s*\S/u.test(s);
  };

  // 从尾部往前收集连续状态行(允许中间夹空行)
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim === '') end--;
  if (end < 0) return { speech: raw.trim(), statusBlock: null };

  const collected = [];
  let i = end;
  while (i >= 0) {
    const t = lines[i].trim();
    if (t === '') { i--; continue; }
    if (isStatusLine(t)) { collected.unshift(t); i--; continue; }
    break;
  }

  if (collected.length < 2) {
    return { speech: raw.trim(), statusBlock: null };
  }

  // 正文 = 状态栏起始行之前的部分
  const speech = lines.slice(0, i + 1).join('\n').trim();
  return { speech, statusBlock: collected.join('\n') };
}

/** 解析状态栏文本为结构化行 */
export function parseStatusBlock(text) {
  if (!text) return [];
  const EMOJI = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u2B00-\u2BFF]/u;
  return String(text).split('\n').map(line => {
    const t = line.trim().replace(/^[\*_]+|[\*_]+$/g, '').trim();
    if (!t) return null;
    // 必须以 emoji 开头,且形如「emoji 键名: 值」
    if (!EMOJI.test(t)) return null;
    const m = t.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u2B00-\u2BFF]+)\s*([^\s:：]{1,12})\s*[:：]\s*(.*)$/u);
    if (!m) return null;
    const emoji = m[1];
    const key = m[2];
    const value = (m[3] || '').trim();
    const pct = value.match(/^(\d{1,3})\s*%$/);
    return {
      emoji, key, value,
      percent: pct ? Math.min(100, Number(pct[1])) : null,
    };
  }).filter(Boolean);
}

// ---------- 容错 JSON 解析 ----------
/** LLM 输出常被 max_tokens 截断,或被 ``` 包裹,这里做修复后解析 */
export function robustJSON(text, expect = 'array') {
  if (!text) return null;
  let t = String(text).replace(/```json|```/g, '').trim();

  const open = expect === 'array' ? '[' : '{';
  const close = expect === 'array' ? ']' : '}';
  const start = t.indexOf(open);
  if (start < 0) return null;
  t = t.slice(start);

  // 先尝试直接解析
  const endIdx = t.lastIndexOf(close);
  if (endIdx > 0) {
    try { return JSON.parse(t.slice(0, endIdx + 1)); } catch {}
  }

  // 截断修复:从后往前找完整的元素边界
  if (expect === 'array') {
    // 逐个 ] 位置尝试
    for (let i = t.length; i > 0; i--) {
      if (t[i - 1] !== '}') continue;
      const cand = t.slice(0, i) + ']';
      try { return JSON.parse(cand); } catch {}
    }
  } else {
    for (let i = t.length; i > 0; i--) {
      const cand = t.slice(0, i) + '}';
      try { return JSON.parse(cand); } catch {}
    }
  }
  return null;
}

/** 包裹 LLM 调用:失败自动重试一次(更短输出要求) */
async function callJSON(system, userContent, maxTokens, temperature = 0.9) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await chat({
        system: attempt === 0 ? system : system + '\n\n注意:输出必须完整、简短,确保 JSON 闭合。',
        messages: [{ role: 'user', content: userContent }],
        maxTokens: attempt === 0 ? maxTokens : Math.round(maxTokens * 1.5),
        temperature,
      });
      const parsed = robustJSON(r.content, system.includes('数组') ? 'array' : 'object');
      if (parsed) return parsed;
      console.error('[callJSON] parse failed, attempt', attempt, String(r.content).slice(0, 120));
    } catch (e) {
      console.error('[callJSON] error', attempt, e.message);
    }
  }
  return null;
}

/** 生成剧情选项 */
export async function genPlotOptions({ card, history, settings }) {
  const count = settings.plotOptionsCount;
  const ctx = history.slice(-8).map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 3000);

  const arr = await callJSON(
    `根据下面的剧情,为玩家生成 ${count} 个可点选的行动选项。
输出严格 JSON 数组,每项:{"type":"dialogue"|"action","text":"..."}
- dialogue 是台词,只用中文引号包裹台词本身,引号内不要再套括号动作
- action 是动作,只用中文括号包裹动作,不要再套引号台词
- 两条格式互斥,不要混用
- 每条 15~30 字,以玩家视角书写,精炼
- 要有区分度:推进 / 温和 / 回避 / 意外
只输出 JSON。`,
    ctx || `角色:${card.name}`,
    1400,
    1.0
  );

  if (!Array.isArray(arr)) return [];
  return arr.slice(0, count).map(o => {
    let type, text;
    if (typeof o === 'string') { type = 'dialogue'; text = o; }
    else { type = o.type === 'action' ? 'action' : 'dialogue'; text = String(o.text || ''); }
    return { type, text: normalizeOption(type, text) };
  }).filter(o => o.text);
}

/** 清洗选项格式:统一引号、拆掉嵌套的动作括号 */
export function normalizeOption(type, text) {
  let t = String(text || '').trim();
  if (!t) return '';

  const PAIRS = [['"', '"'], ['“', '”'], ['「', '」'],
                 ['『', '』'], ["'", "'"], ['‘', '’']];

  // 深度剥离最外层引号（支持多层嵌套）
  const stripOuter = str => {
    let x = String(str).trim();
    let guard = 0;
    while (guard++ < 6) {
      let hit = false;
      for (const [a, b] of PAIRS) {
        if (x.length > a.length + b.length && x.startsWith(a) && x.endsWith(b)) {
          x = x.slice(a.length, x.length - b.length).trim();
          hit = true;
        }
      }
      if (!hit) break;
    }
    return x;
  };

  // 提取括号动作（可能多段）
  const parenRe = /[（(]([^）)]{1,160})[）)]/g;
  const parens = [...t.matchAll(parenRe)].map(m => m[1].trim()).filter(Boolean);

  // 去掉所有括号段后的"纯文本"
  const withoutParens = t.replace(parenRe, ' ').replace(/\s{2,}/g, ' ').trim();

  // 纯文本里再剥引号 = 台词本体
  const speech = stripOuter(withoutParens);

  if (type === 'dialogue') {
    if (speech) return `“${speech}”`;
    // 只剩动作 -> 退化成动作
    if (parens.length) return `（${parens.join(' ')}）`;
    return '';
  }

  // action
  if (parens.length) {
    // 动作里若含引号台词，去掉引号部分
    const act = parens.map(x => stripOuter(x)).filter(Boolean).join('；');
    return `（${act}）`;
  }
  const bare = stripOuter(t);
  return bare ? `（${bare}）` : '';
}

/** 生成状态栏(独立调用,不占回复长度) */
export async function genStatusBar({ card, history, settings }) {
  const sample = card.preset_status_block
    || '❤️ 好感度: 50%\n🧠 情绪: 平静\n🏠 场景: 室内\n💭 想法: （在想别的事）';
  const ctx = history.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 3000);
  try {
    const r = await chat({
      system: `根据剧情,输出角色「${card.nickname || card.name}」当前的状态栏。
严格沿用下列键名与 emoji,格式为「emoji 键名: 值」,每行一条,共 ${sample.split('\n').length} 行:
${sample}
要求:
- 好感度、关系阶段这类数值必须写成百分比形式,例如「好感度: 55%」,不要省略百分号
- 其余用精炼词组(不超过 12 字)
- 上面列出的每个键都必须出现,一行一条,不要增删键
- 只输出状态栏本身,不要任何解释或前言`,
      messages: [{ role: 'user', content: ctx }],
      maxTokens: settings.statusBarMaxTokens,
      temperature: 0.7,
    });
    const block = r.content.trim();
    return parseStatusBlock(block);
  } catch {
    return parseStatusBlock(sample);
  }
}

/** 抽取长期记忆 */
export async function extractKnowledge({ user, card, history }) {
  const ctx = history.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 4000);
  try {
    const arr = await callJSON(
      `从对话中抽取值得长期记住的事实,输出 JSON 数组,每项:{"kind":"plot"|"character"|"relation"|"item","content":"..."}
- content 不超过 40 字,写清楚具体发生了什么
- 最多 3 条,没有值得记的就输出 []
只输出 JSON。`,
      ctx,
      900,
      0.6
    );
    if (!Array.isArray(arr)) return [];
    const saved = [];
    for (const it of arr.slice(0, 3)) {
      const kind = ['plot', 'character', 'relation', 'item'].includes(it.kind) ? it.kind : 'plot';
      await exec(
        `INSERT INTO knowledge_memories (user_id, character_card_id, kind, content, created_at)
         VALUES (?,?,?,?,?)`,
        [user.id, card.id, kind, String(it.content || '').slice(0, 500), now()]);
      saved.push({ kind, content: it.content });
    }
    return saved;
  } catch (e) { console.error('[extractKnowledge]', e.message);
    return [];
  }
}
