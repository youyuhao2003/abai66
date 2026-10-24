// 完整功能流程验证:从进场到每一个功能
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

const uid = 220000 + Math.floor(Math.random()*900);
{
  const user = { id: uid, first_name:'体验者', username:'demo'+uid };
  const initData = `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  const r = await fetch(`${B}/api/auth-webapp`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ clientId:'exp', fingerprint:'fp', device:{platform:'node'}, initData }) });
  apiKey = (await r.json()).apiKey;
  ok('① 登录', !!apiKey);
}

// 打开全功能
await A('update-chat-settings', { settings: {
  statusBarAuto: true, plotAuto: true, plotOptionsCount: 4, knowledgeEnabled: true,
  contentFormat: 'roleplay', modelId: 2,
}});

let cardId;
{
  const c = await A('list-public-character-cards', { sortBy:'trending' });
  cardId = c.body.items[0]?.id;
  const d = c.body.items[0]?.data || {};
  ok('② 剧本加载', !!cardId, `${d.nickname} · ${d.tier}`);
  ok('   字段齐全', !!d.creator_notes && !!d.personality && !!d.scenario && !!d.appearance,
     `描述${(d.creator_notes||'').length}字`);
  ok('   开场白存在', !!d.opening_line, `${(d.opening_line||'').length} 字`);
  globalThis.opening = d.opening_line || '';
}

// 开场白直接展示(不进对话)
console.log('\n--- 开场白 ---');
console.log(globalThis.opening.slice(0, 200));

// 第一轮对话
{
  console.log('\n--- 第一轮对话 ---');
  const r = await A('create-chat-completion', { characterCardId: cardId, message: '七个月了。你到底打算住到什么时候？' });
  ok('③ 对话生成', r.status === 200 && !!r.body.reply, `${r.body.credits} 额度`);
  console.log('回复:', String(r.body.reply || '').slice(0, 220));

  const sb = r.body.statusBar || [];
  ok('④ 状态栏', sb.length > 0, `${sb.length} 项`);
  sb.forEach(x => console.log(`   ${x.emoji} ${x.key}: ${x.value}${x.percent !== null ? ` (${x.percent}%)` : ''}`));

  const opts = r.body.plotOptions || [];
  ok('⑤ 剧情选项', opts.length === 4, `${opts.length} 条`);
  opts.forEach((o, i) => console.log(`   ${i+1}. [${o.type}] ${o.text}`));
  globalThis.lastReply = r.body.reply;
}

// 解锁画面
{
  console.log('\n--- 解锁画面 ---');
  const r = await A('gen-image-for-message', {
    context: `沈砚说：${String(globalThis.lastReply||'').slice(0,200)}`,
  });
  ok('⑥ 解锁画面', r.status === 200 && !!r.body.image?.url, r.body.image?.prompt?.slice(0,50));
}

// 六种指令
{
  console.log('\n--- 剧情指令 ---');
  const cases = [
    ['Continue', '让气氛慢慢紧张起来'],
    ['SceneTransition', '跳到卧室，灯只开了一盏'],
    ['PerspectiveSwitch', '切到沈砚的第一人称视角'],
  ];
  for (const [t, txt] of cases) {
    const r = await A('create-chat-completion', { characterCardId: cardId, directiveType: t, directiveText: txt });
    ok(`   指令 ${t}`, r.status === 200 && r.body.directive === t,
       `${String(r.body.reply||'').length} 字`);
  }
}

// 长期记忆
{
  console.log('\n--- 长期记忆 ---');
  let items = [];
  for (let i = 0; i < 15; i++) {
    const k = await A('list-knowledge', { characterCardId: cardId });
    items = k.body.items || [];
    if (items.length) break;
    await new Promise(s => setTimeout(s, 1000));
  }
  ok('⑦ 长期记忆', items.length > 0, `${items.length} 条`);
  items.slice(0, 3).forEach(it => console.log(`   [${it.kind}] ${it.content}`));
}

// 重新生成
{
  const r = await A('regenerate-message', { characterCardId: cardId });
  ok('⑧ 重新生成', r.status === 200 && !!r.body.reply);
}

// 打赏 / 评价 / 收藏 / 点赞
{
  const tip = await A('send-character-tip', { characterCardId: cardId, amount: 100, message: '写得好' });
  ok('⑨ 打赏', tip.status === 200);
  const rev = await A('upsert-review', { characterCardId: cardId, rating: 5, content: '氛围感很强。' });
  ok('⑩ 评价', rev.status === 200);
  const fav = await A('toggle-favorite', { characterCardId: cardId });
  ok('⑪ 收藏', fav.body.favorited === true);
  const like = await A('toggle-like', { characterCardId: cardId });
  ok('⑫ 点赞', like.body.liked === true);
}

// 会话管理
{
  const a = await A('list-archives');
  const id = a.body.items[0]?.id;
  ok('⑬ 会话列表', !!id, `${a.body.items[0]?.messageCount} 条消息`);
  await A('update-archive', { archiveId: id, pinned: true, title: '便利店之夜' });
  const a2 = await A('list-archives');
  const it = a2.body.items[0];
  ok('   置顶与改名', it.pinned === true && it.title === '便利店之夜');
}

// 世界书
{
  const wb = await A('list-public-world-books');
  ok('⑭ 世界书', (wb.body.items||[]).length > 0, wb.body.items[0]?.name,
     );
}

// 我的资料 / 余额
{
  const p = await A('get-user-profile');
  ok('⑮ 用户系统', !!p.body.userId, `余额 ${p.body.balance}`);
}

const passed = R.filter(x=>x.c).length;
console.log(`\n===== 全流程 ${passed}/${R.length} 通过 =====`);
process.exit(passed===R.length?0:1);
