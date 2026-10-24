-- 用户系统扩展
USE `wujie_tavern`;

-- 1. users 补字段
ALTER TABLE users
  ADD COLUMN status ENUM('active','banned','deleted') NOT NULL DEFAULT 'active' AFTER photo_url,
  ADD COLUMN ban_reason VARCHAR(255) NULL AFTER status,
  ADD COLUMN banned_at BIGINT NULL AFTER ban_reason,
  ADD COLUMN invite_code VARCHAR(16) NULL AFTER banned_at,
  ADD COLUMN invited_by VARCHAR(32) NULL AFTER invite_code,
  ADD COLUMN last_ip VARCHAR(64) NULL AFTER invited_by,
  ADD COLUMN last_login_at BIGINT NULL AFTER last_ip,
  ADD UNIQUE KEY uk_invite_code (invite_code),
  ADD KEY idx_status (status),
  ADD KEY idx_invited_by (invited_by);

-- 2. 会话(多设备)
CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(40) PRIMARY KEY,
  user_id     VARCHAR(32) NOT NULL,
  api_key     CHAR(64)  NOT NULL,
  device_name VARCHAR(128) NOT NULL DEFAULT '',
  platform    VARCHAR(32)  NOT NULL DEFAULT '',
  user_agent  VARCHAR(512) NOT NULL DEFAULT '',
  ip          VARCHAR(64)  NOT NULL DEFAULT '',
  client_id   VARCHAR(64)  NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL,
  last_seen   BIGINT NOT NULL,
  revoked     TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_user (user_id, last_seen DESC),
  KEY idx_key (api_key)
) ENGINE=InnoDB;

-- 3. 邀请关系
CREATE TABLE IF NOT EXISTS invites (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  inviter_id     VARCHAR(32) NOT NULL,
  invitee_id     VARCHAR(32) NOT NULL,
  code           VARCHAR(16) NOT NULL,
  reward_inviter INT NOT NULL DEFAULT 0,
  reward_invitee INT NOT NULL DEFAULT 0,
  status         ENUM('pending','settled') NOT NULL DEFAULT 'settled',
  created_at     BIGINT NOT NULL,
  UNIQUE KEY uk_invitee (invitee_id),
  KEY idx_inviter (inviter_id)
) ENGINE=InnoDB;

-- 4. 会员订阅
CREATE TABLE IF NOT EXISTS memberships (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(32) NOT NULL,
  plan       VARCHAR(32) NOT NULL,
  price      DECIMAL(10,2) NOT NULL DEFAULT 0,
  days       INT NOT NULL DEFAULT 30,
  started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  status     ENUM('active','expired','refunded') NOT NULL DEFAULT 'active',
  order_id   VARCHAR(40) NULL,
  KEY idx_user (user_id, expires_at DESC)
) ENGINE=InnoDB;

-- 5. 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id   VARCHAR(32) NOT NULL,
  actor_type ENUM('user','admin','system') NOT NULL DEFAULT 'user',
  action     VARCHAR(64) NOT NULL,
  target     VARCHAR(64) NULL,
  detail     JSON NULL,
  ip         VARCHAR(64) NULL,
  created_at BIGINT NOT NULL,
  KEY idx_actor (actor_id, id DESC),
  KEY idx_action (action, id DESC)
) ENGINE=InnoDB;

-- 6. 管理员
CREATE TABLE IF NOT EXISTS admins (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt          VARCHAR(32) NOT NULL,
  role          ENUM('super','operator','viewer') NOT NULL DEFAULT 'operator',
  created_at    BIGINT NOT NULL,
  last_login_at BIGINT NULL,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB;

-- 7. 已撤销的 key
CREATE TABLE IF NOT EXISTS revoked_keys (
  api_key    CHAR(64) PRIMARY KEY,
  revoked_at BIGINT NOT NULL,
  reason     VARCHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB;
