// 热度算法:点赞+收藏+评论+对话+生图 综合计算
// "热度分数 — 由点赞、收藏、评论、消息与图片生成综合计算得出"

/** 权重(调这个就能改变热度增长速度) */
export const POPULARITY_WEIGHTS = {
  like: 3,
  favorite: 8,
  comment: 15,
  chat: 2,
  image: 5,
  view: 0.1,
};

/** 由各项计数算出热度 */
export function calcPopularity({
  likes = 0, favorites = 0, comments = 0, chats = 0, images = 0, views = 0,
}) {
  const w = POPULARITY_WEIGHTS;
  const raw =
    likes * w.like +
    favorites * w.favorite +
    comments * w.comment +
    chats * w.chat +
    images * w.image +
    views * w.view;
  return Math.floor(raw);
}

/** 热度等级(tier 1-4,对应微热/热门/爆款/现象级) */
export function popularityTier(p) {
  if (p >= 300000) return 4;   // 现象级
  if (p >= 100000) return 3;   // 爆款
  if (p >= 20000) return 2;    // 热门
  if (p >= 3000) return 1;     // 微热
  return 0;
}

export const TIER_LABELS = {
  0: null,
  1: '微热',
  2: '热门',
  3: '爆款',
  4: '现象级',
};
