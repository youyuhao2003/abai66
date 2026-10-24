-- 第四阶段:聊天页完整交互
USE `wujie_tavern`;

-- 会话:置顶 / 自定义标题
ALTER TABLE archives
  ADD COLUMN title VARCHAR(128) NULL AFTER message_count,
  ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER title,
  ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER pinned;

-- 消息:生成状态 / 指令 / 重生成标记
ALTER TABLE messages
  ADD COLUMN status ENUM('ok','pending','partial','failed','status_only','blocked') NOT NULL DEFAULT 'ok' AFTER role,
  ADD COLUMN directive VARCHAR(32) NULL AFTER status,
  ADD COLUMN directive_text TEXT NULL AFTER directive,
  ADD COLUMN regenerated TINYINT(1) NOT NULL DEFAULT 0 AFTER directive_text,
  ADD COLUMN model_id INT NULL AFTER regenerated;

-- 指令记录(便于统计与回放)
CREATE TABLE IF NOT EXISTS message_directives (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  archive_id BIGINT NOT NULL,
  type ENUM('Continue','Expand','CustomStyleOverride','SceneTransition','PerspectiveSwitch','SettingOverride') NOT NULL,
  text VARCHAR(1000) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  KEY idx_archive (archive_id, id DESC)
) ENGINE=InnoDB;

-- 角色:官方 / 认证 / NSFW 标记(与词条对齐)
ALTER TABLE character_cards
  ADD COLUMN is_official TINYINT(1) NOT NULL DEFAULT 0 AFTER is_nsfw,
  ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER is_official,
  ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0 AFTER is_verified,
  ADD COLUMN ban_reason VARCHAR(255) NULL AFTER is_banned,
  ADD COLUMN is_miniapp TINYINT(1) NOT NULL DEFAULT 0 AFTER ban_reason;
