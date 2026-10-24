// 无界创镜 AI 服务端(MySQL 版)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptPayload, decryptPayload } from './lib/crypto.mjs';
import { q, q1, exec, now, rid, createUser, findUserByTelegram, issueApiKey, userByApiKey } from './lib/db.mysql.mjs';
import { actions, PUBLIC_ACTIONS, coverageReport } from './lib/actions_registry.mjs';
import { chatStream, buildSystemPrompt } from './lib/llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const BOT_TOKEN = process.env.TG_BOT_TOKEN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const out = {};
  for (const [k, v] of params) out[k] = v;
  let user = null;
  if (out.user) { try { user = JSON.parse(out.user); } catch {} }
  return { raw: out, user, hash: out.hash };
}

function verifyInitData(initData, botToken) {
  const { raw, hash } = parseInitData(initData);
  if (!botToken) return { ok: true, mode: 'demo-no-bot-token' };
  if (!hash) return { ok: false, reason: 'missing hash' };
  const pairs = Object.entries(raw).filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  if (calc.length !== hash.length) return { ok: false, reason: 'hash mismatch' };
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return { ok: false, reason: 'hash mismatch' };
  const age = Math.floor(Date.now() / 1000) - Number(raw.auth_date || 0);
  if (age > 86400) return { ok: false, reason: 'initData expired' };
  return { ok: true, mode: 'verified' };
}

