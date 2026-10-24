-- 无界创镜 AI 数据库结构 (MySQL 8.0)
-- DROP DATABASE IF EXISTS `wujie_tavern`;
CREATE DATABASE IF NOT EXISTS `wujie_tavern` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `wujie_tavern`;

-- 用户
CREATE TABLE users (
  id              VARCHAR(32)  PRIMARY KEY,
  telegram_id     BIGINT       NULL,
  first_name      VARCHAR(64)  NOT NULL DEFAULT '旅行者',
  last_name       VARCHAR(64)  NOT NULL DEFAULT '',
  username        VARCHAR(64)  NOT NULL DEFAULT '',
  language_code   VARCHAR(16)  NOT NULL DEFAULT 'zh-hans',
  photo_url       VARCHAR(512) NULL,
  balance         INT          NOT NULL DEFAULT 0,
  member          TINYINT(1)   NOT NULL DEFAULT 0,
  member_until    BIGINT       NOT NULL DEFAULT 0,
  first_recharge  TINYINT(1)   NOT NULL DEFAULT 0,
  checkin_streak  INT          NOT NULL DEFAULT 0,
  last_checkin_at BIGINT       NOT NULL DEFAULT 0,
  created_at      BIGINT       NOT NULL,
  updated_at      BIGINT       NOT NULL,
  UNIQUE KEY uk_telegram (telegram_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB;

-- apiKey(会话令牌)
CREATE TABLE api_keys (
  api_key    CHAR(64)    PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  created_at BIGINT      NOT NULL,
  last_seen  BIGINT      NOT NULL,
  revoked    TINYINT(1)  NOT NULL DEFAULT 0,
  KEY idx_user (user_id),
  CONSTRAINT fk_key_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 角色卡
CREATE TABLE character_cards (
  id                 VARCHAR(32)  PRIMARY KEY,
  owner_id           VARCHAR(32)  NOT NULL,
  status             ENUM('draft','public','private') NOT NULL DEFAULT 'public',
  moderation_status  ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  name               VARCHAR(128) NOT NULL,
  nickname           VARCHAR(64)  NOT NULL DEFAULT '',
  tier               ENUM('R','SR','SSR') NOT NULL DEFAULT 'R',
  tags               JSON         NULL,
  creator            VARCHAR(64)  NOT NULL DEFAULT '',
  creator_notes      TEXT         NULL,
  system_prompt      TEXT         NULL,
  opening_line       TEXT         NULL,
  gender             VARCHAR(16)  NOT NULL DEFAULT 'female',
  avatar_url         VARCHAR(512) NULL,
  poster_url         VARCHAR(512) NULL,
  character_version  VARCHAR(16)  NOT NULL DEFAULT '1.0',
  popularity         INT          NOT NULL DEFAULT 0,
  popularity_tier    INT          NOT NULL DEFAULT 0,
  settings_char_count INT         NOT NULL DEFAULT 0,
  world_book_char_count INT       NOT NULL DEFAULT 0,
  created_at         BIGINT       NOT NULL,
  updated_at         BIGINT       NOT NULL,
  KEY idx_status_pop (status, popularity DESC),
  KEY idx_created (created_at DESC),
  KEY idx_owner (owner_id)
) ENGINE=InnoDB;

-- 会话(每个用户 × 角色一份档案)
CREATE TABLE archives (
  id                BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  message_count     INT         NOT NULL DEFAULT 0,
  updated_at        BIGINT      NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id),
  CONSTRAINT fk_arch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 消息
CREATE TABLE messages (
  id                BIGINT      AUTO_INCREMENT PRIMARY KEY,
  archive_id        BIGINT      NOT NULL,
  role              ENUM('user','assistant','system') NOT NULL,
  content           MEDIUMTEXT  NOT NULL,
  tokens            INT         NOT NULL DEFAULT 0,
  credits           INT         NOT NULL DEFAULT 0,
  created_at        BIGINT      NOT NULL,
  KEY idx_archive (archive_id, id),
  CONSTRAINT fk_msg_archive FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 额度流水
CREATE TABLE credit_history (
  id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  type       VARCHAR(32) NOT NULL,
  amount     INT         NOT NULL,
  balance    INT         NOT NULL,
  note       VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT      NOT NULL,
  KEY idx_user_time (user_id, id DESC)
) ENGINE=InnoDB;

-- 充值档位
CREATE TABLE recharge_packages (
  id       VARCHAR(32) PRIMARY KEY,
  credits  INT         NOT NULL,
  bonus    INT         NOT NULL DEFAULT 0,
  price    DECIMAL(10,2) NOT NULL,
  tag      VARCHAR(16) NULL,
  popular  TINYINT(1)  NOT NULL DEFAULT 0,
  sort     INT         NOT NULL DEFAULT 0,
  enabled  TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- 订单
CREATE TABLE orders (
  id         VARCHAR(40) PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  package_id VARCHAR(32) NOT NULL,
  credits    INT         NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  status     ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
  created_at BIGINT      NOT NULL,
  paid_at    BIGINT      NULL,
  KEY idx_user (user_id, created_at DESC),
  KEY idx_status (status)
) ENGINE=InnoDB;

-- 兑换码
CREATE TABLE redeem_codes (
  code       VARCHAR(32) PRIMARY KEY,
  credits    INT         NOT NULL,
  total      INT         NOT NULL DEFAULT 1,
  used       INT         NOT NULL DEFAULT 0,
  expires_at BIGINT      NULL,
  created_at BIGINT      NOT NULL
) ENGINE=InnoDB;

-- 兑换记录(防同一用户重复用)
CREATE TABLE redeem_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(32) NOT NULL,
  user_id    VARCHAR(32) NOT NULL,
  credits    INT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_code_user (code, user_id)
) ENGINE=InnoDB;

-- 任务进度
CREATE TABLE user_tasks (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  task_key   VARCHAR(32) NOT NULL,
  done       TINYINT(1) NOT NULL DEFAULT 0,
  claimed    TINYINT(1) NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uk_user_task (user_id, task_key)
) ENGINE=InnoDB;

-- 收藏
CREATE TABLE favorites (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  created_at        BIGINT NOT NULL,
  UNIQUE KEY uk_user_card (user_id, character_card_id)
) ENGINE=InnoDB;

-- 绘图任务
CREATE TABLE image_tasks (
  id         VARCHAR(40) PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  prompt     TEXT NOT NULL,
  engine_id  VARCHAR(32) NOT NULL,
  count      INT NOT NULL DEFAULT 1,
  credits    INT NOT NULL DEFAULT 0,
  status     ENUM('pending','running','succeeded','failed') NOT NULL DEFAULT 'pending',
  result     JSON NULL,
  created_at BIGINT NOT NULL,
  KEY idx_user (user_id, created_at DESC)
) ENGINE=InnoDB;

-- 公告 / 通知
CREATE TABLE announcements (
  id         VARCHAR(32) PRIMARY KEY,
  title      VARCHAR(128) NOT NULL,
  body       TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- 调用日志(便于观察 LLM 用量)
CREATE TABLE llm_logs (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       VARCHAR(32) NOT NULL,
  model         VARCHAR(64) NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  latency_ms    INT NOT NULL DEFAULT 0,
  ok            TINYINT(1) NOT NULL DEFAULT 1,
  error         VARCHAR(255) NULL,
  created_at    BIGINT NOT NULL,
  KEY idx_user (user_id, id DESC)
) ENGINE=InnoDB;
