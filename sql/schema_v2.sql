-- 功能复原所需表结构(第二阶段)
USE `wujie_tavern`;

-- ================= 角色卡增强 =================
ALTER TABLE character_cards
  ADD COLUMN review_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN review_note TEXT NULL,
  ADD COLUMN rejected_reason TEXT NULL,
  ADD COLUMN published_at BIGINT NULL,
  ADD COLUMN view_count INT NOT NULL DEFAULT 0,
  ADD COLUMN like_count INT NOT NULL DEFAULT 0,
  ADD COLUMN favorite_count INT NOT NULL DEFAULT 0,
  ADD COLUMN chat_count INT NOT NULL DEFAULT 0,
  ADD COLUMN is_nsfw TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN language VARCHAR(16) NOT NULL DEFAULT 'zh-Hans';

-- ================= 世界书 =================
CREATE TABLE IF NOT EXISTS world_books (
  id           VARCHAR(32) PRIMARY KEY,
  owner_id     VARCHAR(32) NOT NULL,
  name         VARCHAR(128) NOT NULL,
  description  TEXT NULL,
  status       ENUM('draft','public','private') NOT NULL DEFAULT 'private',
  is_public    TINYINT(1) NOT NULL DEFAULT 0,
  review_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  entries      JSON NULL,
  char_count   INT NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  KEY idx_owner (owner_id),
  KEY idx_public (is_public, review_status)
) ENGINE=InnoDB;

-- ================= 知识库 =================
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  title             VARCHAR(255) NOT NULL DEFAULT '',
  content           TEXT NOT NULL,
  source            ENUM('manual','auto') NOT NULL DEFAULT 'manual',
  created_at        BIGINT NOT NULL,
  KEY idx_user_card (user_id, character_card_id)
) ENGINE=InnoDB;

-- ================= 评价 =================
CREATE TABLE IF NOT EXISTS card_reviews (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  rating            TINYINT NOT NULL DEFAULT 5,
  content           TEXT NOT NULL,
  is_pinned         TINYINT(1) NOT NULL DEFAULT 0,
  likes             INT NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id),
  KEY idx_card (character_card_id, created_at DESC)
) ENGINE=InnoDB;

-- ================= 点赞 =================
CREATE TABLE IF NOT EXISTS likes (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  target_type       ENUM('card','review','message') NOT NULL DEFAULT 'card',
  target_id         VARCHAR(32) NOT NULL,
  created_at        BIGINT NOT NULL,
  UNIQUE KEY uk_like (user_id, target_type, target_id),
  KEY idx_target (target_type, target_id)
) ENGINE=InnoDB;

-- ================= 关注 =================
CREATE TABLE IF NOT EXISTS follows (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  follower_id VARCHAR(32) NOT NULL,
  following_id VARCHAR(32) NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE KEY uk_follow (follower_id, following_id),
  KEY idx_following (following_id)
) ENGINE=InnoDB;

-- ================= 用户图片 =================
CREATE TABLE IF NOT EXISTS user_images (
  id         VARCHAR(32) PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  url        VARCHAR(512) NOT NULL,
  prompt     TEXT NULL,
  engine_id  VARCHAR(32) NOT NULL DEFAULT '',
  source     ENUM('upload','generate') NOT NULL DEFAULT 'generate',
  reviewed   TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  KEY idx_user (user_id, created_at DESC)
) ENGINE=InnoDB;

-- ================= 角色打赏 =================
CREATE TABLE IF NOT EXISTS character_tips (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  amount            INT NOT NULL,
  message           VARCHAR(255) NOT NULL DEFAULT '',
  created_at        BIGINT NOT NULL,
  KEY idx_card (character_card_id, created_at DESC)
) ENGINE=InnoDB;

-- ================= 角色奖励进度 =================
CREATE TABLE IF NOT EXISTS character_rewards (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  milestones        JSON NULL,
  claimed           JSON NULL,
  updated_at        BIGINT NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id)
) ENGINE=InnoDB;