function send(res, status, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const bearer = req => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

// ---------- 占位图 ----------
function placeholderSVG(seed, i, w, h) {
  let hash = 0;
  for (let k = 0; k < seed.length; k++) hash = (hash * 31 + seed.charCodeAt(k)) % 360;
  const hue = (hash + i * 47) % 360;
  const hue2 = (hue + 60) % 360;
  const label = seed.slice(0, 6).replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},48%,34%)"/>
      <stop offset="55%" stop-color="hsl(${hue2},44%,22%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 180) % 360},40%,12%)"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="hsl(${hue},55%,46%)" stop-opacity=".85"/>
      <stop offset="70%" stop-color="hsl(${hue2},40%,18%)" stop-opacity=".35"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%" stop-color="#05030a" stop-opacity="0"/>
      <stop offset="100%" stop-color="#05030a" stop-opacity=".95"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  <ellipse cx="${w/2}" cy="${h*0.92}" rx="${w*0.46}" ry="${h*0.34}" fill="rgba(0,0,0,.55)"/>
  <circle cx="${w/2}" cy="${h*0.34}" r="${w*0.13}" fill="rgba(255,255,255,.16)"/>
  <text x="${w/2}" y="${h*0.38}" font-family="sans-serif" font-size="${Math.round(w*0.075)}"
        font-weight="700" fill="rgba(255,255,255,.72)" text-anchor="middle">${label}</text>
  <rect width="${w}" height="${h}" fill="url(#s)"/>
  </svg>`;
}

async function handleAuth(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req) || '{}'); }
  catch { return send(res, 400, { error: 'InvalidRequest', message: 'Invalid JSON body.' }); }
  const initData = payload.initData;
  if (typeof initData !== 'string' || !initData) {
    return send(res, 400, { error: 'InvalidRequest', message: 'initData is required and must be a string.' });
  }
  const v = verifyInitData(initData, BOT_TOKEN);
  if (!v.ok) {
    return send(res, 401, { error: 'AuthFailed', message: 'Telegram authentication failed: invalid initData.' });
  }
  const { user: tg } = parseInitData(initData);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';

  const { register, login } = await import('./lib/users.mjs');
  try {
    const { user } = await register(tg ? {
      telegramId: tg.id, firstName: tg.first_name, lastName: tg.last_name,
      username: tg.username, languageCode: tg.language_code,
    } : null, { ip, clientId: payload.clientId || '', userAgent: ua, platform: String(payload.device?.platform || '') });
    const sess = await login(user, { ip, userAgent: ua, platform: String(payload.device?.platform || ''), clientId: payload.clientId || '' });
    console.log(`[auth] ${user.id} (${v.mode})`);
    return send(res, 200, { apiKey: sess.apiKey, userId: sess.userId, sessionId: sess.sessionId, verifyMode: v.mode });
  } catch (e) {
    if (e.code === 'BANNED') return send(res, 403, { error: 'Banned', message: e.reason || '账号已被封禁' });
    if (e.code === 'GONE') return send(res, 404, { error: 'NotFound', message: '账号不存在' });
    return send(res, 400, { error: 'AuthFailed', message: e.message });
  }
}

async function handleAction(req, res, actionName) {
  const raw = await readBody(req);
  let body = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    body = parsed && parsed._enc ? decryptPayload(parsed._enc) : parsed;
  } catch {
    return send(res, 400, { error: 'BadEncryptedPayload', message: 'cannot decrypt body' });
  }

  const key = bearer(req);
  const user = key ? await userByApiKey(key) : null;

  if (!user && !PUBLIC_ACTIONS.has(actionName)) {
    return send(res, 401, { error: 'Unauthorized', message: 'Authorization required.' });
  }

  const handler = actions[actionName];
  if (!handler) return send(res, 404, { error: 'NotFound', message: 'Unknown action: ' + actionName });

  try {
    const result = await handler({ user }, body || {});
    if (result && result.__status) {
      const { __status, ...rest } = result;
      return send(res, __status, { _enc: encryptPayload(rest) });
    }
    return send(res, 200, { _enc: encryptPayload(result) });
  } catch (e) {
    console.error('[action error]', actionName, e);
    return send(res, 500, { _enc: encryptPayload({ error: 'InternalError', message: String(e.message || e) }) });
  }
}

// SSE 流式对话(明文 SSE,仅用于演示打字机效果)
async function handleChatStream(req, res) {
  const raw = await readBody(req);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }

  const user = await userByApiKey(bearer(req));
  if (!user) return send(res, 401, { error: 'Unauthorized' });

  const { userMessage, characterCardId, modelId } = body;
  const card = await q1("SELECT * FROM character_cards WHERE id = ? AND status='public'", [characterCardId]);
  if (!card) return send(res, 404, { error: 'card not found' });

  const { MODELS } = await import('./lib/llm.mjs');
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const tags = (() => { try { return JSON.parse(card.tags || '[]'); } catch { return []; } })();
  const system = buildSystemPrompt({
    name: card.name, nickname: card.nickname, tags,
    creator_notes: card.creator_notes, system_prompt: card.system_prompt,
  });

  const history = await q(
    `SELECT m.role, m.content FROM messages m
     JOIN archives a ON a.id = m.archive_id
     WHERE a.user_id = ? AND a.character_card_id = ?
     ORDER BY m.id DESC LIMIT 12`, [user.id, card.id]);
  history.reverse();

  try {
    for await (const delta of chatStream({
      system,
      messages: [...history, { role: 'user', content: userMessage }],
      model: model.id,
    })) {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: String(e.message) })}\n\n`);
  }
  res.end();
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.join(__dirname, 'public');
  const filePath = path.join(root, rel);
  if (!filePath.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    });
    return res.end();
  }

  try {
    if (p === '/api/placeholder-image') {
      const w = Math.min(1024, Number(url.searchParams.get('w') || 512));
      const h = Math.min(1024, Number(url.searchParams.get('h') || 512));
      const seed = url.searchParams.get('seed') || 'x';
      const i = Number(url.searchParams.get('i') || 0);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end(placeholderSVG(seed, i, w, h));
    }
    // ---------- 后台 ----------
    if (p === '/admin' || p === '/admin/' || p.startsWith('/admin/')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    }
    if (p.startsWith('/api/admin/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'MethodNotAllowed' });
      const token = req.headers['x-admin-token'] || '';
      const cfg = await q1("SELECT v FROM admin_config WHERE k='security.adminToken'");
      const expect = process.env.ADMIN_TOKEN || (cfg?.v || 'change-me-please');
      if (token !== expect) return send(res, 401, { error: 'Unauthorized', message: '后台令牌无效' });

      const action = p.slice('/api/admin/'.length);
      const { adminActions } = await import('./lib/admin_api.mjs');
      const h = adminActions[action];
      if (!h) return send(res, 404, { error: 'NotFound', message: '未知管理操作: ' + action });

      let body = {};
      try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      try {
        const out = await h({ actor: 'admin', ip }, body);
        if (out && out.__status) { const { __status, ...rest } = out; return send(res, __status, rest); }
        return send(res, 200, out);
      } catch (e) {
        console.error('[admin]', action, e);
        return send(res, 500, { error: 'InternalError', message: String(e.message || e) });
      }
    }

    if (p === '/api/chat-stream' && req.method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch {}
      const key = bearer(req);
      const user = key ? await userByApiKey(key) : null;
      if (!user) return send(res, 401, { error: 'Unauthorized' });
      const { handleStreamChat } = await import('./lib/stream_chat.mjs');
      return await handleStreamChat(req, res, user, body);
    }
    if (p === '/api/auth-webapp' && req.method === 'POST') return await handleAuth(req, res);
    if (p === '/api/chat-stream' && req.method === 'POST') return await handleChatStream(req, res);
    if (p.startsWith('/api/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'MethodNotAllowed' });
      return await handleAction(req, res, p.slice('/api/'.length));
    }
    if (p.startsWith('/pay/')) {
      const orderId = p.slice('/pay/'.length);
      const o = await q1('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (!o) { res.writeHead(404); return res.end('order not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>支付确认</title>
<style>body{font-family:system-ui;background:#0f0b1a;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
.box{background:#1a1330;padding:32px;border-radius:20px;text-align:center;max-width:360px}
b{color:#b79cff}button{margin-top:20px;padding:14px 28px;border:0;border-radius:14px;
background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;font-size:16px;cursor:pointer}</style>
<div class="box"><h2>无界创镜 AI 收银台</h2><p>订单 <b>${o.id}</b></p>
<p>金额 <b>$${o.price}</b></p><p>到账额度 <b>${o.credits}</b></p>
<button onclick="pay()">模拟支付成功</button>
<script>
async function pay(){
  const r = await fetch('/api/simulate-payment-callback',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('xy_api_key')},
    body:JSON.stringify({orderId:'${o.id}'})});
  document.body.innerHTML='<div class=box><h2>支付成功</h2><p>额度已到账</p></div>';
  window.opener && window.opener.postMessage({type:'paid'},'*');
  setTimeout(()=>window.close(),1200);
}
</script>`);
    }
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'InternalError', message: String(e.message || e) });
  }
});

// 初始化数据: 执行 sql/seed_config.sql,或 node seed_roommate.mjs 导入示例角色
server.listen(PORT, HOST, () => {
  console.log(`\n  无界创镜 AI (MySQL 版) 已启动`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  DB: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'wujie_tavern'}`);
  console.log(`  LLM: ${process.env.LLM_MODEL || 'deepseek-v4.1-flash'}`);
  console.log(`  bot token 校验: ${BOT_TOKEN ? '严格模式' : '演示模式'}\n`);
});
