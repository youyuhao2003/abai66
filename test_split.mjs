// 单测:splitStatusBlock 边界情况
import { splitStatusBlock, parseStatusBlock } from './lib/chat_engine.mjs';

const R = [];
const ok = (n, c, x='') => { R.push({n,c:!!c}); console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); };

// 1. 标准末尾状态栏
{
  const r = splitStatusBlock(`她抬头看了你一眼。

「坐吧。」

❤️ 好感度: 52%
🧠 情绪: 平静
🏠 场景: 室内`);
  ok('剥离末尾状态栏', !r.speech.includes('好感度') && r.statusBlock?.includes('好感度'),
     JSON.stringify(r.statusBlock?.split('\n').length) + ' 行');
  ok('正文保留', r.speech.includes('坐吧'), r.speech.slice(0,30));
}

// 2. 正文中间有冒号(不应被抽走)
{
  const r = splitStatusBlock(`他看了看表说:时间不早了。

「你该回去了。」

❤️ 好感度: 60%
🧠 情绪: 关切`);
  ok('正文冒号不误判', r.speech.includes('时间不早了') && r.statusBlock.includes('好感度'));
}

// 3. 完全没有状态栏
{
  const r = splitStatusBlock(`「坐吧。」她把椅子推过来。`);
  ok('无状态栏时原样返回', r.statusBlock === null && r.speech.includes('坐吧'));
}

// 4. 只有一行状态(不足 2 行,不算状态栏)
{
  const r = splitStatusBlock(`「坐吧。」

❤️ 好感度: 50%`);
  ok('单行不剥离', r.statusBlock === null);
}

// 5. 状态栏中间夹空行
{
  const r = splitStatusBlock(`「嗯。」

❤️ 好感度: 40%

🧠 情绪: 冷淡
🏠 场景: 门口`);
  ok('夹空行仍能剥离', r.statusBlock?.split('\n').length === 3,
     String(r.statusBlock?.split('\n').length));
  ok('正文干净', r.speech === '「嗯。」', JSON.stringify(r.speech));
}

// 6. markdown 加粗
{
  const r = splitStatusBlock(`「好。」

**❤️ 好感度**: 70%
**🧠 情绪**: 愉快`);
  ok('加粗格式可识别', r.statusBlock?.includes('好感度') && !r.speech.includes('好感度'));
}

// 7. parseStatusBlock
{
  const rows = parseStatusBlock('❤️ 好感度: 70%\n🧠 情绪: 平静\n🏠 场景: 房间床上');
  ok('解析 3 行', rows.length === 3);
  ok('百分比解析', rows[0].percent === 70, String(rows[0].percent));
  ok('emoji 保留', rows[0].emoji === '❤️', rows[0].emoji);
  ok('键名正确', rows[0].key === '好感度', rows[0].key);
  ok('非数值项 percent=null', rows[1].percent === null);
}

// 8. 无 emoji 的键值对不算状态栏
{
  const rows = parseStatusBlock('好感度: 70%');
  ok('无 emoji 不解析', rows.length === 0);
}


// 9. 单星号斜体(模型常用 *❤️ 好感度: 64%*)
{
  const r = splitStatusBlock(`（她没急着说话）

"三年了。"

*❤️ 好感度: 64%*
*🧠 情绪: 嘴角在笑*
*🏠 场景: 走廊灯下*`);
  ok('单星号斜体可剥离', !r.speech.includes('好感度') && r.statusBlock.split('\n').length === 3);
}

// 10. 九项完整状态栏
{
  const block = `❤️ 好感度: 62%
🧠 情绪: 表面平静
🏠 场景: 便利店冷柜前
💋 亲密度: 隔着一层雨
👗 衣物: 男式衬衫湿透
🔒 秘密: 三年前的真正原因
⚡ 当前需求: 想知道你还恨不恨她
📊 关系阶段: 58%
💭 想法: （他看起来没变。）`;
  const rows = parseStatusBlock(block);
  ok('九项全部解析', rows.length === 9, `${rows.length} 项`);
  ok('两个百分比项', rows.filter(r => r.percent !== null).length === 2);
}
const p = R.filter(x=>x.c).length;
console.log(`\n===== ${p}/${R.length} 通过 =====`);
process.exit(p===R.length?0:1);
