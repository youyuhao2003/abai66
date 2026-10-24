// 对话引擎验证:状态栏 / 剧情选项 / 设置 / 人设 / 长期记忆
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const R = [];
const ok = (n, c, x='') => { R.push({n,c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };

async function A(action, body = {}) {
  const h = {'Content-Type':'application/json', Authorization:'Bearer '+apiKey};
  const r = await fetch(`${B}/api/${action}`, {method:'POST', headers:h, body: JSON.stringify({_enc: enc(body)})});
  const t = await r.text;
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,100)}; }
  return {status:r.status, body: j && j._enc ? dec(j._enc) : j};
}

// 登录
const uid = 440000 + Math.floor(Math.random*900);
{
  const user = {id: uid, first_name:'引擎测试', username:'eng'+uid};
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({clientId:'eng', fingerprint:'fp', device:{platform:'node'}, initData})});
  const j = await r.json;
  apiKey = j.apiKey;
  ok('登录', !!apiKey);
}

// 1. 设置默认值是否符合预期
{
  const r = await A('get-chat-settings');
  const s = r.body.settings;
  ok('默认 modelId=2 (Flash)', s.modelId === 2, String(s.modelId));
  ok('默认 maxContext=10000', s.maxContextTokens === 10000, String(s.maxContextTokens));
  ok('默认 maxOutput=400', s.maxOutputTokens === 400, String(s.maxOutputTokens));
  ok('默认 maxCharacter=3000', s.maxCharacterTokens === 3000, String(s.maxCharacterTokens));
  ok('默认 contentFormat=roleplay', s.contentFormat === 'roleplay');
  ok('默认 statusBarAuto=true', s.statusBarAuto === true);
  ok('默认 statusBarMaxTokens=300', s.statusBarMaxTokens === 300);
  ok('默认 plotAuto=false', s.plotAuto === false);
  ok('默认 plotOptionsCount=4', s.plotOptionsCount === 4);
  ok('默认 knowledgeEnabled=false', s.knowledgeEnabled === false);
  ok('默认 imageAspectRatio=PORTRAIT', s.imageAspectRatio === 'PORTRAIT');
  ok('默认 imageCharacterWeight=0.6', s.imageCharacterWeight === 0.6);
  ok('返回 8 个模型', r.body.models.length === 8,
     r.body.models.map(m=>m.name).join('/'));
  ok('返回 limits', !!r.body.limits.maxContextTokens);
  ok('NON_VIP_MAX_CONTEXT=16000', r.body.constants.NON_VIP_MAX_CONTEXT_TOKENS === 16000);
}

// 2. 设置夹紧逻辑
{
  // 非 VIP 上下文上限 16000
  const r1 = await A('update-chat-settings', { settings: { maxContextTokens: 68000 } });
  ok('非 VIP 上下文被夹到 16000', r1.body.settings.maxContextTokens === 16000,
     String(r1.body.settings.maxContextTokens));

  // 输出不能超过上下文 1/20
  const r2 = await A('update-chat-settings', { settings: { maxOutputTokens: 3200 } });
  ok('输出被夹到 800 (16000/20)', r2.body.settings.maxOutputTokens === 800,
     String(r2.body.settings.maxOutputTokens));

  // 人设不能超过上下文 30%
  const r3 = await A('update-chat-settings', { settings: { maxCharacterTokens: 15000 } });
  ok('人设被夹到 4800 (16000x30%)', r3.body.settings.maxCharacterTokens === 4800,
     String(r3.body.settings.maxCharacterTokens));

  // 步长对齐
  const r4 = await A('update-chat-settings', { settings: { maxContextTokens: 12345 } });
  ok('步长对齐到 13000', r4.body.settings.maxContextTokens === 13000,
     String(r4.body.settings.maxContextTokens));
}