-- ================= 悬赏 =================
CREATE TABLE IF NOT EXISTS bounties (
  id                VARCHAR(32) PRIMARY KEY,
  creator_id        VARCHAR(32) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT NULL,
  category          VARCHAR(64) NOT NULL DEFAULT '',
  reward_credits    INT NOT NULL DEFAULT 0,
  slots             INT NOT NULL DEFAULT 1,
  used_slots        INT NOT NULL DEFAULT 0,
  status            ENUM('open','filled','closed') NOT NULL DEFAULT 'open',
  expires_at        BIGINT NULL,
  created_at        BIGINT NOT NULL,
  KEY idx_status (status, created_at DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bounty_claims (
  id           VARCHAR(32) PRIMARY KEY,
  bounty_id    VARCHAR(32) NOT NULL,
  user_id      VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NULL,
  status       ENUM('reserved','submitted','approved','rejected','abandoned') NOT NULL DEFAULT 'reserved',
  progress     INT NOT NULL DEFAULT 0,
  low_quality  TINYINT(1) NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE KEY uk_bounty_user (bounty_id, user_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB;

-- ================= 通知 =================
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  type       VARCHAR(32) NOT NULL DEFAULT 'system',
  title      VARCHAR(255) NOT NULL,
  body       TEXT NULL,
  link       VARCHAR(255) NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  KEY idx_user (user_id, is_read, id DESC)
) ENGINE=InnoDB;

-- ================= 佣金 =================
CREATE TABLE IF NOT EXISTS commissions (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(32) NOT NULL,
  from_user_id VARCHAR(32) NULL,
  type        ENUM('invite','rebate','ambassador') NOT NULL DEFAULT 'invite',
  amount      INT NOT NULL,
  rate        DECIMAL(5,2) NOT NULL DEFAULT 0,
  base_amount INT NOT NULL DEFAULT 0,
  status      ENUM('pending','settled','withdrawn') NOT NULL DEFAULT 'settled',
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL,
  KEY idx_user (user_id, created_at DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS withdrawals (
  id         VARCHAR(32) PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  amount     INT NOT NULL,
  method     VARCHAR(32) NOT NULL DEFAULT 'credits',
  status     ENUM('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  KEY idx_user (user_id, created_at DESC)
) ENGINE=InnoDB;

-- ================= 工单 =================
CREATE TABLE IF NOT EXISTS tickets (
  id         VARCHAR(32) PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  subject    VARCHAR(255) NOT NULL,
  category   VARCHAR(64) NOT NULL DEFAULT 'other',
  status     ENUM('open','pending','closed') NOT NULL DEFAULT 'open',
  priority   ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_user (user_id, updated_at DESC),
  KEY idx_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id  VARCHAR(32) NOT NULL,
  sender_id  VARCHAR(32) NOT NULL,
  sender_type ENUM('user','staff') NOT NULL DEFAULT 'user',
  content    TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_ticket (ticket_id, id)
) ENGINE=InnoDB;

-- ================= Miniapp KV =================
CREATE TABLE IF NOT EXISTS miniapp_kv (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  miniapp_id VARCHAR(64) NOT NULL,
  k          VARCHAR(128) NOT NULL,
  v          MEDIUMTEXT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uk_kv (user_id, miniapp_id, k)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS miniapps (
  id         VARCHAR(64) PRIMARY KEY,
  owner_id   VARCHAR(32) NOT NULL,
  name       VARCHAR(128) NOT NULL,
  spec       JSON NULL,
  status     ENUM('draft','building','ready','failed') NOT NULL DEFAULT 'draft',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_owner (owner_id)
) ENGINE=InnoDB;

-- ================= 用户偏好 =================
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    VARCHAR(32) PRIMARY KEY,
  data       JSON NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_model_settings (
  user_id    VARCHAR(32) PRIMARY KEY,
  models     JSON NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB;

-- ================= 发布日志 =================
CREATE TABLE IF NOT EXISTS publish_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  card_id    VARCHAR(32) NOT NULL,
  action     VARCHAR(32) NOT NULL,
  status     VARCHAR(32) NOT NULL DEFAULT 'success',
  note       TEXT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_user (user_id, created_at DESC)
) ENGINE=InnoDB;

-- ================= 举报 =================
CREATE TABLE IF NOT EXISTS reports (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id  VARCHAR(64) NOT NULL,
  reason     VARCHAR(255) NOT NULL,
  detail     TEXT NULL,
  status     ENUM('pending','handled','rejected') NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  KEY idx_status (status)
) ENGINE=InnoDB;
