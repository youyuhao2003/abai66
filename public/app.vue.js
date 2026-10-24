// 无界创镜 AI —— Vue 3 前端(对接完整对话引擎)
const { createApp, ref, reactive, computed, onMounted, nextTick, watch } = Vue;

// ==================== 加密层 ====================
const IKM_HEX  = 'c7a1f3e8b2d4096517a8c3e5f2b406981d3a7e9c0b5f284716d9e3a1c8b50f72';
const SALT_HEX = '7f3c9e1da4b8e2f631d7c05af9826b4e';
const VER = 1;
const hex2bytes = h => {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) a[i / 2] = parseInt(h.substr(i, 2), 16);
  return a;
};
let CRYPTO_KEY = null;
async function getKey() {
  if (CRYPTO_KEY) return CRYPTO_KEY;
  const raw = await crypto.subtle.importKey('raw', hex2bytes(IKM_HEX), 'HKDF', false, ['deriveKey']);
  CRYPTO_KEY = await crypto.subtle.deriveKey(
    { name:'HKDF', hash:'SHA-256', salt: hex2bytes(SALT_HEX), info: new TextEncoder().encode('v1') },
    raw, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  return CRYPTO_KEY;
}
async function encryptPayload(obj) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const out = new Uint8Array(1 + 12 + ct.byteLength);
  out[0] = VER; out.set(iv, 1); out.set(new Uint8Array(ct), 13);
  let s = ''; for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
  return btoa(s);
}
async function decryptPayload(b64) {
  const key = await getKey();
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: buf.slice(1,13) }, key, buf.slice(13));
  return JSON.parse(new TextDecoder().decode(pt));
}

const store = {
  apiKey: localStorage.getItem('xy_api_key') || null,
  userId: localStorage.getItem('xy_user_id') || null,
};
async function call(action, body = {}) {
  const headers = { 'Content-Type':'application/json' };
  if (store.apiKey) headers.Authorization = 'Bearer ' + store.apiKey;
  const res = await fetch('/api/' + action, {
    method:'POST', headers, body: JSON.stringify({ _enc: await encryptPayload(body) }),
  });
  const text = await res.text();
  let data;
  try {
    const j = JSON.parse(text);
    data = j && j._enc ? await decryptPayload(j._enc) : j;
  } catch { data = { error:'bad response' }; }
  if (!res.ok) {
    if (res.status === 401 && store.apiKey) { store.apiKey = null; localStorage.removeItem('xy_api_key'); }
    throw new Error(data?.message || data?.error || ('HTTP ' + res.status));
  }
  return data;
}
async function login() {
  let initData;
  if (window.Telegram?.WebApp?.initData) initData = window.Telegram.WebApp.initData;
  else {
    const u = { id: 990001, first_name:'旅行者', username:'traveler', language_code:'zh-hans' };
    initData = `user=${encodeURIComponent(JSON.stringify(u))}&auth_date=${Math.floor(Date.now()/1000)}&hash=demo`;
  }
  const res = await fetch('/api/auth-webapp', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      clientId: 'web-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
      fingerprint:'demo-fp', device:{ ua:navigator.userAgent, platform:navigator.platform }, initData,
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.apiKey) throw new Error(j.message || '登录失败');
  store.apiKey = j.apiKey; store.userId = j.userId;
  localStorage.setItem('xy_api_key', j.apiKey);
  localStorage.setItem('xy_user_id', j.userId);
}

