// 对比测试:新写作规则的效果
import { encryptPayload, decryptPayload } from './lib/crypto.mjs';

const B = 'http://127.0.0.1:8788';
const u = { id: 660001, first_name: '文风测试', username: 'style' };
const initData = `user=${encodeURIComponent(JSON.stringify(u))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
const ar = await fetch(B + '/api/auth-webapp', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 's', fingerprint: 'fp', device: { platform: 'node' }, initData }) });
const apiKey = (await ar.json()).apiKey;

async function api(name, body = {}) {
  const r = await fetch(`${B}/api/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ _enc: encryptPayload(body) }) });
  const t = await r.text();
  const j = JSON.parse(t);
  return { status: r.status, body: j._enc ? decryptPayload(j._enc) : j };
}

await api('update-chat-settings', { settings: {
  statusBarAuto: true, plotAuto: false, knowledgeEnabled: false, contentFormat: 'roleplay', modelId: 2,
}});

const cards = await api('list-public-character-cards', { sortBy: 'trending' });
const cardId = cards.body.items[0].id;

// 输入一个具体的身体接触动作,看模型怎么接
const probes = [
  '（坐到她旁边，伸手把她垂在脸侧的一缕头发别到耳后，指节蹭过她的耳廓）',
  '（伸手按住她握着笔的手，把笔从她手里抽出来，放到桌上）',
];

for (const msg of probes) {
  await api('clear-archives').catch(() => {});
  console.log('\n' + '='.repeat(60));
  console.log('输入:', msg);
  console.log('='.repeat(60));

  const r = await api('create-chat-completion', { characterCardId: cardId, message: msg });
  const reply = String(r.body.reply || '');
  console.log(reply);

  console.log('\n--- 指标 ---');
  console.log('字数:', reply.length);
  console.log('段落数:', reply.split('\n').filter(x => x.trim()).length);
  const senses = (reply.match(/凉|烫|热|湿|抖|颤|呼吸|温度|力道|触|贴|掐|攥|指尖|耳根|喉结|睫毛|膝盖/g) || []).length;
  console.log('感官/身体词:', senses);
  const dashes = (reply.match(/——/g) || []).length;
  const ellipsis = (reply.match(/……/g) || []).length;
  console.log('破折号:', dashes, '/ 省略号:', ellipsis);
  const userAction = (reply.match(/被你|你掌|你手|你指/g) || []).length;
  console.log('写"你"的动作效果:', userAction, '处');
  console.log('状态栏:', (r.body.statusBar || []).length, '项');
}
