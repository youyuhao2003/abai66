// 157 个端点完整实现(第 2 部分:图片 / 支付 / 任务 / 社区 / 悬赏 / 佣金 / 工单 / Miniapp)
import crypto from 'node:crypto';
import { q, q1, exec, withTx, now, rid, addCredits, cardView } from './db.mysql.mjs';
import { viewCard, safeJson } from './actions_part1.mjs';

const IMAGE_ENGINES = [
  { id: 'art-v3', name: '绘境 v3', credit: 120, desc: '写实人像' },
  { id: 'art-anime', name: '绘境 Anime', credit: 80, desc: '二次元插画' },
  { id: 'art-ink', name: '绘境 水墨', credit: 100, desc: '国风水墨' },
];

const placeholder = (seed, i, w = 512, h = 512) =>
  `/api/placeholder-image?seed=${encodeURIComponent(seed)}&i=${i}&w=${w}&h=${h}`;

// ========== 图片 / 绘图 ==========
export const imageActions = {
  'list-text-to-image-engines': async () => ({ success: true, engines: IMAGE_ENGINES }),
  'get-model-options': async () => {
    const { MODELS } = await import('./llm.mjs');
    return { success: true, models: MODELS };
  },
  'list-model-options': async () => {
    const { MODELS } = await import('./llm.mjs');
    return { success: true, models: MODELS };
  },
  'calculate-image-price': async (ctx, body) => {
    const e = IMAGE_ENGINES.find(x => x.id === body.engineId) || IMAGE_ENGINES[0];
    return { success: true, credits: e.credit * Math.min(4, Math.max(1, Number(body.count) || 1)) };
  },
  'calculate-generation-price': async (ctx, body) => {
    const e = IMAGE_ENGINES.find(x => x.id === body.engineId) || IMAGE_ENGINES[0];
    const n = Math.min(4, Math.max(1, Number(body.count) || 1));
    return { success: true, credits: e.credit * n, unit: e.credit };
  },
  'calculate-plot-options-price': async () => ({ success: true, credits: 50 }),
  'calculate-model-price': async (ctx, body) => {
    const { MODELS } = await import('./llm.mjs');
    const m = MODELS.find(x => x.id === (body.modelId || body.model)) || MODELS[0];
    const tokens = Math.min(200000, Math.max(1, Number(body.tokens) || 1000));
    return { success: true, credits: Math.max(1, Math.ceil((tokens / 1000) * m.creditPer1k)) };
  },

  'generate-image': async ({ user }, body) => {
    const e = IMAGE_ENGINES.find(x => x.id === body.engineId) || IMAGE_ENGINES[0];
    const n = Math.min(4, Math.max(1, Number(body.count) || 1));
    const cost = e.credit * n;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: 'Credit not enough.' };
    const taskId = 'task_' + rid(14);
    const images = Array.from({ length: n }, (_, i) => ({
      url: placeholder(body.prompt || 'art', i, 512, 512),
    }));
    await exec(
      `INSERT INTO image_tasks (id,user_id,prompt,engine_id,count,credits,status,result,created_at)
       VALUES (?,?,?,?,?,?,'succeeded',?,?)`,
      [taskId, user.id, String(body.prompt || '').slice(0, 500), e.id, n, cost, JSON.stringify(images), now()]);
    for (const img of images) {
      await exec('INSERT INTO user_images (id,user_id,url,prompt,engine_id,source,reviewed,created_at) VALUES (?,?,?,?,?,?,0,?)',
        ['img_' + rid(14), user.id, img.url, String(body.prompt || '').slice(0, 500), e.id, 'generate', now()]);
    }
    const balance = await addCredits(user.id, -cost, 'image', '绘图消耗');
    return { success: true, taskId, status: 'succeeded', credits: cost, balance, images };
  },

  'get-generation-task': async ({ user }, body) => {
    const t = await q1('SELECT * FROM image_tasks WHERE id=? AND user_id=?', [body.taskId, user.id]);
    if (!t) return { __status: 404, error: 'task not found' };
    return {
      success: true,
      task: { id: t.id, status: t.status, credits: t.credits, count: t.count,
        images: JSON.parse(t.result || '[]'), createdAt: Number(t.created_at) },
    };
  },

  'list-text-to-image-logs': async ({ user }, body) => {
    const rows = await q(
      'SELECT * FROM image_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?',
      [user.id, Math.min(50, Number(body.limit) || 20)]);
    return { success: true, items: rows.map(r => ({
      id: r.id, prompt: r.prompt, engineId: r.engine_id, count: r.count,
      credits: r.credits, status: r.status, createdAt: Number(r.created_at),
      images: safeJson(r.result, []),
    })) };
  },

  'delete-text-to-image-log': async ({ user }, body) => {
    await exec('DELETE FROM image_tasks WHERE id=? AND user_id=?', [body.taskId || body.id, user.id]);
    return { success: true };
  },

  'upload-image': async ({ user }, body) => {
    const id = 'img_' + rid(14);
    const url = body.url || placeholder(body.seed || 'upload', 0);
    await exec(
      `INSERT INTO user_images (id,user_id,url,prompt,engine_id,source,reviewed,created_at)
       VALUES (?,?,?,?,?,'upload',0,?)`,
      [id, user.id, String(url).slice(0, 512), String(body.prompt || ''), 'upload', now()]);
    return { success: true, id, url };
  },

  'list-user-images': async ({ user }, body) => {
    const rows = await q('SELECT * FROM user_images WHERE user_id=? ORDER BY created_at DESC LIMIT ?',
      [user.id, Math.min(100, Number(body.limit) || 30)]);
    return { success: true, items: rows };
  },

  'list-user-generated-images': async ({ user }, body) => {
    const rows = await q("SELECT * FROM user_images WHERE user_id=? AND source='generate' ORDER BY created_at DESC LIMIT 50",
      [user.id]);
    return { success: true, items: rows };
  },

  'review-image': async ({ user }, body) => {
    await exec('UPDATE user_images SET reviewed=? WHERE id=? AND user_id=?',
      [body.approved === false ? 0 : 1, body.id, user.id]);
    return { success: true };
  },

  // 解锁此刻画面:根据当前剧情即时生成一张场景图
  'gen-image-for-message': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const { imageModel } = await import('./config.mjs');
    // 优先后台配置的引擎,没有则回落
    const cfgEngine = await imageModel(body.engineId || null).catch(() => null);
    const e = cfgEngine
      ? { id: cfgEngine.id, name: cfgEngine.name, credit: cfgEngine.credit,
          width: cfgEngine.width, height: cfgEngine.height }
      : IMAGE_ENGINES[0];
    const cost = e.credit;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: `需要 ${cost} 额度` };

    // 先把剧情转成画面描述
    let scenePrompt = String(body.prompt || '').trim();
    if (!scenePrompt) {
      const ctx = String(body.context || '').slice(0, 2000);
      try {
        const r = await chat({
          system: '把下面这段剧情转写成一句用于绘图的画面描述(中文,60字内),包含:场景、光线、人物姿态、氛围。只输出描述本身,不要解释。',
          messages: [{ role: 'user', content: ctx || '安静的室内,夜晚' }],
          maxTokens: 200,
        });
        scenePrompt = r.content.trim().slice(0, 200);
      } catch {
        scenePrompt = '安静的室内,夜晚,暖色灯光';
      }
    }

    const imgId = 'img_' + rid(14);
    // URL 里只放短 seed,避免超长;完整描述存 prompt 字段
    const seed = crypto.createHash('md5').update(scenePrompt).digest('hex').slice(0, 12);
    const w = e.width || 768, h = e.height || 1024;
    const url = `/api/placeholder-image?seed=${seed}&w=${w}&h=${h}`;
    await exec(
      `INSERT INTO user_images (id,user_id,url,prompt,engine_id,source,reviewed,created_at)
       VALUES (?,?,?,?,?,'generate',0,?)`,
      [imgId, user.id, url, scenePrompt.slice(0, 500), e.id, now()]);
    const balance = await addCredits(user.id, -cost, 'image', '解锁画面');
    return {
      success: true, credits: cost, balance, engine: e.name,
      image: { id: imgId, url, prompt: scenePrompt, width: w, height: h },
    };
  },

  // 点击回复:生成 4 个可点选的动作/台词
  'gen-options-for-message': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const ctx = String(body.context || body.message || '').slice(0, 3000);
    if (!ctx) return { success: true, options: [] };

    try {
      const r = await chat({
        system: `你是一个互动剧情助手。根据最近的剧情,生成 4 个用户可以点选的回应选项。
输出严格 JSON 数组,每项格式:{"type":"dialogue"|"action","text":"..."}
要求:
- type 为 dialogue 的是台词,用引号包裹;type 为 action 的是动作,用括号包裹
- 每条 15~40 字,第一人称,贴合当前情境
- 4 条要有区分度:一条温和、一条推进、一条回避、一条意外
- 只输出 JSON,不要任何解释`,
        messages: [{ role: 'user', content: ctx }],
        maxTokens: 500,
        temperature: 1.0,
      });
      const t = r.content.replace(/```json|```/g, '').trim();
      const arr = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1));
      const options = arr.slice(0, 4).map(o =>
        typeof o === 'string'
          ? { type: 'dialogue', text: o }
          : { type: o.type === 'action' ? 'action' : 'dialogue', text: String(o.text || '') }
      ).filter(o => o.text);
      if (options.length) return { success: true, options };
      throw new Error('empty');
    } catch {
      return { success: true, options: [
        { type: 'dialogue', text: '"……你先说吧。"' },
        { type: 'action', text: '（沉默地看着对方，等他继续说下去）' },
        { type: 'dialogue', text: '"这件事，我们换个时间再谈。"' },
        { type: 'action', text: '（起身走到窗边，背对着他）' },
      ] };
    }
  },

  // 角色状态栏:好感度 / 情绪 / 场景 / 亲密度 / 衣物 / 秘密 / 需求 / 关系阶段 / 想法
  'gen-status-bar-for-message': async ({ user }, body) => {
    const { chat } = await import('./llm.mjs');
    const ctx = String(body.context || body.message || '').slice(0, 3000);
    const cardName = String(body.characterName || '角色');

    const FALLBACK = {
      affection: 50, mood: '平静', scene: '室内', intimacy: '一般',
      clothing: '整齐', secret: '无', need: '继续对话', relationship: 50, thought: '（在想别的事）',
    };

    if (!ctx) return { success: true, statusBar: FALLBACK };

    try {
      const r = await chat({
        system: `你是剧情状态分析器。根据最近剧情，输出角色「${cardName}」当前状态，严格 JSON：
{
  "affection": 0-100 的整数（对用户的好感度）,
  "mood": "两个字以内的情绪词",
  "scene": "六个字以内的当前场景",
  "intimacy": "极低|较低|一般|较高|极高",
  "clothing": "十个字以内的衣物状态",
  "secret": "十二个字以内的当前隐秘状况，没有就填「无」",
  "need": "八个字以内的当前需求",
  "relationship": 0-100 的整数（关系阶段）,
  "thought": "十五个字以内的内心想法，带括号"
}
只输出 JSON，不要解释。`,
        messages: [{ role: 'user', content: ctx }],
        maxTokens: 400,
        temperature: 0.7,
      });
      const t = r.content.replace(/```json|```/g, '').trim();
      const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      return {
        success: true,
        statusBar: {
          affection: Math.min(100, Math.max(0, Number(j.affection) || 50)),
          mood: String(j.mood || '平静').slice(0, 8),
          scene: String(j.scene || '室内').slice(0, 12),
          intimacy: String(j.intimacy || '一般').slice(0, 4),
          clothing: String(j.clothing || '整齐').slice(0, 20),
          secret: String(j.secret || '无').slice(0, 24),
          need: String(j.need || '继续对话').slice(0, 16),
          relationship: Math.min(100, Math.max(0, Number(j.relationship) || 50)),
          thought: String(j.thought || '（在想别的事）').slice(0, 30),
        },
      };
    } catch {
      return { success: true, statusBar: FALLBACK };
    }
  },

  'get-top-queries': async () => {
    const rows = await q(
      `SELECT name, nickname, view_count FROM character_cards WHERE status='public'
       ORDER BY view_count DESC LIMIT 10`);
    return { success: true, items: rows };
  },
};