// ==================== App ====================
createApp({
  setup() {
    const tab = ref('home');
    const feed = ref('official');
    const feedList = [
      { key: 'official', label: '精选' },
      { key: 'discover', label: '热门' },
      { key: 'rank', label: '高赞' },
      { key: 'latest', label: '最新' },
    ];
    const keyword = ref('');
    const searchOpen = ref(false);

    const balance = ref(0);
    const profile = reactive({});
    const isMember = ref(false);
    const membership = reactive({});
    const unread = ref(0);

    const cards = ref([]);
    const cursor = ref(null);
    const loading = ref(false);

    const checkedIn = ref(false);
    const streak = ref(0);
    const tasks = ref([]);

    const archives = ref([]);
    const currentCard = ref(null);
    const messages = ref([]);
    const draft = ref('');
    const sending = ref(false);
    const composerMode = ref('dialogue');
    const liked = ref(false);
    const favorited = ref(false);

    const settings = reactive({
      modelId: 2, maxContextTokens: 10000, maxOutputTokens: 400, maxCharacterTokens: 3000,
      outputLanguageCode: 'zh-CN', contentFormat: 'roleplay', knowledgeEnabled: false,
      statusBarAuto: true, statusBarMaxTokens: 300, plotAuto: false, plotOptionsCount: 4,
    });
    const limits = reactive({
      maxContextTokens: { min:7000, max:68000, step:1000 },
      maxOutputTokens: { min:300, max:3200, step:100 },
      maxCharacterTokens: { min:2000, max:15000, step:1000 },
      statusBarMaxTokens: { min:200, max:2000, step:100 },
    });
    const models = ref([]);
    const modelLabel = computed(() => (models.value.find(m => m.id === settings.modelId) || {}).name || 'Flash');
    const formatLabel = computed(() => ({
      roleplay:'角色扮演', novel:'沉浸小说', script:'互动影院',
    })[settings.contentFormat] || '角色扮演');

    const personas = ref([]);
    const personaForm = reactive({ open:false, id:null, name:'', description:'' });
    const knowledge = ref([]);

    const engines = ref([]);
    const drawEngine = ref('art-v3');
    const drawCount = ref(1);
    const drawPrompt = ref('');
    const drawImages = ref([]);
    const drawing = ref(false);
    const drawCost = computed(() => {
      const e = engines.value.find(x => x.id === drawEngine.value);
      return (e ? e.credit : 120) * drawCount.value;
    });

    const bounties = ref([]);
    const leaderboard = ref([]);
    const myCards = ref([]);
    const draftCard = ref(null);
    const draftTags = ref('');
    const genIdea = ref('');
    const generating = ref(false);

    const plans = [
      { id:'monthly', name:'月卡', days:30, price:9.9 },
      { id:'quarterly', name:'季卡', days:90, price:25.9 },
      { id:'yearly', name:'年卡', days:365, price:88 },
    ];

    const inviteCode = ref('');
    const inviteStats = ref({});
    const ambassador = ref({});
    const packages = ref([]);
    const notifications = ref([]);
    const redeemInput = ref('');

    const sheet = reactive({ open:false, title:'', type:'recharge' });
    const toastMsg = ref('');
    const storyEl = ref(null);
    const draftEl = ref(null);

    // 指令系统
    const directorOpen = ref(false);
    const directiveType = ref('Continue');
    const directiveText = ref('');
    const directiveTypes = ref([]);

    // 角色卡详情页
    const detail = reactive({
      open: false,
      loading: false,
      card: null,
      stats: {},
      times: {},
      gallery: [],
      galleryUnlocked: false,
      author: {},
      comments: [],
      bounties: [],
      bountyPool: 0,
      bountyCount: 0,
      interactions: { liked:false, favorited:false, bookmarked:false, followed:false },
      archive: null,
      notesExpanded: false,
    });

    const directiveLabel = key => (directiveTypes.value.find(d => d.key === key) || {}).label || key;
    const lastAssistantIndex = computed(() => {
      for (let i = messages.value.length - 1; i >= 0; i--) {
        if (messages.value[i].role === 'assistant') return i;
      }
      return -1;
    });

    let toastTimer = null;
    const toast = m => { toastMsg.value = m; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastMsg.value='', 2200); };
    const fmt = n => Number(n||0).toLocaleString('zh-CN');
    const fmtDate = t => t ? new Date(Number(t)).toLocaleDateString('zh-CN') : '-';
    const relTime = t => {
      const d = Date.now() - Number(t);
      if (d < 60000) return '刚刚';
      if (d < 3600000) return Math.floor(d/60000) + '分钟前';
      if (d < 86400000) return Math.floor(d/3600000) + '小时前';
      return Math.floor(d/86400000) + '天前';
    };
    const isNew = c => Date.now() - Number(c.createdAt) < 86400000 * 7;

    const meEntries = [
      { tab:'workshop', label:'我的角色' },
      { tab:'membership', label:'会员中心' },
      { tab:'tasks', label:'任务中心' },
      { tab:'ambassador', label:'大使中心' },
      { tab:'bounty', label:'悬赏广场' },
      { tab:'settings', label:'设置' },
    ];

    // ---------- 列表 ----------
    async function loadCards(reset = true) {
      if (loading.value) return;
      loading.value = true;
      try {
        if (reset) { cards.value = []; cursor.value = null; }
        const sortMap = { official:'trending', discover:'hot', rank:'likes', latest:'latest' };
        const r = await call('list-public-character-cards', {
          sortBy: sortMap[feed.value] || 'trending', cursor: cursor.value, pageSize: 24,
        });
        cards.value = cards.value.concat(r.items || []);
        cursor.value = r.nextCursor;
      } catch (e) { toast(e.message); }
      loading.value = false;
    }
    const loadMore = () => loadCards(false);
    const setFeed = f => { feed.value = f; loadCards(true); };

    let searchTimer = null;
    function onSearch() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const kw = keyword.value.trim();
        if (!kw) return loadCards(true);
        try {
          const r = await call('search-character-cards', { keyword: kw });
          cards.value = r.items || []; cursor.value = null;
        } catch (e) { toast(e.message); }
      }, 300);
    }

    async function refreshBalance() {
      const r = await call('get-account-balance');
      balance.value = r.balance; isMember.value = !!r.member;
    }
    async function refreshProfile() {
      const r = await call('get-user-profile');
      Object.assign(profile, r);
      checkedIn.value = Number(r.lastCheckinAt) >= new Date().setHours(0,0,0,0);
      streak.value = r.checkinStreak || 0;
    }
    async function refreshTasks() {
      const r = await call('get-user-tasks'); tasks.value = r.items || [];
    }
    async function refreshMembership() {
      try { const r = await call('get-membership'); Object.assign(membership, r); isMember.value = r.member; } catch {}
    }
    async function doCheckin() {
      try {
        const r = await call('create-checkin');
        if (r.alreadyCheckedIn) return toast('今天已经签到过了');
        balance.value = r.balance; streak.value = r.streak; checkedIn.value = true;
        toast(`签到成功 +${fmt(r.credits)}`);
      } catch (e) { toast(e.message); }
    }
    async function claimTask(t) {
      try {
        const r = await call('claim-task-reward', { key:t.key });
        balance.value = r.balance; await refreshTasks(); toast(`领取成功 +${fmt(r.credits)}`);
      } catch (e) { toast(e.message); }
    }

    // ---------- 设置 ----------
    async function loadSettings() {
      try {
        const r = await call('get-chat-settings');
        Object.assign(settings, r.settings);
        Object.assign(limits, r.limits || {});
        models.value = r.models || [];
      } catch (e) { toast(e.message); }
    }
    async function saveSettings() {
      try {
        const r = await call('update-chat-settings', { settings: { ...settings } });
        Object.assign(settings, r.settings);
      } catch (e) { toast(e.message); }
    }
    function toggleSetting(key) {
      settings[key] = !settings[key];
      saveSettings();
      if (key === 'knowledgeEnabled' && settings[key]) toast('长期记忆已开启,每条消息额外消耗 50 额度');
    }

    // ---------- 人设 ----------
    async function loadPersonas() {
      try { const r = await call('list-personas'); personas.value = r.items || []; } catch {}
    }
    function newPersona() {
      personaForm.open = true; personaForm.id = null;
      personaForm.name = ''; personaForm.description = '';
    }
    async function savePersona() {
      try {
        await call('upsert-persona', {
          id: personaForm.id, name: personaForm.name, description: personaForm.description,
        });
        personaForm.open = false; await loadPersonas(); toast('已保存');
      } catch (e) { toast(e.message); }
    }
    async function activatePersona(p) {
      try {
        await call('activate-persona', { id: p.active ? null : p.id });
        await loadPersonas();
      } catch (e) { toast(e.message); }
    }
    async function deletePersona(p) {
      try { await call('delete-persona', { id:p.id }); await loadPersonas(); } catch (e) { toast(e.message); }
    }

    // ---------- 会话 ----------
    async function loadArchives() {
      try { const r = await call('list-archives'); archives.value = r.items || []; } catch {}
    }

    // ============ 角色卡详情页 ============
    async function openDetail(card) {
      Object.assign(detail, {
        open: true, loading: true, card: null, stats: {}, times: {},
        gallery: [], galleryUnlocked: false, author: {}, comments: [], bounties: [],
        bountyPool: 0, bountyCount: 0,
        interactions: { liked:false, favorited:false, bookmarked:false, followed:false },
        archive: null, notesExpanded: false,
      });
      try {
        const r = await call('get-card-detail', { id: card.id });
        detail.card = r.card;
        detail.stats = r.stats || {};
        detail.times = r.times || {};
        detail.gallery = r.gallery || [];
        detail.galleryUnlocked = !!r.galleryUnlocked;
        detail.author = r.author || {};
        detail.comments = r.comments || [];
        detail.bounties = r.bounties || [];
        detail.bountyPool = r.bountyPool || 0;
        detail.bountyCount = r.bountyCount || 0;
        detail.interactions = r.interactions || detail.interactions;
        detail.archive = r.archive;
      } catch (e) { toast(e.message); }
      detail.loading = false;
    }
    function closeDetail() { detail.open = false; }

    async function startChatFromDetail() {
      if (!detail.card) return;
      await openChat(detail.card);
    }

    async function unlockGallery() {
      try {
        const r = await call('unlock-gallery', { characterCardId: detail.card.id });
        detail.gallery = r.gallery || detail.gallery;
        detail.galleryUnlocked = true;
        balance.value = r.balance;
        toast(r.already ? '已解锁' : `解锁成功 · -${r.credits}`);
      } catch (e) { toast(e.message); }
    }

    function viewGalleryImage(g) {
      if (g.locked) return unlockGallery();
    }

    async function detailFavorite() {
      try {
        const r = await call('toggle-favorite', { characterCardId: detail.card.id });
        detail.interactions.favorited = r.favorited;
        detail.stats.favorites = Math.max(0, (detail.stats.favorites || 0) + (r.favorited ? 1 : -1));
      } catch (e) { toast(e.message); }
    }

    async function detailBookmark() {
      try {
        const r = await call('toggle-bookmark', { characterCardId: detail.card.id });
        detail.interactions.bookmarked = r.bookmarked;
        toast(r.bookmarked ? '已加入书签' : '已移除书签');
      } catch (e) { toast(e.message); }
    }

    async function detailShare() {
      try {
        const r = await call('get-character-share-link', { id: detail.card.id });
        const url = location.origin + r.url;
        navigator.clipboard?.writeText(url);
        await call('track-share', { characterCardId: detail.card.id });
        toast('链接已复制');
      } catch (e) { toast(e.message); }
    }

    async function toggleFollowAuthor() {
      try {
        const r = await call('toggle-follow', { userId: detail.author.userId });
        detail.author.following = r.following;
        toast(r.following ? '已关注' : '已取消关注');
      } catch (e) { toast(e.message); }
    }

    async function chargeAuthor() {
      const v = prompt('充电额度(每 10 额度为作者增加 1 点热度)', '1000');
      if (!v) return;
      try {
        const r = await call('charge-author', {
          characterCardId: detail.card.id, amount: Number(v),
        });
        balance.value = r.balance;
        detail.bountyPool = detail.bountyPool;
        await openDetail(detail.card);
        toast(`充电成功 · 热度 +${r.popularityGain}`);
      } catch (e) { toast(e.message); }
    }

    async function createCardBounty() {
      const v = prompt('悬赏额度', '1000');
      if (!v) return;
      const title = prompt('悬赏内容', '想看另一个剧情走向');
      if (!title) return;
      try {
        await call('create-card-bounty', {
          characterCardId: detail.card.id, rewardCredits: Number(v), title,
        });
        await openDetail(detail.card);
        toast('悬赏已发布');
      } catch (e) { toast(e.message); }
    }

    function openCommentBox() {
      const v = prompt('写点评论', '氛围感很强。');
      if (!v) return;
      (async () => {
        try {
          await call('create-comment', { characterCardId: detail.card.id, rating: 5, content: v });
          await openDetail(detail.card);
          toast('评论已发布');
        } catch (e) { toast(e.message); }
      })();
    }

    const fmtShort = n => {
      const v = Number(n) || 0;
      if (v >= 1000000) return (v / 1000000).toFixed(1) + 'm';
      if (v >= 1000) return Math.round(v / 1000) + 'k';
      return String(v);
    };

    async function openChat(card) {
      currentCard.value = card;
      tab.value = 'chat';
      detail.open = false;
      try {
        const [arch, detail] = await Promise.all([
          call('get-archive', { characterCardId: card.id }),
          call('get-public-character-card', { id: card.id }),
        ]);
        messages.value = (arch.messages || []).map(m => ({
          role: m.role, status: m.status, content: m.content,
          statusRows: parseBar(m.status_bar || m.statusBar),
          plotOptions: m.plot_options || m.plotOptions || [],
          imageUrl: m.image_url || m.imageUrl,
          directive: m.directive, directiveText: m.directiveText,
        }));
        liked.value = !!detail.stats?.liked;
        favorited.value = !!detail.stats?.favorited;
      } catch { messages.value = []; }
      scrollStory();
      loadArchives();
    }

    async function openArchive(a) {
      try {
        const r = await call('get-public-character-card', { id: a.characterCardId });
        await openChat(r.card);
      } catch (e) { toast(e.message); }
    }

    function parseBar(text) {
      if (!text) return null;
      return String(text).split('\n').map(line => {
        const t = line.trim();
        const m = t.match(/^(\S+?)\s*([^\s:：]{1,12})\s*[:：]\s*(.*)$/);
        if (!m) return null;
        const pct = m[3].match(/^(\d{1,3})\s*%$/);
        return { emoji:m[1], key:m[2], value:m[3], percent: pct ? Math.min(100, Number(pct[1])) : null };
      }).filter(Boolean);
    }

    function scrollStory() {
      nextTick(() => { const el = storyEl.value; if (el) el.scrollTop = el.scrollHeight; });
    }

    // ---- 流式发送 ----
    async function send() {
      const raw = draft.value.trim();
      if (!raw || !currentCard.value || sending.value) return;
      const text = composerMode.value === 'action' ? `（${raw}）` : raw;
      draft.value = '';
      await runStream({ message: text }, { role: 'user', content: text });
    }

    async function sendDirective() {
      if (!currentCard.value || sending.value) return;
      if (!directiveText.value.trim()) return toast('请填写指令内容');
      const type = directiveType.value;
      const dtext = directiveText.value.trim();
      directorOpen.value = false;
      await runStream(
        { directiveType: type, directiveText: dtext },
        { role: 'user', content: `【${directiveLabel(type)}】${dtext}`, directive: type, directiveText: dtext }
      );
      directiveText.value = '';
    }

    /** 统一流式执行器 */
    async function runStream(payload, echoMsg) {
      const card = currentCard.value;
      if (!card) return;

      // 本地回显用户消息 + 占位 assistant
      messages.value.push(echoMsg);
      const assistantIdx = messages.value.length;
      messages.value.push({
        role: 'assistant', content: '', statusRows: null, plotOptions: [], streaming: true,
      });
      sending.value = true;
      scrollStory();

      const target = messages.value[assistantIdx];
      let buf = '';

      try {
        const res = await fetch('/api/chat-stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + store.apiKey,
          },
          body: JSON.stringify({ characterCardId: card.id, ...payload }),
        });

        if (!res.ok) {
          const t = await res.text();
          throw new Error(t.slice(0, 160) || ('HTTP ' + res.status));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });

          // SSE 按空行分帧
          const frames = pending.split('\n\n');
          pending = frames.pop() || '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let ev = 'message', data = '';
            for (const ln of lines) {
              if (ln.startsWith('event:')) ev = ln.slice(6).trim();
              else if (ln.startsWith('data:')) data += ln.slice(5).trim();
            }
            if (!data) continue;
            let obj;
            try { obj = JSON.parse(data); } catch { continue; }

            if (ev === 'delta') {
              buf += obj.text || '';
              target.content = buf;
              scrollStory();
            } else if (ev === 'status') {
              target.statusRows = (obj.rows || []).map(r => ({
                emoji: r.emoji, key: r.key, value: r.value, percent: r.percent,
              }));
              scrollStory();
            } else if (ev === 'options') {
              target.plotOptions = obj.items || [];
              scrollStory();
            } else if (ev === 'warning') {
              toast(obj.message);
            } else if (ev === 'error') {
              toast(obj.message || '生成失败');
              target.status = 'failed';
            } else if (ev === 'done') {
              target.streaming = false;
              target.status = obj.messageStatus;
              if (typeof obj.balance === 'number') balance.value = obj.balance;
            }
          }
        }
      } catch (e) {
        toast(e.message || '发送失败');
        target.status = 'failed';
        target.streaming = false;
        if (!buf) messages.value.splice(assistantIdx, 1);
      }

      target.streaming = false;
      sending.value = false;
      scrollStory();
      loadArchives();
    }

    function applyHistory(r) {
      messages.value = (r.history || []).map(m => ({
        role: m.role, status: m.status, content: m.content,
        statusRows: m.statusBar ? parseBar(m.statusBar) : null,
        plotOptions: m.plotOptions || [],
        imageUrl: m.imageUrl,
        directive: m.directive, directiveText: m.directiveText,
      }));
    }

    // 重新生成
    async function regenerate() {
      if (!currentCard.value || sending.value) return;
      sending.value = true;
      try {
        const r = await call('regenerate-message', { characterCardId: currentCard.value.id });
        await openChat(currentCard.value);
        balance.value = r.balance;
        if (r.warning) toast(r.warning);
        else toast('已重新生成');
      } catch (e) { toast(e.message); }
      sending.value = false;
    }

    // 快捷格式:包裹选中文本
    function wrapSelection(kind) {
      const el = draftEl.value;
      if (!el) return;
      const map = {
        dialogue: ['"', '"'],
        scene: ['[', ']'],
        monologue: ['（', '）'],
      };
      const pair = map[kind];
      if (!pair) return;
      const start = el.selectionStart ?? draft.value.length;
      const end = el.selectionEnd ?? draft.value.length;
      const before = draft.value.slice(0, start);
      const sel = draft.value.slice(start, end) || (kind === 'scene' ? '剧情推进' : '');
      const after = draft.value.slice(end);
      draft.value = before + pair[0] + sel + pair[1] + after;
      nextTick(() => {
        el.focus();
        const pos = start + pair[0].length + sel.length;
        el.setSelectionRange(pos, pos);
      });
    }

    function insertCharName() {
      if (!currentCard.value) return;
      const name = currentCard.value.data.nickname || currentCard.value.data.name || '';
      const el = draftEl.value;
      const pos = el?.selectionStart ?? draft.value.length;
      draft.value = draft.value.slice(0, pos) + name + draft.value.slice(pos);
      nextTick(() => { el?.focus(); el?.setSelectionRange(pos + name.length, pos + name.length); });
    }

    // 会话菜单
    function openArchiveMenu(a) {
      sheet.type = 'archiveMenu';
      sheet.title = a.title || a.nickname || a.name;
      sheet.archive = a;
      sheet.open = true;
    }
    async function togglePin(a) {
      try {
        await call('update-archive', { archiveId: a.id, pinned: !a.pinned });
        await loadArchives(); closeSheet();
        toast(a.pinned ? '已取消置顶' : '已置顶');
      } catch (e) { toast(e.message); }
    }
    async function renameArchive(a) {
      const t = prompt('输入存档名称', a.title || a.nickname || a.name);
      if (t === null) return;
      try {
        await call('update-archive', { archiveId: a.id, title: t.trim() });
        await loadArchives(); closeSheet(); toast('名称已更新');
      } catch (e) { toast(e.message); }
    }
    async function deleteArchive(a) {
      if (!confirm('删除这个存档?聊天记录将无法恢复。')) return;
      try {
        await call('delete-archive', { archiveId: a.id });
        await loadArchives(); closeSheet(); toast('对话已删除');
        if (currentCard.value && currentCard.value.id === a.characterCardId) {
          currentCard.value = null; messages.value = [];
        }
      } catch (e) { toast(e.message); }
    }

    async function pickOption(o) {
      draft.value = o.text;
      composerMode.value = o.type === 'action' ? 'action' : 'dialogue';
      await send();
    }

    async function unlockImage(m) {
      try {
        const ctx = messages.value.slice(-3).map(x => x.content).join('\n');
        const r = await call('gen-image-for-message', { context: ctx });
        m.imageUrl = r.image.url;
        balance.value = r.balance;
        toast(`已生成 · -${r.credits}`);
      } catch (e) { toast(e.message); }
    }

    async function undoRound() {
      try {
        const r = await call('undo-last-round', { characterCardId: currentCard.value.id });
        messages.value = (r.messages || []).map(m => ({ role:m.role, content:m.content }));
        closeSheet(); toast('已撤销');
      } catch (e) { toast(e.message); }
    }
    async function refreshGreeting() {
      try {
        const r = await call('refresh-greeting', { characterCardId: currentCard.value.id });
        messages.value = [{ role:'assistant', content: r.greeting }];
        closeSheet();
      } catch (e) { toast(e.message); }
    }

    function showCardActions() {
      sheet.type = 'cardActions'; sheet.title = '角色操作'; sheet.open = true;
    }
    function openChatSettings() {
      sheet.type = 'chatSettings'; sheet.title = '对话设置'; sheet.open = true;
    }
    async function openKnowledge() {
      try {
        const r = await call('list-knowledge', { characterCardId: currentCard.value.id });
        knowledge.value = r.items || [];
      } catch {}
      sheet.type = 'knowledge'; sheet.title = '长期记忆'; sheet.open = true;
    }
    async function deleteKnowledge(k) {
      try { await call('delete-knowledge', { id:k.id }); await openKnowledge(); } catch (e) { toast(e.message); }
    }
    async function regenerateKnowledge() {
      try {
        const r = await call('regenerate-knowledge', { characterCardId: currentCard.value.id });
        await openKnowledge(); toast(`回溯完成,${r.saved?.length || 0} 条`);
      } catch (e) { toast(e.message); }
    }

    async function doLike() {
      try { const r = await call('toggle-like', { characterCardId: currentCard.value.id }); liked.value = r.liked; closeSheet(); }
      catch (e) { toast(e.message); }
    }
    async function doFavorite() {
      try { const r = await call('toggle-favorite', { characterCardId: currentCard.value.id }); favorited.value = r.favorited; closeSheet(); }
      catch (e) { toast(e.message); }
    }
    async function openTip() {
      try { const r = await call('send-character-tip', { characterCardId: currentCard.value.id, amount:100 });
        balance.value = r.balance; closeSheet(); toast('已打赏'); }
      catch (e) { toast(e.message); }
    }
    async function openReview() {
      try { await call('upsert-review', { characterCardId: currentCard.value.id, rating:5, content:'很棒的角色。' });
        closeSheet(); toast('评价已提交'); }
      catch (e) { toast(e.message); }
    }

    // ---------- 绘图 ----------
    async function loadEngines() {
      try { const r = await call('list-text-to-image-engines'); engines.value = r.engines || []; } catch {}
    }
    async function doDraw() {
      if (!drawPrompt.value.trim()) return toast('先写点描述');
      drawing.value = true;
      try {
        const r = await call('generate-image', {
          prompt: drawPrompt.value, engineId: drawEngine.value, count: drawCount.value,
        });
        drawImages.value = r.images || []; balance.value = r.balance;
        toast(`生成完成 · -${r.credits}`);
      } catch (e) { toast(e.message); }
      drawing.value = false;
    }

    // ---------- 其他 ----------
    async function loadBounties() {
      try { const r = await call('list-active-bounties'); bounties.value = r.items || []; } catch {}
    }
    async function reserveBounty(b) {
      try { await call('reserve-bounty-slot', { bountyId:b.id }); toast('接单成功'); loadBounties(); }
      catch (e) { toast(e.message); }
    }
    async function loadLeaderboard() {
      try { const r = await call('get-leaderboard'); leaderboard.value = r.items || []; } catch {}
    }
    async function loadMyCards() {
      try { const r = await call('list-my-character-cards'); myCards.value = r.items || []; } catch {}
    }
    async function genCard() {
      if (!genIdea.value.trim()) return toast('先写点想法');
      generating.value = true;
      try {
        const r = await call('gen-character-card', { idea: genIdea.value });
        draftCard.value = { ...r.draft };
        draftTags.value = (r.draft.tags || []).join(',');
        balance.value = r.balance;
        toast('草稿已生成');
      } catch (e) { toast(e.message); }
      generating.value = false;
    }
    async function saveDraft() {
      if (!draftCard.value) return;
      try {
        const data = { ...draftCard.value, tags: draftTags.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean) };
        const c = await call('upsert-character-card', { id: draftCard.value.id, data });
        await call('publish-character-card', { id: c.id });
        toast('已发布'); draftCard.value = null; genIdea.value = '';
        await loadMyCards(); await loadCards(true);
      } catch (e) { toast(e.message); }
    }
    function editCard(c) {
      draftCard.value = {
        id:c.id, name:c.data.name, nickname:c.data.nickname,
        creator_notes:c.data.creator_notes, personality:c.data.personality,
        scenario:c.data.scenario, appearance:c.data.appearance,
        opening_line:c.data.opening_line, preset_status_block:c.data.preset_status_block,
      };
      draftTags.value = (c.data.tags || []).join(',');
      window.scrollTo(0,0);
    }
    async function subscribe(plan) {
      try { const r = await call('subscribe-membership', { plan });
        toast(`开通成功,${r.days} 天`); await refreshMembership(); }
      catch (e) { toast(e.message); }
    }

    async function openRecharge() {
      const r = await call('list-recharge-packages');
      packages.value = r.packages || [];
      sheet.type = 'recharge'; sheet.title = '充值额度'; sheet.open = true;
    }
    async function buy(p) {
      try {
        const r = await call('create-payment-link', { packageId:p.id });
        window.open('/pay/' + r.orderId, '_blank');
        toast('已创建订单');
        const poll = setInterval(async () => {
          try {
            const st = await call('get-order-status', { orderId:r.orderId });
            if (st.order.status === 'paid') {
              clearInterval(poll); closeSheet();
              await refreshBalance(); toast('充值成功');
            }
          } catch {}
        }, 1500);
        setTimeout(() => clearInterval(poll), 120000);
      } catch (e) { toast(e.message); }
    }

    async function openNotifications() {
      try { const r = await call('get-notifications'); notifications.value = r.items || []; } catch {}
      sheet.type = 'notifications'; sheet.title = '通知'; sheet.open = true;
    }
    async function redeem() {
      if (!redeemInput.value.trim()) return;
      try { const r = await call('redeem-code', { code:redeemInput.value });
        balance.value = r.balance; redeemInput.value = ''; toast(`兑换成功 +${fmt(r.credits)}`); }
      catch (e) { toast(e.message); }
    }
    async function openInvite() {
      try {
        const [c,s,a] = await Promise.all([
          call('get-invite-code'), call('get-invite-code-stats'), call('get-ambassador-dashboard'),
        ]);
        inviteCode.value = c.code; inviteStats.value = s; ambassador.value = a;
      } catch {}
    }
    function copyInvite() {
      navigator.clipboard?.writeText(inviteCode.value).then(()=>toast('已复制'), ()=>toast(inviteCode.value));
    }

    function closeSheet() { sheet.open = false; }
    function toggleSearch() { searchOpen.value = !searchOpen.value; if (!searchOpen.value) { keyword.value=''; loadCards(true); } }
    function logout() { localStorage.removeItem('xy_api_key'); localStorage.removeItem('xy_user_id'); location.reload(); }

    watch(tab, t => {
      if (t === 'chat') loadArchives();
      if (t === 'rank') loadLeaderboard();
      if (t === 'bounty') loadBounties();
      if (t === 'workshop') loadMyCards();
      if (t === 'draw') loadEngines();
      if (t === 'settings') { loadPersonas(); }
      if (t === 'ambassador') openInvite();
      if (t === 'tasks') refreshTasks();
    });

    onMounted(async () => {
      try {
        if (!store.apiKey) await login();
        await Promise.all([refreshBalance(), refreshProfile(), loadSettings(), refreshMembership()]);
        await loadCards(true);
        await loadArchives();
        const dt = await call('get-directive-types');
        directiveTypes.value = dt.types || [];
      } catch (e) { console.error(e); toast('初始化失败: ' + e.message); }
    });

    return {
      tab, feed, feedList, keyword, searchOpen, balance, profile, isMember, membership, unread,
      cards, cursor, loadMore, setFeed, onSearch, checkedIn, streak, tasks,
      archives, currentCard, messages, draft, sending, composerMode, liked, favorited,
      openChat, openArchive, send, pickOption, unlockImage, undoRound, refreshGreeting,
      showCardActions, openChatSettings, openKnowledge, deleteKnowledge, regenerateKnowledge,
      doLike, doFavorite, openTip, openReview,
      settings, limits, models, modelLabel, formatLabel, saveSettings, toggleSetting,
      personas, personaForm, newPersona, savePersona, activatePersona, deletePersona,
      knowledge, engines, drawEngine, drawCount, drawPrompt, drawImages, drawing, doDraw, drawCost,
      bounties, reserveBounty, leaderboard, myCards, draftCard, draftTags, genIdea, generating,
      genCard, saveDraft, editCard, plans, subscribe, inviteCode, inviteStats, ambassador,
      packages, openRecharge, buy, openNotifications, notifications, redeemInput, redeem,
      copyInvite, sheet, closeSheet, toastMsg, fmt, fmtDate, relTime, isNew, toggleSearch,
      logout, meEntries, storyEl, draftEl, doCheckin, claimTask,
      // 指令 / 会话管理
      directorOpen, directiveType, directiveText, directiveTypes, directiveLabel,
      lastAssistantIndex, sendDirective, regenerate, wrapSelection, insertCharName,
      openArchiveMenu, togglePin, renameArchive, deleteArchive,
      // 详情页
      detail, openDetail, closeDetail, startChatFromDetail, unlockGallery, viewGalleryImage,
      detailFavorite, detailBookmark, detailShare, toggleFollowAuthor, chargeAuthor,
      createCardBounty, openCommentBox, fmtShort,
    };
  },
}).mount('#app');
