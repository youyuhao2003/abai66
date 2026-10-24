// 大模型接入:OpenAI 兼容协议
// 优先读后台配置(admin_config),没有再用环境变量/默认值
import { cfg } from './config.mjs';

const FALLBACK_BASE  = process.env.LLM_BASE  || 'https://api.openai.com';
const FALLBACK_KEY   = process.env.LLM_KEY   || '';
const FALLBACK_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

async function creds() {
  let base = FALLBACK_BASE, key = FALLBACK_KEY, model = FALLBACK_MODEL;
  try {
    base  = (await cfg('llm.base', ''))  || FALLBACK_BASE;
    key   = (await cfg('llm.key', ''))   || FALLBACK_KEY;
    model = (await cfg('llm.defaultModel', '')) || FALLBACK_MODEL;
  } catch {}
  if (!key) {
    throw new Error('未配置 LLM 密钥：请在后台「全局参数 → LLM 接入」填写，或设置环境变量 LLM_KEY');
  }
  return { base: String(base).replace(/\/+$/, ''), key: String(key), model: String(model) };
}

export const MODELS = [
  { id: 'deepseek-v4.1-flash', name: '创镜 Flash', desc: '快速响应 · 日常闲聊', creditPer1k: 3,  default: true },
  { id: 'deepseek-v4-pro',     name: '创镜 Pro',   desc: '长上下文 · 细腻演绎', creditPer1k: 8,  default: false },
  { id: 'glm-5.3',             name: '创镜 GLM',   desc: '中文理解 · 剧情向',   creditPer1k: 6,  default: false },
];

export function modelById(id) {
  return MODELS.find(m => m.id === id) || MODELS[0];
}

/**
 * 调用 chat/completions
 * @param {object} p
 * @param {string} p.system       system prompt
 * @param {Array<{role,content}>} p.messages
 * @param {string} [p.model]
 * @param {number} [p.temperature]
 * @param {number} [p.maxTokens]
 */
export async function chat({ system, messages, model, temperature = 0.9, maxTokens = 800 }) {
  const started = Date.now();
  const C = await creds();
  if (!model) model = C.model;
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${C.base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + C.key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
    }
    const j = JSON.parse(text);
    const msg = j.choices?.[0]?.message || {};
    return {
      content: msg.content ?? '',
      reasoning: msg.reasoning_content ?? null,
      usage: j.usage ?? {},
      model: j.model ?? model,
      latency: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 流式版本,返回 async generator of delta strings */
export async function* chatStream({ system, messages, model, temperature = 0.9, maxTokens = 800 }) {
  const C = await creds();
  if (!model) model = C.model;
  const body = {
    model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };
  const res = await fetch(`${C.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + C.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta?.content;
        if (d) yield d;
      } catch {}
    }
  }
}

/** 组装角色扮演的 system prompt */
export function buildSystemPrompt(card) {
  const base = [
    `你现在要扮演一个虚构角色,与用户进行沉浸式角色扮演对话。`,
    `角色名:${card.name}`,
    card.nickname ? `其他称呼:${card.nickname}` : '',
    (card.tags && card.tags.length) ? `角色标签:${card.tags.join('、')}` : '',
    card.creator_notes ? `角色设定:\n${card.creator_notes}` : '',
    card.system_prompt ? `额外设定:\n${card.system_prompt}` : '',
    '',
    '要求:',
    '1. 始终保持角色口吻,不要跳出角色,不要提及自己是 AI、模型或助手。',
    '2. 用简体中文,以「动作/神态描写 + 对白」的形式回应,单次 60~160 字。',
    '3. 称呼用户时使用中性自然的称呼（如「你」「喂」或角色设定里给定的称呼）;',
    '   不要自行发明「宝宝」「老公」「亲爱的」这类亲昵称呼,除非角色设定明确要求。',
    '4. 语气、用词要贴合角色的年龄、职业与性格,不要过度热情或油腻。',
    '5. 不要复述用户的话,直接延续剧情。',
    '6. 内容保持在健康的日常、情感、剧情互动范围内。',
  ];
  return base.filter(Boolean).join('\n');
}