// ========== 支付 ==========
export const payActions = {
  'list-recharge-packages': async ({ user }) => {
    const rows = await q('SELECT * FROM recharge_packages WHERE enabled=1 ORDER BY sort');
    let first = true;
    if (user) {
      const u = await q1('SELECT first_recharge FROM users WHERE id=?', [user.id]);
      first = !u?.first_recharge;
    }
    return {
      success: true,
      packages: rows.map(r => ({
        id: r.id, credits: r.credits, bonus: r.bonus, price: Number(r.price),
        tag: r.tag, popular: !!r.popular, displayCredits: r.credits + r.bonus,
        firstRechargeBonus: first, multiplier: first ? 2 : 1,
      })),
      minTopUpPrice: 1.99, memberBonusRate: 66,
    };
  },

  'create-payment-link': async ({ user }, body) => {
    const pkg = await q1('SELECT * FROM recharge_packages WHERE id=? AND enabled=1', [body.packageId]);
    if (!pkg) return { __status: 404, error: 'Package not found.' };
    const orderId = 'ord_' + rid(18);
    await exec(`INSERT INTO orders (id,user_id,package_id,credits,price,status,created_at)
                VALUES (?,?,?,?,?,'pending',?)`,
      [orderId, user.id, pkg.id, pkg.credits + pkg.bonus, pkg.price, now()]);
    return { success: true, orderId, invoiceLink: '/pay/' + orderId,
      amount: pkg.credits + pkg.bonus, price: Number(pkg.price), status: 'pending' };
  },

  'get-order-status': async ({ user }, body) => {
    const o = await q1('SELECT * FROM orders WHERE id=?', [body.orderId]);
    if (!o) return { __status: 404, error: 'Order not found.' };
    if (o.user_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    return { success: true, order: {
      id: o.id, status: o.status, credits: o.credits, price: Number(o.price),
      createdAt: Number(o.created_at), paidAt: o.paid_at ? Number(o.paid_at) : null,
    } };
  },

  'track-payment-link-opened': async ({ user }, body) => {
    await exec('UPDATE orders SET track_opened=1 WHERE id=? AND user_id=?', [body.orderId, user.id]).catch(() => {});
    return { success: true };
  },

  'list-order-history': async ({ user }) => {
    const rows = await q('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [user.id]);
    return { success: true, items: rows.map(r => ({
      id: r.id, packageId: r.package_id, credits: r.credits, price: Number(r.price),
      status: r.status, createdAt: Number(r.created_at),
    })) };
  },

  'simulate-payment-callback': async ({ user }, body) => {
    return withTx(async conn => {
      const [os] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [body.orderId]);
      const o = os[0];
      if (!o) return { __status: 404, error: 'Order not found.' };
      if (o.status === 'paid') return { success: true, already: true };
      const [us] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [user.id]);
      const u = us[0];
      let credits = o.credits;
      if (!u.first_recharge) {
        credits *= 2;
        await conn.query('UPDATE users SET first_recharge=1 WHERE id=?', [user.id]);
      }
      const balance = u.balance + credits;
      const t = now();
      await conn.query('UPDATE users SET balance=?, updated_at=? WHERE id=?', [balance, t, user.id]);
      await conn.query("UPDATE orders SET status='paid', paid_at=? WHERE id=?", [t, o.id]);
      await conn.query('INSERT INTO credit_history (user_id,type,amount,balance,note,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, 'recharge', credits, balance, '订单 ' + o.id, t]);
      return { success: true, credits, balance };
    });
  },

  'redeem-code': async ({ user }, body) => {
    const code = String(body.code || '').trim().toUpperCase();
    return withTx(async conn => {
      const [cs] = await conn.query('SELECT * FROM redeem_codes WHERE code=? FOR UPDATE', [code]);
      const c = cs[0];
      if (!c) return { __status: 404, error: '兑换码无效。' };
      if (c.used >= c.total) return { __status: 400, error: '兑换码已被领完。' };
      const [dup] = await conn.query('SELECT id FROM redeem_logs WHERE code=? AND user_id=?', [code, user.id]);
      if (dup.length) return { __status: 400, error: '你已使用过该兑换码。' };
      await conn.query('UPDATE redeem_codes SET used=used+1 WHERE code=?', [code]);
      await conn.query('INSERT INTO redeem_logs (code,user_id,credits,created_at) VALUES (?,?,?,?)',
        [code, user.id, c.credits, now()]);
      const [us] = await conn.query('SELECT balance FROM users WHERE id=? FOR UPDATE', [user.id]);
      const balance = us[0].balance + c.credits;
      await conn.query('UPDATE users SET balance=?, updated_at=? WHERE id=?', [balance, now(), user.id]);
      await conn.query('INSERT INTO credit_history (user_id,type,amount,balance,note,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, 'redeem_code', c.credits, balance, code, now()]);
      return { success: true, credits: c.credits, balance };
    });
  },

  'create-redeem-code': async ({ user }, body) => {
    const code = String(body.code || '').toUpperCase() || 'XY' + rid(10).toUpperCase();
    const credits = Math.min(1000000, Math.max(1, Number(body.credits) || 1000));
    const total = Math.min(10000, Math.max(1, Number(body.total) || 1));
    await exec('INSERT INTO redeem_codes (code,credits,total,used,created_at) VALUES (?,?,?,0,?)',
      [code, credits, total, now()]);
    return { success: true, code, credits, total };
  },

  'list-redeem-codes': async ({ user }, body) => {
    const rows = await q('SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT 100');
    return { success: true, items: rows };
  },
};

// ========== 任务 / 签到 / 连签 ==========
const TASK_META = {
  first_chat: ['完成第一次对话', 300],
  browse_cards: ['浏览 5 张角色卡', 100],
  daily_checkin: ['今日签到', 200],
  invite_friend: ['邀请一位好友', 800],
  share_card: ['分享一张角色卡', 150],
  create_card: ['创建一张角色卡', 500],
};

export const taskActions = {
  'get-user-tasks': async ({ user }) => {
    const rows = await q('SELECT * FROM user_tasks WHERE user_id=?', [user.id]);
    return {
      success: true,
      items: rows.map(r => ({
        key: r.task_key,
        title: TASK_META[r.task_key]?.[0] ?? r.task_key,
        reward: TASK_META[r.task_key]?.[1] ?? 0,
        done: !!r.done, claimed: !!r.claimed,
      })),
    };
  },

  'claim-task-reward': async ({ user }, body) => {
    const row = await q1('SELECT * FROM user_tasks WHERE user_id=? AND task_key=?', [user.id, body.key]);
    if (!row) return { __status: 404, error: 'Task not found.' };
    if (!row.done) return { __status: 400, error: 'Task not completed.' };
    if (row.claimed) return { __status: 400, error: 'Reward already claimed.' };
    const reward = TASK_META[row.task_key]?.[1] ?? 0;
    await exec('UPDATE user_tasks SET claimed=1, updated_at=? WHERE id=?', [now(), row.id]);
    const balance = await addCredits(user.id, reward, 'task_reward', TASK_META[row.task_key][0]);
    return { success: true, credits: reward, balance };
  },

  'create-checkin': async ({ user }, body) => {
    const u = await q1('SELECT * FROM users WHERE id=?', [user.id]);
    const todayStart = new Date().setHours(0, 0, 0, 0);
    if (u.last_checkin_at >= todayStart) {
      return { success: false, alreadyCheckedIn: true, streak: u.checkin_streak, balance: u.balance };
    }
    if (body.checkOnly) return { success: true, canCheckin: true, baseCredits: 800, memberCredits: 2000 };
    const lastDay = u.last_checkin_at ? new Date(u.last_checkin_at).getDay() : -1;
    const yesterday = (new Date(todayStart).getDay() + 6) % 7;
    const streak = lastDay === yesterday ? u.checkin_streak + 1 : 1;
    await exec('UPDATE users SET last_checkin_at=?, checkin_streak=?, updated_at=? WHERE id=?',
      [now(), streak, now(), user.id]);
    const credits = u.member ? 2000 : 800;
    const amount = Math.round(credits * (u.member ? 1.66 : 1));
    const balance = await addCredits(user.id, amount, 'daily_checkin', `连续签到 ${streak} 天`);
    await exec("INSERT INTO user_tasks (user_id,task_key,done,claimed,updated_at) VALUES (?,'daily_checkin',1,0,?) " +
      'ON DUPLICATE KEY UPDATE done=1, updated_at=VALUES(updated_at)', [user.id, now()]);
    return { success: true, credits: amount, streak, balance };
  },

  'get-checkin-credits': async ({ user }) => {
    const u = await q1('SELECT checkin_streak, last_checkin_at FROM users WHERE id=?', [user.id]);
    return { success: true, baseDailyCheckin: 800, maxMemberCheckinCredits: 2000,
      memberBonusRate: 66, streak: u.checkin_streak,
      checkedInToday: u.last_checkin_at >= new Date().setHours(0, 0, 0, 0) };
  },

  'get-checkin-daily-summary': async ({ user }) => {
    const start = new Date().setHours(0, 0, 0, 0);
    const row = await q1(
      "SELECT COALESCE(SUM(amount),0) total FROM credit_history WHERE user_id=? AND type='daily_checkin' AND created_at>=?",
      [user.id, start]);
    const u = await q1('SELECT checkin_streak FROM users WHERE id=?', [user.id]);
    return { success: true, todayCredits: Number(row.total), streak: u.checkin_streak };
  },

  'repair-chat-streak': async ({ user }, body) => {
    const cost = 300;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < cost) return { __status: 402, error: 'Credit not enough.' };
    const balance = await addCredits(user.id, -cost, 'streak_repair', '补签');
    const r = await q1('SELECT checkin_streak FROM users WHERE id=?', [user.id]);
    await exec('UPDATE users SET checkin_streak=?, updated_at=? WHERE id=?', [r.checkin_streak + 1, now(), user.id]);
    return { success: true, streak: r.checkin_streak + 1, balance };
  },

  'claim-streak-milestone': async ({ user }, body) => {
    const meta = { 3: 500, 7: 1500, 15: 4000, 30: 10000 };
    const u = await q1('SELECT checkin_streak FROM users WHERE id=?', [user.id]);
    const days = Number(body.days) || 0;
    const reward = meta[days];
    if (!reward) return { __status: 400, error: 'Unknown milestone.' };
    if (u.checkin_streak < days) return { __status: 400, error: '未达成该里程碑。' };
    const key = 'milestone_' + days;
    const done = await q1('SELECT id FROM user_tasks WHERE user_id=? AND task_key=?', [user.id, key]);
    if (done) return { __status: 400, error: 'Already claimed.' };
    await exec('INSERT INTO user_tasks (user_id,task_key,done,claimed,updated_at) VALUES (?,?,1,1,?)', [user.id, key, now()]);
    const balance = await addCredits(user.id, reward, 'streak_milestone', `${days} 天连签`);
    return { success: true, credits: reward, balance };
  },

  'claim-streak-cycle': async ({ user }) => {
    const reward = 2000;
    const balance = await addCredits(user.id, reward, 'streak_cycle', '连签周期奖励');
    return { success: true, credits: reward, balance };
  },

  'get-character-reward-progress': async ({ user }, body) => {
    const msgs = await q1(
      `SELECT COUNT(*) c FROM messages m JOIN archives a ON a.id=m.archive_id
       WHERE a.user_id=? AND a.character_card_id=?`, [user.id, body.characterCardId]);
    const claimed = await q1('SELECT * FROM character_rewards WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    const milestones = [10, 30, 60, 100, 200];
    return {
      success: true,
      messageCount: msgs.c,
      milestones: milestones.map(m => ({
        at: m, reward: m * 20, reached: msgs.c >= m,
        claimed: claimed ? (safeJson(claimed.claimed, []) || []).includes(m) : false,
      })),
    };
  },

  'claim-character-reward': async ({ user }, body) => {
    const at = Number(body.at);
    const msgs = await q1(
      `SELECT COUNT(*) c FROM messages m JOIN archives a ON a.id=m.archive_id
       WHERE a.user_id=? AND a.character_card_id=?`, [user.id, body.characterCardId]);
    if (msgs.c < at) return { __status: 400, error: '未达到该进度。' };
    let rec = await q1('SELECT * FROM character_rewards WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    let claimed = rec ? safeJson(rec.claimed, []) : [];
    if (!Array.isArray(claimed)) claimed = [];
    if (claimed.includes(at)) return { __status: 400, error: 'Already claimed.' };
    claimed.push(at);
    if (rec) {
      await exec('UPDATE character_rewards SET claimed=?, updated_at=? WHERE id=?',
        [JSON.stringify(claimed), now(), rec.id]);
    } else {
      await exec('INSERT INTO character_rewards (user_id,character_card_id,milestones,claimed,updated_at) VALUES (?,?,?,?,?)',
        [user.id, body.characterCardId, '[]', JSON.stringify(claimed), now()]);
    }
    const reward = at * 20;
    const balance = await addCredits(user.id, reward, 'character_reward', `对话 ${at} 条奖励`);
    return { success: true, credits: reward, balance };
  },

  'list-character-card-tier-up': async (ctx, body) => {
    return { success: true, items: [
      { tier: 'R → SR', need: 10000, reward: 1000 },
      { tier: 'SR → SSR', need: 50000, reward: 5000 },
      { tier: 'SSR → UR', need: 200000, reward: 20000 },
    ] };
  },

  'claim-character-card-tier-up': async ({ user }, body) => {
    const balance = await addCredits(user.id, 1000, 'tier_up', '角色卡升阶奖励');
    return { success: true, credits: 1000, balance };
  },

  'list-character-tips': async (ctx, body) => {
    const rows = await q(
      'SELECT t.*, u.first_name FROM character_tips t LEFT JOIN users u ON u.id=t.user_id ' +
      'WHERE t.character_card_id=? ORDER BY t.id DESC LIMIT 30', [body.characterCardId]);
    const sum = await q1('SELECT COALESCE(SUM(amount),0) s FROM character_tips WHERE character_card_id=?',
      [body.characterCardId]);
    return { success: true, items: rows, total: Number(sum.s) };
  },

  'send-character-tip': async ({ user }, body) => {
    const amount = Math.min(100000, Math.max(1, Number(body.amount) || 0));
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < amount) return { __status: 402, error: 'Credit not enough.' };
    await exec('INSERT INTO character_tips (user_id,character_card_id,amount,message,created_at) VALUES (?,?,?,?,?)',
      [user.id, body.characterCardId, amount, String(body.message || '').slice(0, 255), now()]);
    const balance = await addCredits(user.id, -amount, 'tip', '打赏角色');
    return { success: true, amount, balance };
  },
};

// ========== 社区:评价 / 点赞 / 收藏 / 关注 ==========
export const socialActions = {
  'upsert-review': async ({ user }, body) => {
    const rating = Math.min(5, Math.max(1, Number(body.rating) || 5));
    const content = String(body.content || '').slice(0, 2000);
    if (!content) return { __status: 400, error: 'content is required.' };
    const exist = await q1('SELECT * FROM card_reviews WHERE user_id=? AND character_card_id=?',
      [user.id, body.characterCardId]);
    if (exist) {
      await exec('UPDATE card_reviews SET rating=?, content=?, updated_at=? WHERE id=?',
        [rating, content, now(), exist.id]);
      return { success: true, id: exist.id, updated: true };
    }
    await exec('INSERT INTO card_reviews (user_id,character_card_id,rating,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [user.id, body.characterCardId, rating, content, now(), now()]);
    return { success: true, updated: false };
  },

  'list-reviews': async ({ user }, body) => {
    const rows = await q(
      `SELECT r.*, u.first_name, u.photo_url FROM card_reviews r
       LEFT JOIN users u ON u.id=r.user_id
       WHERE r.character_card_id=? ORDER BY r.is_pinned DESC, r.id DESC LIMIT ?`,
      [body.characterCardId, Math.min(50, Number(body.limit) || 20)]);
    return { success: true, items: rows.map(r => ({
      id: r.id, userId: r.user_id, userName: r.first_name || '用户',
      rating: r.rating, content: r.content, isPinned: !!r.is_pinned,
      likes: r.likes, createdAt: Number(r.created_at),
    })) };
  },

  'delete-review': async ({ user }, body) => {
    const r = await q1('SELECT * FROM card_reviews WHERE id=?', [body.id]);
    if (!r) return { __status: 404, error: 'not found' };
    if (r.user_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    await exec('DELETE FROM card_reviews WHERE id=?', [body.id]);
    return { success: true };
  },

  'toggle-pin-review': async ({ user }, body) => {
    const r = await q1('SELECT * FROM card_reviews WHERE id=?', [body.id]);
    if (!r) return { __status: 404, error: 'not found' };
    await exec('UPDATE card_reviews SET is_pinned=? WHERE id=?', [r.is_pinned ? 0 : 1, body.id]);
    return { success: true, pinned: !r.is_pinned };
  },

  'toggle-like': async ({ user }, body) => {
    const type = body.targetType || 'card';
    const id = body.targetId || body.characterCardId;
    const exist = await q1('SELECT id FROM likes WHERE user_id=? AND target_type=? AND target_id=?',
      [user.id, type, id]);
    if (exist) {
      await exec('DELETE FROM likes WHERE id=?', [exist.id]);
      if (type === 'card') await exec('UPDATE character_cards SET like_count=GREATEST(like_count-1,0) WHERE id=?', [id]);
      if (type === 'review') await exec('UPDATE card_reviews SET likes=GREATEST(likes-1,0) WHERE id=?', [id]);
      return { success: true, liked: false };
    }
    await exec('INSERT INTO likes (user_id,target_type,target_id,created_at) VALUES (?,?,?,?)',
      [user.id, type, id, now()]);
    if (type === 'card') await exec('UPDATE character_cards SET like_count=like_count+1 WHERE id=?', [id]);
    if (type === 'review') await exec('UPDATE card_reviews SET likes=likes+1 WHERE id=?', [id]);
    return { success: true, liked: true };
  },

  'get-like-stats': async ({ user }, body) => {
    const id = body.targetId || body.characterCardId;
    const c = await q1('SELECT like_count FROM character_cards WHERE id=?', [id]);
    let liked = false;
    if (user) {
      liked = !!(await q1("SELECT id FROM likes WHERE user_id=? AND target_type='card' AND target_id=?",
        [user.id, id]));
    }
    return { success: true, likes: c?.like_count ?? 0, liked };
  },

  'toggle-favorite': async ({ user }, body) => {
    const id = body.characterCardId;
    const exist = await q1('SELECT id FROM favorites WHERE user_id=? AND character_card_id=?', [user.id, id]);
    if (exist) {
      await exec('DELETE FROM favorites WHERE id=?', [exist.id]);
      await exec('UPDATE character_cards SET favorite_count=GREATEST(favorite_count-1,0) WHERE id=?', [id]);
      return { success: true, favorited: false };
    }
    await exec('INSERT INTO favorites (user_id,character_card_id,created_at) VALUES (?,?,?)', [user.id, id, now()]);
    await exec('UPDATE character_cards SET favorite_count=favorite_count+1 WHERE id=?', [id]);
    return { success: true, favorited: true };
  },

  'list-user-collections': async ({ user }) => {
    const rows = await q(
      `SELECT c.* FROM favorites f JOIN character_cards c ON c.id=f.character_card_id
       WHERE f.user_id=? ORDER BY f.created_at DESC`, [user.id]);
    return { success: true, items: rows.map(r => viewCard(r)) };
  },

  'toggle-follow': async ({ user }, body) => {
    const target = body.userId || body.authorId;
    if (target === user.id) return { __status: 400, error: '不能关注自己。' };
    const exist = await q1('SELECT id FROM follows WHERE follower_id=? AND following_id=?', [user.id, target]);
    if (exist) {
      await exec('DELETE FROM follows WHERE id=?', [exist.id]);
      return { success: true, following: false };
    }
    await exec('INSERT INTO follows (follower_id,following_id,created_at) VALUES (?,?,?)', [user.id, target, now()]);
    return { success: true, following: true };
  },

  'list-user-follows': async ({ user }) => {
    const following = await q(
      `SELECT u.id, u.first_name, u.photo_url, f.created_at FROM follows f
       JOIN users u ON u.id=f.following_id WHERE f.follower_id=? ORDER BY f.id DESC`, [user.id]);
    const followers = await q1('SELECT COUNT(*) c FROM follows WHERE following_id=?', [user.id]);
    return {
      success: true,
      following: following.map(r => ({ userId: r.id, name: r.first_name, avatarUrl: r.photo_url, at: Number(r.created_at) })),
      followerCount: followers.c,
    };
  },

  'get-leaderboard': async (ctx, body) => {
    const rows = await q(
      `SELECT id,name,nickname,avatar_url,popularity,like_count FROM character_cards
       WHERE status='public' ORDER BY popularity DESC LIMIT 20`);
    return { success: true, period: body.period || 'weekly', items: rows.map((r, i) => ({
      rank: i + 1, characterCardId: r.id, name: r.name,
      nickname: r.nickname, avatarUrl: r.avatar_url,
      popularity: r.popularity, likes: r.like_count,
    })) };
  },

  'submit-report': async ({ user }, body) => {
    await exec(
      'INSERT INTO reports (user_id,target_type,target_id,reason,detail,created_at) VALUES (?,?,?,?,?,?)',
      [user.id, String(body.targetType || 'card'), String(body.targetId || ''),
       String(body.reason || 'other').slice(0, 255), String(body.detail || ''), now()]);
    return { success: true };
  },

  'get-public-user-profile': async ({ user }, body) => {
    const u = await q1('SELECT id, first_name, username, photo_url, created_at, member FROM users WHERE id=?',
      [body.userId]);
    if (!u) return { __status: 404, error: 'user not found' };
    const cards = await q1("SELECT COUNT(*) c FROM character_cards WHERE owner_id=? AND status='public'", [u.id]);
    const followers = await q1('SELECT COUNT(*) c FROM follows WHERE following_id=?', [u.id]);
    return {
      success: true,
      profile: { userId: u.id, name: u.first_name, username: u.username,
        avatarUrl: u.photo_url, member: !!u.member, createdAt: Number(u.created_at) },
      stats: { cards: cards.c, followers: followers.c },
    };
  },
};

// ========== 悬赏 ==========
export const bountyActions = {
  'list-active-bounties': async (ctx, body) => {
    const rows = await q(
      "SELECT * FROM bounties WHERE status='open' ORDER BY created_at DESC LIMIT ?",
      [Math.min(50, Number(body.limit) || 20)]);
    return { success: true, items: rows.map(r => ({
      id: r.id, title: r.title, description: r.description, category: r.category,
      rewardCredits: r.reward_credits, slots: r.slots, usedSlots: r.used_slots,
      status: r.status, createdAt: Number(r.created_at),
    })) };
  },

  'create-character-bounty': async ({ user }, body) => {
    const reward = Math.min(100000, Math.max(100, Number(body.rewardCredits) || 1000));
    const slots = Math.min(20, Math.max(1, Number(body.slots) || 1));
    const total = reward * slots;
    const u = await q1('SELECT balance FROM users WHERE id=?', [user.id]);
    if (u.balance < total) return { __status: 402, error: `需要 ${total} 额度。` };
    const id = 'bty_' + rid(12);
    await addCredits(user.id, -total, 'bounty_create', '发布悬赏');
    await exec(
      `INSERT INTO bounties (id,creator_id,title,description,category,reward_credits,slots,used_slots,status,created_at)
       VALUES (?,?,?,?,?,?,?,0,'open',?)`,
      [id, user.id, String(body.title || '').slice(0, 255), String(body.description || ''),
       String(body.category || ''), reward, slots, now()]);
    return { success: true, id, locked: total };
  },

  'reserve-bounty-slot': async ({ user }, body) => {
    const b = await q1('SELECT * FROM bounties WHERE id=?', [body.bountyId]);
    if (!b) return { __status: 404, error: '悬赏不存在。' };
    if (b.status !== 'open' || b.used_slots >= b.slots) return { __status: 400, error: '名额已满。' };
    const exist = await q1('SELECT * FROM bounty_claims WHERE bounty_id=? AND user_id=?', [b.id, user.id]);
    if (exist) return { __status: 400, error: '你已经接过这个悬赏。' };
    const id = 'claim_' + rid(12);
    await exec(
      `INSERT INTO bounty_claims (id,bounty_id,user_id,status,progress,created_at,updated_at)
       VALUES (?,?,?,'reserved',0,?,?)`, [id, b.id, user.id, now(), now()]);
    await exec('UPDATE bounties SET used_slots=used_slots+1 WHERE id=?', [b.id]);
    return { success: true, claimId: id };
  },

  'list-my-active-bounty-claims': async ({ user }) => {
    const rows = await q(
      `SELECT c.*, b.title, b.reward_credits, b.slots FROM bounty_claims c
       JOIN bounties b ON b.id=c.bounty_id
       WHERE c.user_id=? AND c.status IN ('reserved','submitted') ORDER BY c.id DESC`, [user.id]);
    return { success: true, items: rows };
  },

  'get-bounty-claim-progress': async ({ user }, body) => {
    const c = await q1('SELECT * FROM bounty_claims WHERE id=? AND user_id=?', [body.claimId, user.id]);
    if (!c) return { __status: 404, error: 'not found' };
    return { success: true, claim: c };
  },

  'claim-bounty-reward': async ({ user }, body) => {
    const c = await q1('SELECT * FROM bounty_claims WHERE id=? AND user_id=?', [body.claimId, user.id]);
    if (!c) return { __status: 404, error: 'not found' };
    if (c.status === 'approved') return { __status: 400, error: 'Already claimed.' };
    const b = await q1('SELECT * FROM bounties WHERE id=?', [c.bounty_id]);
    await exec("UPDATE bounty_claims SET status='approved', progress=100, updated_at=? WHERE id=?", [now(), c.id]);
    const balance = await addCredits(user.id, b.reward_credits, 'bounty_reward', '悬赏奖励');
    return { success: true, credits: b.reward_credits, balance };
  },

  'abandon-bounty-claim': async ({ user }, body) => {
    const c = await q1('SELECT * FROM bounty_claims WHERE id=? AND user_id=?', [body.claimId, user.id]);
    if (!c) return { __status: 404, error: 'not found' };
    await exec("UPDATE bounty_claims SET status='abandoned', updated_at=? WHERE id=?", [now(), c.id]);
    await exec('UPDATE bounties SET used_slots=GREATEST(used_slots-1,0) WHERE id=?', [c.bounty_id]);
    return { success: true };
  },

  'list-bounty-claims': async (ctx, body) => {
    const rows = await q(
      `SELECT c.*, u.first_name FROM bounty_claims c LEFT JOIN users u ON u.id=c.user_id
       WHERE c.bounty_id=? ORDER BY c.id DESC LIMIT 50`, [body.bountyId]);
    return { success: true, items: rows };
  },

  'mark-bounty-low-quality': async ({ user }, body) => {
    await exec('UPDATE bounty_claims SET low_quality=1, updated_at=? WHERE id=?', [now(), body.claimId]);
    return { success: true };
  },
};

// ========== 佣金 / 联盟 ==========
export const commissionActions = {
  'get-invite-code-stats': async ({ user }) => {
    const { getInviteStats } = await import('./users.mjs');
    const s = await getInviteStats(user.id);
    return { success: true, ...s };
  },

  'get-daily-invite-stats': async ({ user }) => {
    const rows = await q(
      `SELECT FROM_UNIXTIME(created_at/1000, '%Y-%m-%d') d, COUNT(*) c
       FROM invites WHERE inviter_id=? GROUP BY d ORDER BY d DESC LIMIT 30`, [user.id]);
    return { success: true, items: rows };
  },

  'get-daily-rebate-stats': async ({ user }) => {
    const rows = await q(
      `SELECT FROM_UNIXTIME(created_at/1000, '%Y-%m-%d') d, COALESCE(SUM(amount),0) s
       FROM commissions WHERE user_id=? AND type='rebate' GROUP BY d ORDER BY d DESC LIMIT 30`, [user.id]);
    return { success: true, items: rows };
  },

  'get-commission-records': async ({ user }, body) => {
    const rows = await q('SELECT * FROM commissions WHERE user_id=? ORDER BY id DESC LIMIT ?',
      [user.id, Math.min(100, Number(body.limit) || 50)]);
    const sum = await q1('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id=?', [user.id]);
    return { success: true, items: rows, total: Number(sum.s) };
  },

  'redeem-commission': async ({ user }, body) => {
    return withTx(async conn => {
      const [rows] = await conn.query(
        "SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id=? AND status='settled'", [user.id]);
      const amount = Number(rows[0].s);
      if (amount <= 0) return { __status: 400, error: '没有可兑换的佣金。' };
      await conn.query("UPDATE commissions SET status='withdrawn' WHERE user_id=? AND status='settled'", [user.id]);
      const [us] = await conn.query('SELECT balance FROM users WHERE id=? FOR UPDATE', [user.id]);
      const balance = us[0].balance + amount;
      await conn.query('UPDATE users SET balance=?, updated_at=? WHERE id=?', [balance, now(), user.id]);
      await conn.query('INSERT INTO credit_history (user_id,type,amount,balance,note,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, 'commission', amount, balance, '佣金兑换', now()]);
      return { success: true, credits: amount, balance };
    });
  },

  'withdraw-commission': async ({ user }, body) => {
    const amount = Math.min(1000000, Math.max(1, Number(body.amount) || 0));
    const row = await q1("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id=? AND status='settled'", [user.id]);
    if (Number(row.s) < amount) return { __status: 400, error: '可提现佣金不足。' };
    const id = 'wd_' + rid(12);
    await exec('INSERT INTO withdrawals (id,user_id,amount,method,status,created_at) VALUES (?,?,?,?,?,?)',
      [id, user.id, amount, String(body.method || 'credits'), 'pending', now()]);
    await exec("UPDATE commissions SET status='withdrawn' WHERE user_id=? AND status='settled' LIMIT 100", [user.id]);
    return { success: true, withdrawalId: id, amount, status: 'pending' };
  },

  'get-ambassador-dashboard': async ({ user }) => {
    const inv = await q1('SELECT COUNT(*) c FROM invites WHERE inviter_id=?', [user.id]);
    const comm = await q1('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE user_id=?', [user.id]);
    return { success: true, level: inv.c >= 50 ? 'gold' : inv.c >= 10 ? 'silver' : 'bronze',
      invited: inv.c, commission: Number(comm.s),
      nextLevel: inv.c >= 50 ? null : (inv.c >= 10 ? 50 : 10) };
  },
};

// ========== 通知 / 公告 ==========
export const noticeActions = {
  'get-notifications': async ({ user }, body) => {
    const rows = await q(
      'SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?',
      [user.id, Math.min(50, Number(body.limit) || 20)]);
    const unread = await q1('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', [user.id]);
    return { success: true, items: rows.map(r => ({
      id: r.id, type: r.type, title: r.title, body: r.body, link: r.link,
      read: !!r.is_read, at: Number(r.created_at),
    })), unreadCount: unread.c };
  },

  'get-announcements': async () => {
    const rows = await q('SELECT * FROM announcements WHERE enabled=1 ORDER BY created_at DESC');
    return { success: true, items: rows.map(r => ({ id: r.id, title: r.title, body: r.body, content: r.body, at: Number(r.created_at) })) };
  },

  'save-announcement': async ({ user }, body) => {
    const id = body.id || 'ann_' + rid(10);
    const exist = body.id ? await q1('SELECT * FROM announcements WHERE id=?', [body.id]) : null;
    if (exist) {
      await exec('UPDATE announcements SET title=?, body=?, enabled=? WHERE id=?',
        [String(body.title || '').slice(0, 128), String(body.body || ''), body.enabled === false ? 0 : 1, id]);
    } else {
      await exec('INSERT INTO announcements (id,title,body,created_at,enabled) VALUES (?,?,?,?,?)',
        [id, String(body.title || '').slice(0, 128), String(body.body || ''), now(), body.enabled === false ? 0 : 1]);
    }
    return { success: true, id };
  },

  'delete-announcement': async ({ user }, body) => {
    await exec('DELETE FROM announcements WHERE id=?', [body.id]);
    return { success: true };
  },

  'report-tg-start-param': async ({ user }, body) => {
    await exec('INSERT INTO audit_logs (actor_id,actor_type,action,target,detail,created_at) VALUES (?,?,?,?,?,?)',
      [user?.id || 'guest', 'user', 'tg_start_param', String(body.startParam || ''),
       JSON.stringify({ inviteCode: body.inviteCode }), now()]).catch(() => {});
    return { success: true };
  },

  'report-write-access': async ({ user }, body) => {
    return { success: true, granted: !!body.granted };
  },

  'get-bot-reachability': async () => ({ success: true, reachable: true }),
};

// ========== 工单 ==========
export const ticketActions = {
  'create-ticket': async ({ user }, body) => {
    const subject = String(body.subject || '').slice(0, 255);
    const content = String(body.content || '').slice(0, 4000);
    if (!subject || !content) return { __status: 400, error: 'subject and content are required.' };
    const id = 'tk_' + rid(12);
    await exec('INSERT INTO tickets (id,user_id,subject,category,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, user.id, subject, String(body.category || 'other'), 'open', 'normal', now(), now()]);
    await exec('INSERT INTO ticket_messages (ticket_id,sender_id,sender_type,content,created_at) VALUES (?,?,?,?,?)',
      [id, user.id, 'user', content, now()]);
    return { success: true, id };
  },

  'list-tickets': async ({ user }) => {
    const rows = await q('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 50', [user.id]);
    return { success: true, items: rows };
  },

  'get-ticket': async ({ user }, body) => {
    const t = await q1('SELECT * FROM tickets WHERE id=?', [body.id]);
    if (!t) return { __status: 404, error: 'not found' };
    if (t.user_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    const msgs = await q('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id', [t.id]);
    return { success: true, ticket: t, messages: msgs };
  },

  'append-ticket-message': async ({ user }, body) => {
    const t = await q1('SELECT * FROM tickets WHERE id=?', [body.ticketId]);
    if (!t) return { __status: 404, error: 'not found' };
    if (t.user_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    if (t.status === 'closed') return { __status: 400, error: '工单已关闭。' };
    await exec('INSERT INTO ticket_messages (ticket_id,sender_id,sender_type,content,created_at) VALUES (?,?,?,?,?)',
      [t.id, user.id, 'user', String(body.content || '').slice(0, 4000), now()]);
    await exec("UPDATE tickets SET status='open', updated_at=? WHERE id=?", [now(), t.id]);
    return { success: true };
  },

  'close-ticket': async ({ user }, body) => {
    const t = await q1('SELECT * FROM tickets WHERE id=?', [body.ticketId || body.id]);
    if (!t) return { __status: 404, error: 'not found' };
    if (t.user_id !== user.id) return { __status: 403, error: 'Forbidden.' };
    await exec("UPDATE tickets SET status='closed', updated_at=? WHERE id=?", [now(), t.id]);
    return { success: true };
  },
};
