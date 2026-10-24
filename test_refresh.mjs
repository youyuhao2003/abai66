// 真实场景:浏览器聊天 → 刷新 → 数据是否还在
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9100 + Math.floor(Math.random() * 90);
const profile = process.env.TEMP + '\\cdp_persist_' + Math.random().toString(36).slice(2);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--force-device-scale-factor=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const l = await r.json();
    target = l.find(t => t.type === 'page');
    if (target) break;
  } catch {}
  await sleep(200);
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

const R = [];
const ok = (n, c, x = '') => { R.push({ n, c: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

// ---- 第一次访问,聊天 ----
await cmd('Page.navigate', { url: 'http://127.0.0.1:8788/' });
await sleep(4500);

const step1 = await cmd('Runtime.evaluate', {
  expression: `(async()=>{
    const s=ms=>new Promise(r=>setTimeout(r,ms));
    document.querySelectorAll('.card')[0].click(); await s(1800);
    document.querySelector('.startChatBtn')?.click(); await s(1500);
    const ta=document.querySelector('.composerInput');
    ta.value='刷新测试第一句';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    await s(200);
    document.querySelector('.sendBtn').click();
    await s(15000);
    return JSON.stringify({
      msgs: document.querySelectorAll('.storyMsg').length,
      hasStatus: !!document.querySelector('.statusPanel')
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log('第一次:', step1.result?.value);
const s1 = JSON.parse(step1.result?.value || '{}');
ok('聊天产生了消息', s1.msgs >= 2, `${s1.msgs} 条 DOM 消息`);

// ---- 刷新页面 ----
await cmd('Page.navigate', { url: 'http://127.0.0.1:8788/' });
await sleep(4500);

const step2 = await cmd('Runtime.evaluate', {
  expression: `(async()=>{
    const s=ms=>new Promise(r=>setTimeout(r,ms));
    // 刷新后应停在首页,先看会话列表
    const nav=[...document.querySelectorAll('*')]
      .filter(x=>x.children.length===0 && /最近对话/.test(x.innerText))[0]?.closest('div');
    if(nav){ nav.click(); await s(2000); }
    const items=document.querySelectorAll('.convItem');
    const listText=document.body.innerText.includes('条消息');
    // 点进第一个会话
    if(items.length){ items[0].click(); await s(2500); }
    return JSON.stringify({
      archItems: items.length,
      domMsgs: document.querySelectorAll('.storyMsg').length,
      bodyHasText: listText,
      snippets: [...document.querySelectorAll('.storyMsg')].slice(0,2).map(e=>e.innerText.slice(0,30))
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log('刷新后:', step2.result?.value);
const s2 = JSON.parse(step2.result?.value || '{}');
ok('刷新后会话列表非空', s2.archItems >= 1, `${s2.archItems} 个会话`);
ok('刷新后消息还在', s2.domMsgs >= 2, `${s2.domMsgs} 条`);

// ---- 再刷新一次,看是否稳定 ----
await cmd('Page.navigate', { url: 'http://127.0.0.1:8788/' });
await sleep(4000);
const step3 = await cmd('Runtime.evaluate', {
  expression: `(async()=>{
    const s=ms=>new Promise(r=>setTimeout(r,ms));
    const nav=[...document.querySelectorAll('*')]
      .filter(x=>x.children.length===0 && /最近对话/.test(x.innerText))[0]?.closest('div');
    if(nav){ nav.click(); await s(2000); }
    const items=document.querySelectorAll('.convItem');
    if(items.length){ items[0].click(); await s(2500); }
    return JSON.stringify({
      archItems: items.length,
      domMsgs: document.querySelectorAll('.storyMsg').length
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log('再刷新:', step3.result?.value);
const s3 = JSON.parse(step3.result?.value || '{}');
ok('二次刷新仍稳定', s3.domMsgs >= 2, `${s3.archItems} 会话 / ${s3.domMsgs} 消息`);

const passed = R.filter(x => x.c).length;
console.log(`\n===== ${passed}/${R.length} 通过 =====`);

ws.close();
chrome.kill();
process.exit(0);