// 3. 人设
{
  const p = await A('upsert-persona', { name:'我自己', description:'一个普通上班族,喜欢深夜散步。' });
  ok('创建人设', p.status === 200 && !!p.body.id, String(p.body.id));
  const list = await A('list-personas');
  ok('人设列表', list.body.items.length === 1);
  const act = await A('activate-persona', { id: p.body.id });
  ok('启用人设', act.body.activePersonaId === p.body.id);
  globalThis.personaId = p.body.id;
}

// 4. 打开状态栏 + 剧情选项,发起对话
{
  await A('update-chat-settings', { settings: {
    statusBarAuto: true, plotAuto: true, plotOptionsCount: 4, knowledgeEnabled: true,
  }});

  const cards = await A('list-public-character-cards', { sortBy:'trending' });
  const card = cards.body.items[0];
  globalThis.cardId = card.id;
  ok('选到测试角色', !!card.id, card.data.name);

  const t0 = Date.now;
  const r = await A('create-chat-completion', { characterCardId: card.id, message:'今天加班到很晚,有点累。' });
  const dt = Date.now - t0;

  ok('对话成功', r.status === 200 && !!r.body.reply, `${dt}ms`);
  console.log('      回复:', String(r.body.reply||'').slice(0, 70));

  ok('返回状态栏数组', Array.isArray(r.body.statusBar) && r.body.statusBar.length > 0,
     `${r.body.statusBar?.length ?? 0} 项`);
  if (r.body.statusBar?.length) {
    const s = r.body.statusBar;
    console.log('      状态栏:', s.map(x=>`${x.emoji}${x.key}:${x.value}`).join(' | '));
    ok('状态栏含 emoji/key/value', s.every(x => x.emoji && x.key && x.value !== undefined));
    ok('数值项解析出百分比', s.some(x => x.percent !== null));
  }

  ok('返回剧情选项', Array.isArray(r.body.plotOptions) && r.body.plotOptions.length === 4,
     `${r.body.plotOptions?.length ?? 0} 条`);
  if (r.body.plotOptions?.length) {
    r.body.plotOptions.forEach((o,i) => console.log(`      选项${i+1} [${o.type}] ${o.text}`));
    ok('选项含 type/text', r.body.plotOptions.every(o => o.type && o.text));
  }

  ok('prompt 统计返回', !!r.body.promptStats && r.body.promptStats.systemChars > 0,
     `system ${r.body.promptStats?.systemChars} 字符, 历史 ${r.body.promptStats?.historyUsed} 条`);
  ok('计费含附加项', r.body.credits >= 1, `-${r.body.credits}`);
}

// 5. 长期记忆(异步抽出,轮询等待)
{
  let items = [];
  for (let i = 0; i < 15; i++) {
    const k = await A('list-knowledge', { characterCardId: globalThis.cardId });
    items = k.body.items || [];
    if (items.length) break;
    await new Promise(s => setTimeout(s, 1000));
  }
  ok('长期记忆已写入(异步)', items.length > 0, `${items.length} 条`);
  if (items.length) {
    items.slice(0,3).forEach(it => console.log(`      [${it.kind}] ${it.content}`));
  }
}

// 6. 状态栏解析工具
{
  const r = await A('parse-status-block', { text: '❤️ 好感度: 70%\n🧠 情绪: 平静\n🏠 场景: 房间' });
  ok('状态栏解析', r.body.rows.length === 3 && r.body.rows[0].percent === 70,
     JSON.stringify(r.body.rows[0]));
}

// 7. 游戏模式切换
{
  const r = await A('update-chat-settings', { settings: { contentFormat: 'novel' } });
  ok('切换沉浸小说', r.body.settings.contentFormat === 'novel');
  const r2 = await A('update-chat-settings', { settings: { contentFormat: 'script' } });
  ok('切换互动影院', r2.body.settings.contentFormat === 'script');
  const r3 = await A('update-chat-settings', { settings: { contentFormat: 'bad' } });
  ok('非法模式回落 roleplay', r3.body.settings.contentFormat === 'roleplay');
}

const p = R.filter(x=>x.c).length;
console.log(`\n===== ${p}/${R.length} 通过 =====`);
process.exit(p===R.length?0:1);
