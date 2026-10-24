// 选项清洗单测
const { normalizeOption } = await import('./lib/chat_engine.mjs');

const cases = [
  // [type, 输入, 期望]
  ['dialogue', '“「留下。拖鞋别收了。」”', '“留下。拖鞋别收了。”'],
  ['dialogue', '"（蹲下来，声音放轻）我不吵"', '“我不吵”'],
  ['dialogue', '“脱了干嘛，你热啊？”', '“脱了干嘛，你热啊？”'],
  ['dialogue', '脱了干嘛，你热啊？', '“脱了干嘛，你热啊？”'],
  ['action', '（把手机推到她面前）', '（把手机推到她面前）'],
  ['action', '把手机推到她面前', '（把手机推到她面前）'],
  ['action', '（蹲下来）"我不吵"', '（蹲下来）'],
  ['dialogue', '「你先说」', '“你先说”'],
  ['action', '（我弯腰去捡她落在沙发缝里的头发，装作没听见）', '（我弯腰去捡她落在沙发缝里的头发，装作没听见）'],
];

let pass = 0;
for (const [type, input, expect] of cases) {
  const got = normalizeOption(type, input);
  const ok = got === expect;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${type}]`);
  console.log(`  输入: ${input}`);
  console.log(`  期望: ${expect}`);
  console.log(`  实际: ${got}`);
}

console.log(`\n===== ${pass}/${cases.length} 通过 =====`);
process.exit(pass === cases.length ? 0 : 1);
