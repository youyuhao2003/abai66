# 素材生成与接入

用 `gpt-image-2.5` 生成的角色插画，已接入数据库和界面。

## 文件清单

```
public/assets/characters/
├── hero.jpg       1600x899   210KB   首页 hero 横幅（横版）
├── poster.jpg      900x1350  162KB   详情页大海报（竖版 2:3）
├── avatar.jpg      520x520    51KB   头像 / 列表缩略图（方形）
├── gallery-1.jpg   820x820    97KB   客厅沙发，深夜画稿
├── gallery-2.jpg   820x820    98KB   阳台，晾着的衣服和夕阳
├── gallery-3.jpg   820x820   109KB   厨房，早上煮面
├── gallery-4.jpg   820x820    75KB   玄关，多出来的那双拖鞋
└── gallery-5.jpg   820x820   103KB   卧室门半掩，走廊的光
```

合计约 0.9MB。原始 PNG 共 16MB，压缩后体积降到 6%。

## 数据库字段

```sql
-- 角色卡
character_cards.avatar_url  = /assets/characters/avatar.jpg
character_cards.poster_url  = /assets/characters/poster.jpg
character_cards.hero_url    = /assets/characters/hero.jpg   -- 新增字段

-- 相册（按 sort 0-4）
character_gallery.url       = /assets/characters/gallery-N.jpg
```

接入脚本：`sql/assets.sql`

## 前端取值

| 位置 | 取值顺序 |
|---|---|
| 首页 hero | `heroUrl` → `posterUrl` → `avatarUrl` |
| 列表缩略图 | `avatarUrl` → `posterUrl` |
| 详情页海报 | `posterUrl` → `avatarUrl` |
| 相册 | `gallery[].thumb` |

## 重新生成

```bash
# 全部 8 张（约 6 分钟）
node tools/generate-assets.mjs

# 只重生成某一张
node tools/generate-assets.mjs hero
```

脚本里的 API 配置在文件头部：

```js
const BASE = 'https://your-image-api.example.com';
const KEY  = 'sk-...';
const OUT  = 'E:/abai/66/public/assets/characters';
```

### 提示词结构

每张图共用三段：

```
STYLE  = masterpiece, anime illustration, soft cel shading,
         warm pastel, cinematic lighting, film grain
CHAR   = 24 岁中国女性，齐肩黑发，浅褐色眼睛，
         穿洗旧的白色 oversize T 恤
NEG    = lowres, bad anatomy, extra fingers, watermark, text...
```

再叠加各自的场景描述。改 `CHAR` 就能换角色，改 `JOBS[].prompt` 就能换构图。

### 尺寸对照

| 用途 | size | 说明 |
|---|---|---|
| hero | `1536x1024` | 横版，左侧留白给标题 |
| poster | `1024x1536` | 竖版 2:3 |
| avatar / gallery | `1024x1024` | 方形 |

生成后建议压缩（脚本不压缩，需手动或用 PIL）：

```python
from PIL import Image
im = Image.open('x.png').convert('RGB')
im.thumbnail((820, 820), Image.LANCZOS)
im.save('x.jpg', 'JPEG', quality=82, optimize=True, progressive=True)
```

## 注意

- API 是异步长耗时，单张 30-75 秒，串行生成。
- 返回 `b64_json`（不是 URL），直接写文件。
- `hero_url` 是新增列，旧库需要先执行：

```sql
ALTER TABLE character_cards ADD COLUMN hero_url VARCHAR(1024) NULL AFTER poster_url;
```
