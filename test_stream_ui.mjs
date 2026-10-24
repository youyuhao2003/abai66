// 最终验证:逐字渲染(用 textContent,200ms 采样)
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9500 + Math.floor(Math.random() * 90);
const profile = process.env.TEMP + '\\cdp_f_' + Math.random().toString(36).slice(2);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--force-device-scale-factor=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const l = await r.json();
    target = l.find(t => t.type === 'page');
    if (target) break;
  } catch {}
  await sleep(250);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const cmd = (m, p = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
  return new Promise(res => pending.set(mid, res));
};
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise(r => ws.addEventListener('open', r));
await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Page.navigate', { url: 'http://127.0.0.1:8788/' });
await sleep(4500);

await cmd('Runtime.evaluate', {
  expression: `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    document.querySelectorAll('.card')[0].click(); await s(2000);
    document.querySelector('.startChatBtn')?.click(); await s(1500);
    return 'ok';})()`,
  awaitPromise: true,
});

const sample = await cmd('Runtime.evaluate', {
  expression: `(async()=>{
    const s=ms=>new Promise(r=>setTimeout(r,ms));
    const ta=document.querySelector('.composerInput');
    ta.value='七个月了。你到底打算住到什么时候？';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    await s(200);
    document.querySelector('.sendBtn').click();

    const snaps=[];
    for(let i=0;i<90;i++){
      await s(200);
      const el=document.querySelector('.storyMsg.streaming');
      let len=0;
      if(el){ len=(el.textContent||'').length; }
      const other=document.querySelectorAll('.storyMsg.assistant').length;
      snaps.push({t:i*200,len,hasStream:!!el,assist:other});
      if(!el && snaps.length>10 && other>0) {
        // 流式结束,再多看两帧
        if(snaps.slice(-3).every(x=>!x.hasStream)) break;
      }
    }
    return JSON.stringify(snaps);
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

const arr = JSON.parse(sample.result.value);
console.log('采样(200ms):');
let prev = 0, growth = 0;
const marks = [];
for (const x of arr) {
  if (x.len > prev) { growth++; marks.push(x); }
  prev = Math.max(prev, x.len);
}
console.log(`总采样帧: ${arr.length}`);
console.log(`有 .streaming 元素的帧: ${arr.filter(x=>x.hasStream).length}`);
console.log(`长度增长的帧数: ${growth}`);
console.log('\n增长采样点(前 15 个):');
marks.slice(0, 15).forEach(m => console.log(`  ${String(m.t).padStart(5)}ms  len=${m.len}`));
console.log('\n最终长度:', prev);

console.log('\n' + (growth >= 5 ? 'PASS: 前端逐字渲染,共 ' + growth + ' 次增长' : 'FAIL: 增长次数不足'));

ws.close();
chrome.kill();
process.exit(0);
