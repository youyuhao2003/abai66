// 后台接口测试
const B = 'http://127.0.0.1:8788';
const TOKEN = 'change-me-please';
const R = [];
const ok = (n, c, x = '') => { R.push({ n, c: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

async function api(name, body = {}) {
  const r = await fetch(`${B}/api/admin/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { status: r.status, body: j };
}

// 1. 鉴权
{
  const r = await fetch(`${B}/api/admin/overview`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('无 token 被拒', r.status === 401);
  const r2 = await fetch(`${B}/api/admin/overview`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong' }, body: '{}' });
  ok('错误 token 被拒', r2.status === 401);
}

// 2. 概览
{
  const r = await api('overview');
  ok('概览', r.status === 200 && r.body.success, `用户${r.body.stats.users} 卡${r.body.stats.cards}`);
  ok('7天趋势', Array.isArray(r.body.daily) && r.body.daily.length === 7);
  ok('Top 角色', Array.isArray(r.body.topCards));
}

// 3. 文字模型
let textModelId;
{
  const r = await api('list-text-models');
  ok('文字模型列表', r.status === 200 && r.body.items.length >= 8, `${r.body.items.length} 个`);
  const m = r.body.items[0];
  ok('字段完整', m.displayName && m.backend && typeof m.creditPer1k === 'number');

  // 新增
  const newId = 99;
  const save = await api('save-text-model', { model: {
    id: newId, name: 'TestModel', displayName: '测试模型', backend: 'deepseek-v4.1-flash',
    creditPer1k: 5, tier: 'mid', maxTokens: 900, temperature: 0.85,
    enabled: true, vipOnly: false, sort: 99, description: '后台测试',
  }});
  ok('新增文字模型', save.status === 200, 'id=' + newId);

  // 改
  const upd = await api('save-text-model', { model: {
    id: newId, name: 'TestModel', displayName: '测试模型改', backend: 'deepseek-v4.1-flash',
    creditPer1k: 8, tier: 'high', maxTokens: 1000, temperature: 0.8,
    enabled: false, vipOnly: true, sort: 99, description: '已修改',
  }});
  ok('修改文字模型', upd.status === 200);
  const list2 = await api('list-text-models');
  const got = list2.body.items.find(x => x.id === newId);
  ok('修改已生效', got.creditPer1k === 8 && got.enabled === false && got.vipOnly === true,
     `计费${got.creditPer1k} 启用${got.enabled} VIP${got.vipOnly}`);

  // 测试调用
  const test = await api('test-text-model', { id: newId, prompt: '说"测试成功"四个字' });
  ok('测试模型调用', test.status === 200 && test.body.ok === true,
     `${test.body.latency}ms: ${String(test.body.reply || '').slice(0, 20)}`);

  // 删除
  const del = await api('delete-text-model', { id: newId });
  ok('删除文字模型', del.status === 200);
  const list3 = await api('list-text-models');
  ok('删除已生效', !list3.body.items.find(x => x.id === newId));
  textModelId = m.id;
}

// 4. 生图模型
{
  const r = await api('list-image-models');
  ok('生图模型列表', r.status === 200 && r.body.items.length >= 3, `${r.body.items.length} 个`);

  const save = await api('save-image-model', { model: {
    id: 'art-test', name: '测试引擎', provider: 'openai',
    endpoint: 'https://api.example.com/v1/images/generations',
    apiKey: 'sk-test-123456', modelName: 'dall-e-3',
    credit: 150, width: 768, height: 1024, aspectRatio: 'PORTRAIT',
    resolution: 'HD', styleId: 30, steps: 30, cfgScale: 7.5,
    enabled: true, sort: 9, description: '测试用',
  }});
  ok('新增生图引擎', save.status === 200);

  const list2 = await api('list-image-models');
  const got = list2.body.items.find(x => x.id === 'art-test');
  ok('生图配置已存', got && got.credit === 150 && got.provider === 'openai',
     `${got.width}x${got.height} ${got.credit}额度`);
  ok('密钥已脱敏', got.apiKey === '••••' + 'sk-test-123456'.slice(-4), got.apiKey);
  ok('密钥存在标记', got.hasKey === true);

  // 不传 key 应保留原值
  await api('save-image-model', { model: { ...got, apiKey: '', name: '测试引擎改' } });
  const list3 = await api('list-image-models');
  const got2 = list3.body.items.find(x => x.id === 'art-test');
  ok('留空不改密钥', got2.hasKey === true && got2.name === '测试引擎改');

  const del = await api('delete-image-model', { id: 'art-test' });
  ok('删除生图引擎', del.status === 200);
}

// 5. 全局配置
{
  const r = await api('list-config');
  ok('配置列表', r.status === 200 && Object.keys(r.body.groups).length >= 5,
     Object.keys(r.body.groups).join('/'));

  const save = await api('save-config', { items: {
    'economy.signupBonus': '3000',
    'chat.maxOutputTokens': '500',
  }});
  ok('保存配置', save.status === 200);

  const r2 = await api('list-config');
  const eco = r2.body.groups.economy.find(x => x.key === 'economy.signupBonus');
  ok('配置已生效', eco.value === '3000', eco.value);

  // 改回
  await api('save-config', { items: { 'economy.signupBonus': '2000', 'chat.maxOutputTokens': '400' } });
}

// 6. 用户管理
{
  const r = await api('list-users', { limit: 10 });
  ok('用户列表', r.status === 200 && Array.isArray(r.body.items), `共 ${r.body.total} 人`);

  if (r.body.items.length) {
    const u = r.body.items[0];
    const detail = await api('get-user', { userId: u.id });
    ok('用户详情', detail.status === 200 && !!detail.body.user,
       `余额${detail.body.user.balance}`);

    const before = detail.body.user.balance;
    const adj = await api('adjust-credits', { userId: u.id, amount: 500, note: '后台测试' });
    ok('调整额度', adj.status === 200 && adj.body.balance === before + 500,
       `${before} -> ${adj.body.balance}`);

    // 改回
    await api('adjust-credits', { userId: u.id, amount: -500, note: '还原' });

    const mem = await api('set-member', { userId: u.id, days: 30 });
    ok('设置会员', mem.status === 200 && mem.body.memberUntil > 0);
    await api('set-member', { userId: u.id, days: 0 });

    const ban = await api('set-user-status', { userId: u.id, status: 'banned', reason: '测试' });
    ok('封禁用户', ban.status === 200);
    const unban = await api('set-user-status', { userId: u.id, status: 'active' });
    ok('解封用户', unban.status === 200);
  }
}

// 7. 角色卡
{
  const r = await api('list-cards', { limit: 10 });
  ok('角色卡列表', r.status === 200 && r.body.items.length > 0, `${r.body.total} 张`);
}

// 8. 订单
{
  const r = await api('list-orders', { limit: 10 });
  ok('订单列表', r.status === 200, `${r.body.total} 笔`);
}

// 9. 日志
{
  const r = await api('list-logs', { limit: 20 });
  ok('操作日志', r.status === 200 && r.body.items.length > 0, `${r.body.items.length} 条`);
  const actions = [...new Set(r.body.items.map(x => x.action))];
  ok('日志记录了各类操作', actions.length >= 3, actions.slice(0, 6).join(','));
}

const passed = R.filter(x => x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);
process.exit(passed === R.length ? 0 : 1);
