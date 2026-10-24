-- 把生成的素材接入角色卡与相册
USE abai66;

-- 1. 角色卡头像 / 海报 / 首页横幅
UPDATE character_cards SET
  avatar_url = '/assets/characters/avatar.jpg',
  poster_url = '/assets/characters/poster.jpg',
  hero_url   = '/assets/characters/hero.jpg'
WHERE status = 'public';

-- 2. 相册（按 sort 顺序覆盖）
UPDATE character_gallery SET url = '/assets/characters/gallery-1.jpg' WHERE sort = 0;
UPDATE character_gallery SET url = '/assets/characters/gallery-2.jpg' WHERE sort = 1;
UPDATE character_gallery SET url = '/assets/characters/gallery-3.jpg' WHERE sort = 2;
UPDATE character_gallery SET url = '/assets/characters/gallery-4.jpg' WHERE sort = 3;
UPDATE character_gallery SET url = '/assets/characters/gallery-5.jpg' WHERE sort = 4;

-- 若相册少于 5 张则补齐
INSERT INTO character_gallery (character_card_id, url, caption, unlock_credits, sort, created_at)
SELECT c.id, '/assets/characters/gallery-1.jpg', '客厅沙发，深夜画稿', 50, 0, UNIX_TIMESTAMP()*1000 FROM character_cards c
  WHERE c.status='public' AND NOT EXISTS (SELECT 1 FROM character_gallery g WHERE g.character_card_id=c.id AND g.sort=0);
INSERT INTO character_gallery (character_card_id, url, caption, unlock_credits, sort, created_at)
SELECT c.id, '/assets/characters/gallery-2.jpg', '阳台，晾着的衣服和夕阳', 50, 1, UNIX_TIMESTAMP()*1000 FROM character_cards c
  WHERE c.status='public' AND NOT EXISTS (SELECT 1 FROM character_gallery g WHERE g.character_card_id=c.id AND g.sort=1);
INSERT INTO character_gallery (character_card_id, url, caption, unlock_credits, sort, created_at)
SELECT c.id, '/assets/characters/gallery-3.jpg', '厨房，早上煮面', 50, 2, UNIX_TIMESTAMP()*1000 FROM character_cards c
  WHERE c.status='public' AND NOT EXISTS (SELECT 1 FROM character_gallery g WHERE g.character_card_id=c.id AND g.sort=2);
INSERT INTO character_gallery (character_card_id, url, caption, unlock_credits, sort, created_at)
SELECT c.id, '/assets/characters/gallery-4.jpg', '玄关，多出来的那双拖鞋', 50, 3, UNIX_TIMESTAMP()*1000 FROM character_cards c
  WHERE c.status='public' AND NOT EXISTS (SELECT 1 FROM character_gallery g WHERE g.character_card_id=c.id AND g.sort=3);
INSERT INTO character_gallery (character_card_id, url, caption, unlock_credits, sort, created_at)
SELECT c.id, '/assets/characters/gallery-5.jpg', '卧室门半掩，走廊的光', 50, 4, UNIX_TIMESTAMP()*1000 FROM character_cards c
  WHERE c.status='public' AND NOT EXISTS (SELECT 1 FROM character_gallery g WHERE g.character_card_id=c.id AND g.sort=4);

-- 校验
SELECT id, nickname, avatar_url, poster_url, hero_url FROM character_cards WHERE status='public';
SELECT sort, url, caption FROM character_gallery ORDER BY sort;
