// 批量生成角色素材
import fs from 'node:fs';
import path from 'node:path';

// 密钥从环境变量读取：IMAGE_API_KEY / IMAGE_API_BASE
//   set IMAGE_API_KEY=sk-...
//   node tools/generate-assets.mjs
const BASE = process.env.IMAGE_API_BASE || '';
const KEY  = process.env.IMAGE_API_KEY || '';
const OUT  = process.env.ASSET_OUT_DIR || path.join(process.cwd(), 'public', 'assets', 'characters');

if (!BASE) {
  console.error('缺少 IMAGE_API_BASE 环境变量。用法：');
  console.error('  set IMAGE_API_BASE=https://你的生图服务地址');
  process.exit(1);
}

if (!KEY) {
  console.error('缺少 IMAGE_API_KEY 环境变量。用法：');
  console.error('  set IMAGE_API_KEY=sk-xxxx');
  console.error('  node tools/generate-assets.mjs');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const STYLE = `(masterpiece, best quality, ultra detailed:1.2), anime illustration, soft cel shading with painterly light, delicate lineart, gentle pastel and warm tone, cinematic soft lighting, shallow depth of field, film grain`;

const NEG = `lowres, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, deformed, blurry, jpeg artifacts, watermark, signature, text, logo, ugly, disfigured`;

// 角色设定：程听，24 岁，自由插画师，齐肩黑发，浅褐色眼睛
const CHAR = `a 24-year-old Chinese woman, shoulder-length straight black hair with slightly wavy ends, light brown eyes, slim build, fair skin, wearing an oversized washed-white T-shirt`;

const JOBS = [
  {
    name: 'hero',
    size: '1536x1024',
    prompt: `${STYLE}. ${CHAR}, sitting sideways on a beige sofa in a cozy small apartment at night, hugging her knees, head tilted resting on knee, looking at viewer with a soft knowing half-smile. Warm desk lamp glow from the left, drawing tablet and scattered sketches on the coffee table, plants and bookshelves blurred in background, rain on the window. Horizontal wide composition with negative space on the left for title text. ${NEG}`,
  },
  {
    name: 'poster',
    size: '1024x1536',
    prompt: `${STYLE}. ${CHAR}, upper body portrait, sitting on a sofa, one hand tucking a strand of hair behind her ear, eyes looking slightly away with a quiet, restrained expression. Warm lamplight rim on her hair, soft bokeh of a dim apartment, faint blush. Vertical 2:3 poster composition, subject centered with headroom. ${NEG}`,
  },
  {
    name: 'avatar',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, close-up head and shoulders portrait, gentle smile, looking at viewer, warm rim light, soft blurred warm background. Square composition, face centered, high detail on eyes and hair. ${NEG}`,
  },
  {
    name: 'gallery-1',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, sitting cross-legged on a sofa holding a stylus over a drawing tablet, concentrating, screen light on her face, warm room at night. Square composition. ${NEG}`,
  },
  {
    name: 'gallery-2',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, standing on a small apartment balcony at dusk, laundry hanging behind her, holding a cup, looking back over her shoulder, warm sunset light. Square composition. ${NEG}`,
  },
  {
    name: 'gallery-3',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, in a tiny kitchen in the morning, cooking noodles, steam rising, soft daylight through the window, relaxed expression. Square composition. ${NEG}`,
  },
  {
    name: 'gallery-4',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, at the apartment entrance, barefoot, leaning against the door frame, holding keys, half-smiling, warm hallway light. Square composition. ${NEG}`,
  },
  {
    name: 'gallery-5',
    size: '1024x1024',
    prompt: `${STYLE}. ${CHAR}, lying on a bed seen from above, hair spread out, eyes closed, peaceful, soft morning light through curtains. Square composition, intimate calm mood. ${NEG}`,
  },
];

async function gen(job) {
  const body = {
    model: 'gpt-image-2.5',
    prompt: job.prompt,
    n: 1,
    size: job.size,
  };
  const t0 = Date.now();
  const r = await fetch(BASE + '/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  const j = JSON.parse(txt);
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error('no b64_json: ' + txt.slice(0, 200));

  const buf = Buffer.from(b64, 'base64');
  const file = path.join(OUT, job.name + '.png');
  fs.writeFileSync(file, buf);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OK  ${job.name.padEnd(12)} ${job.size.padEnd(10)} ${(buf.length / 1024).toFixed(0)}KB  ${secs}s`);
  return { name: job.name, size: buf.length };
}

const only = process.argv[2];
const list = only ? JOBS.filter(j => j.name === only) : JOBS;

console.log(`开始生成 ${list.length} 张 -> ${OUT}\n`);
const results = [];
for (const job of list) {
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    try {
      results.push(await gen(job));
      ok = true;
    } catch (e) {
      console.log(`FAIL ${job.name} (attempt ${attempt}): ${e.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

console.log(`\n完成 ${results.length}/${list.length}`);
