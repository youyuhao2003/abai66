// 安全清理:只删指定测试前缀的用户数据,绝不碰真实用户
// 用法: node clean_test_data.mjs            → 干跑,只报告会删什么
//       node clean_test_data.mjs --yes      → 真的删
import mysql from 'mysql2/promise';

const DRY = !process.argv.includes('--yes');

// 只清这些前缀的测试用户(u66/u55/u77/u88/u22 = 自动化测试专用号段)
const TEST_PREFIXES = ['u66', 'u55', 'u77', 'u88', 'u22', 'u11'];
// 保护:演示账号不删
const PROTECTED = ['u990001'];

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: 'root', password: '',
  database: process.env.DB_NAME || 'wujie_tavern', charset: 'utf8mb4',
});

console.log(DRY ? '=== 干跑模式(不删任何数据) ===' : '=== 实际执行 ===');

// 1. 找出测试用户
const likes = TEST_PREFIXES.map(p => `'${p}%'`).join(',');
const [testUsers] = await conn.query(
  `SELECT id, first_name FROM users WHERE id LIKE ${TEST_PREFIXES.map(() => '?').join(' OR id LIKE ')}`,
  TEST_PREFIXES.map(p => p + '%'));

console.log(`\n测试用户 ${testUsers.length} 个:`);
for (const u of testUsers) console.log(`  ${u.id}  ${u.first_name}`);

if (!testUsers.length) {
  console.log('\n没有测试用户,无需清理。');
  await conn.end();
  process.exit(0);
}

const ids = testUsers.map(u => u.id).filter(id => !PROTECTED.includes(id));
if (!ids.length) {
  console.log('\n全部被保护,跳过。');
  await conn.end();
  process.exit(0);
}
const ph = ids.map(() => '?').join(',');

// 2. 统计会受影响的会话和消息
const [arcs] = await conn.query(`SELECT COUNT(*) c FROM archives WHERE user_id IN (${ph})`, ids);
const [msgs] = await conn.query(
  `SELECT COUNT(*) c FROM messages WHERE archive_id IN (SELECT id FROM archives WHERE user_id IN (${ph}))`, ids);

// 3. 其他用户的会话/消息(绝对不动)
const [otherArcs] = await conn.query(`SELECT COUNT(*) c FROM archives WHERE user_id NOT IN (${ph})`, ids);
const [otherMsgs] = await conn.query(
  `SELECT COUNT(*) c FROM messages WHERE archive_id NOT IN (SELECT id FROM archives WHERE user_id IN (${ph}))`, ids);

console.log(`\n将删除:`);
console.log(`  测试会话 ${arcs[0].c} 个`);
console.log(`  测试消息 ${msgs[0].c} 条`);
console.log(`\n保留(不动):`);
console.log(`  其他用户会话 ${otherArcs[0].c} 个`);
console.log(`  其他用户消息 ${otherMsgs[0].c} 条`);

if (DRY) {
  console.log('\n这是干跑。要真的删,加 --yes');
  await conn.end();
  process.exit(0);
}

// 4. 执行(先消息,后会话,再用户关联)
await conn.query(
  `DELETE FROM messages WHERE archive_id IN (SELECT id FROM archives WHERE user_id IN (${ph}))`, ids);
await conn.query(`DELETE FROM archives WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM knowledge_memories WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM message_directives WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM favorites WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM likes WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM bookmarks WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM personas WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM user_settings WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM user_tasks WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM api_keys WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM sessions WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM credit_history WHERE user_id IN (${ph})`, ids);
await conn.query(`DELETE FROM users WHERE id IN (${ph})`, ids);

console.log('\n已清理。');
await conn.end();
