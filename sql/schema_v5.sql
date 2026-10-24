-- 第五阶段:角色卡详情页所需
USE `wujie_tavern`;

-- 角色相册
CREATE TABLE IF NOT EXISTS character_gallery (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  character_card_id VARCHAR(32) NOT NULL,
  url               VARCHAR(1024) NOT NULL,
  caption           VARCHAR(255) NOT NULL DEFAULT '',
  unlock_credits    INT NOT NULL DEFAULT 0,
  sort              INT NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  KEY idx_card (character_card_id, sort)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gallery_unlocks (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  unlocked_all      TINYINT(1) NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id)
) ENGINE=InnoDB;

-- 作者充电(角色级打赏,与 character_tips 区分:带热度加成)
CREATE TABLE IF NOT EXISTS author_charges (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  author_id         VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NULL,
  amount            INT NOT NULL,
  popularity_gain   INT NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  KEY idx_author (author_id, created_at DESC),
  KEY idx_card (character_card_id)
) ENGINE=InnoDB;

-- 角色信息流 / 动态
CREATE TABLE IF NOT EXISTS card_feed (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  character_card_id VARCHAR(32) NOT NULL,
  type              ENUM('created','updated','published','milestone') NOT NULL DEFAULT 'updated',
  text              VARCHAR(255) NOT NULL DEFAULT '',
  created_at        BIGINT NOT NULL,
  KEY idx_card (character_card_id, created_at DESC)
) ENGINE=InnoDB;

-- 角色卡补:互动统计与时间
ALTER TABLE character_cards
  ADD COLUMN comment_count INT NOT NULL DEFAULT 0 AFTER chat_count,
  ADD COLUMN bookmark_count INT NOT NULL DEFAULT 0 AFTER comment_count,
  ADD COLUMN share_count INT NOT NULL DEFAULT 0 AFTER bookmark_count,
  ADD COLUMN bounty_pool INT NOT NULL DEFAULT 0 AFTER share_count,
  ADD COLUMN bounty_count INT NOT NULL DEFAULT 0 AFTER bounty_pool,
  ADD COLUMN author_charged INT NOT NULL DEFAULT 0 AFTER bounty_count,
  ADD COLUMN first_published_at BIGINT NULL AFTER author_charged,
  ADD COLUMN last_edited_at BIGINT NULL AFTER first_published_at;

-- 用户书签
CREATE TABLE IF NOT EXISTS bookmarks (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  created_at        BIGINT NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id)
) ENGINE=InnoDB;

-- 作者等级(帝师太傅 30 那种)
CREATE TABLE IF NOT EXISTS author_levels (
  user_id     VARCHAR(32) PRIMARY KEY,
  level       INT NOT NULL DEFAULT 1,
  title       VARCHAR(32) NOT NULL DEFAULT '初出茅庐',
  total_charge INT NOT NULL DEFAULT 0,
  total_cards INT NOT NULL DEFAULT 0,
  updated_at  BIGINT NOT NULL
) ENGINE=InnoDB;

-- 角色级悬赏池
CREATE TABLE IF NOT EXISTS card_bounties (
  id                VARCHAR(32) PRIMARY KEY,
  character_card_id VARCHAR(32) NOT NULL,
  creator_id        VARCHAR(32) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  reward_credits    INT NOT NULL DEFAULT 0,
  status            ENUM('open','filled','closed') NOT NULL DEFAULT 'open',
  created_at        BIGINT NOT NULL,
  KEY idx_card (character_card_id)
) ENGINE=InnoDB;
