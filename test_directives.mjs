// 指令系统 / 重新生成 / 会话管理 测试
import { encryptPayload as enc, decryptPayload as dec } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
let apiKey = null;
const R = [];
const ok = (n,c,x='') => { R.push({n,c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };

async function A(a, b = {}) {
  const r = await fetch(`${B}/api/${a}`, { method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer '+apiKey},
    body: JSON.stringify({_enc: enc(b)}) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {raw:t.slice(0,100)}; }
  return { status:r.status, body: j && j._enc ? dec(j._enc) : j };
}

// 登录
const uid = 330000 + Math.floor(Math.random()*900);
{
  const user = { id: uid, first_name:'指令测试', username:'dir'+uid };
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ clientId:'dir', fingerprint:'fp', device:{platform:'node'}, initData }) });
  const j = await r.json();
  apiKey = j.apiKey;
  ok('登录', !!apiKey);
}

// 1. 指令类型元数据
{
  const r = await A('get-directive-types');
  const types = r.body.types || [];
  ok('返回 6 种指令', types.length === 6, types.map(t=>t.label).join('/'));
  ok('含剧情续写', types.some(t=>t.key==='Continue' && t.label==='剧情续写'));
  ok('含设定覆盖', types.some(t=>t.key==='SettingOverride'));
  ok('每种带 hint/placeholder', types.every(t=>t.hint && t.placeholder));
  ok('快捷格式 4 项', (r.body.quickFormat||[]).length === 4,
     (r.body.quickFormat||[]).map(q=>q.label).join('/'));
  ok('错误文案齐备', !!r.body.errors?.statusBlockOnly && !!r.body.errors?.streamInterrupted);
  ok('付费墙文案', r.body.paywall?.insufficientCreditsTitle?.includes('好多话'));
}

// 2. 角色卡
let cardId;
{
  const c = await A('list-public-character-cards', { sortBy:'trending' });
  cardId = c.body.items[0].id;
  ok('选卡', !!cardId, c.body.items[0].data.name);
}

// 3. 六种指令逐个跑
const directiveCases = [
  ['Continue', '让气氛慢慢紧张起来'],
  ['Expand', '她在门口拦住我，说出那个秘密'],
  ['CustomStyleOverride', '用更克制的笔调，多写环境'],
  ['SceneTransition', '跳到三天后的深夜，天台'],
  ['PerspectiveSwitch', '切到她的第一人称视角'],
  ['SettingOverride', '我突然能听见她的心声'],
];
for (const [type, text] of directiveCases) {
  const r = await A('create-chat-completion', { characterCardId: cardId, directiveType: type, directiveText: text });
  const okAll = r.status === 200 && r.body.success && r.body.directive === type;
  ok(`指令 ${type}`, okAll,
     r.status === 200 ? `回复 ${String(r.body.reply||'').length} 字` : `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
}

// 4. 非法指令
{
  const r = await A('create-chat-completion', { characterCardId: cardId, directiveType: 'NotExist', directiveText: 'x' });
  ok('非法指令被拒', r.status === 400);
}

// 5. 空消息也被拒
{
  const r = await A('create-chat-completion', { characterCardId: cardId });
  ok('空消息被拒', r.status === 400);
}

// 6. 重新生成
{
  const r = await A('regenerate-message', { characterCardId: cardId });
  ok('重新生成', r.status === 200 && !!r.body.reply, `${r.body.credits} 额度`);
  if (r.body.warning) console.log('      warning:', r.body.warning.slice(0, 40));
}

// 7. 消息状态字段
{
  const r = await A('get-archive', { characterCardId: cardId });
  const msgs = r.body.messages || [];
  ok('消息含 status 字段', msgs.length > 0 && msgs.every(m => m.status !== undefined),
     `${msgs.length} 条`);
  ok('指令消息已记录', msgs.some(m => m.directive), msgs.filter(m=>m.directive).length + ' 条带指令');
}

// 8. 会话管理
{
  const a = await A('list-archives');
  ok('会话列表', (a.body.items||[]).length >= 1);
  const id = a.body.items[0].id;

  const pin = await A('update-archive', { archiveId: id, pinned: true });
  ok('置顶会话', pin.status === 200);

  const rename = await A('update-archive', { archiveId: id, title: '我的存档' });
  ok('重命名会话', rename.status === 200);

  const a2 = await A('list-archives');
  const item = a2.body.items.find(x => x.id === id);
  ok('置顶与标题已生效', item?.title === '我的存档' && item?.pinned === true,
     JSON.stringify({ title:item?.title, pinned:item?.pinned }));
}

// 9. 角色下架拦截
{
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ host:'127.0.0.1', port: Number(process.env.DB_PORT || 3306), user:'root',
    password:'', database: process.env.DB_NAME || 'wujie_tavern', charset:'utf8mb4' });
  await conn.query('UPDATE character_cards SET is_banned=1, ban_reason=? WHERE id=?', ['测试下架', cardId]);
  const r = await A('create-chat-completion', { characterCardId: cardId, message: '你好' });
  ok('下架角色拒绝对话', r.status === 403 && r.body.banned === true, r.body.error);
  await conn.query('UPDATE character_cards SET is_banned=0, ban_reason=NULL WHERE id=?', [cardId]);
  await conn.end();
  const r2 = await A('create-chat-completion', { characterCardId: cardId, message: '你好' });
  ok('恢复后可对话', r2.status === 200);
}

const p = R.filter(x=>x.c).length;
console.log(`\n===== ${p}/${R.length} 通过 =====`);
process.exit(p===R.length?0:1);
