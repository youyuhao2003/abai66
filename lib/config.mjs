// 配置热加载:后台改完立即生效,不必重启
import { q, q1 } from './db.mysql.mjs';

const CACHE_MS = 3000;
let cache = { at: 0, config: {}, textModels: {}, imageModels: [] };

export async function loadConfig(force = false) {
  const now = () => Date.now();
  if (!force && now() - cache.at < CACHE_MS) return cache;

  const rows = await q('SELECT k, v FROM admin_config').catch(() => []);
  const config = {};
  for (const r of rows) config[r.k] = r.v;

  const tms = await q('SELECT * FROM admin_text_models WHERE enabled=1 ORDER BY sort, id').catch(() => []);
  const textModels = {};
  for (const m of tms) {
    textModels[m.id] = {
      id: m.id, name: m.name, displayName: m.display_name, backend: m.backend,
      provider: m.provider, creditPer1k: m.credit_per_1k, tier: m.tier,
      maxTokens: m.max_tokens, temperature: Number(m.temperature),
      vipOnly: !!m.vip_only,
    };
  }

  const ims = await q('SELECT * FROM admin_image_models WHERE enabled=1 ORDER BY sort, id').catch(() => []);
  const imageModels = ims.map(m => ({
    id: m.id, name: m.name, provider: m.provider, endpoint: m.endpoint,
    apiKey: m.api_key, modelName: m.model_name, credit: m.credit,
    width: m.width, height: m.height, aspectRatio: m.aspect_ratio,
    resolution: m.resolution, styleId: m.style_id, steps: m.steps,
    cfgScale: Number(m.cfg_scale), extraParams: m.extra_params,
  }));

  cache = { at: now(), config, textModels, imageModels };
  return cache;
}

/** 取单个配置值 */
export async function cfg(key, fallback = '') {
  const c = await loadConfig();
  return c.config[key] ?? fallback;
}

/** 取数字配置 */
export async function cfgInt(key, fallback = 0) {
  const v = await cfg(key, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 取布尔配置 */
export async function cfgBool(key, fallback = false) {
  const v = await cfg(key, '');
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

/** 取文字模型(按 id) */
export async function textModel(id) {
  const c = await loadConfig();
  return c.textModels[id] || null;
}

/** 取所有启用的文字模型 */
export async function allTextModels() {
  const c = await loadConfig();
  return Object.values(c.textModels);
}

/** 按 id 取第一个启用的生图引擎 */
export async function imageModel(id) {
  const c = await loadConfig();
  if (id) return c.imageModels.find(m => m.id === id) || null;
  return c.imageModels[0] || null;
}

/** 清缓存(后台保存后调用) */
export function invalidate() { cache.at = 0; }
