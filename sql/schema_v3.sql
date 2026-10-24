-- 第三阶段:对齐原站真实的角色卡字段与用户设置
USE `wujie_tavern`;

-- ========== 角色卡补全 SillyTavern 兼容字段 ==========
ALTER TABLE character_cards
  ADD COLUMN personality TEXT NULL AFTER creator_notes,
  ADD COLUMN scenario TEXT NULL AFTER personality,
  ADD COLUMN appearance TEXT NULL AFTER scenario,
  ADD COLUMN first_message TEXT NULL AFTER appearance,
  ADD COLUMN first_message_image VARCHAR(1024) NULL AFTER first_message,
  ADD COLUMN preset_status_block TEXT NULL AFTER first_message_image,
  ADD COLUMN preset_options JSON NULL AFTER preset_status_block,
  ADD COLUMN example_dialogue MEDIUMTEXT NULL AFTER preset_options,
  ADD COLUMN post_history_instructions TEXT NULL AFTER example_dialogue,
  ADD COLUMN alternate_greetings JSON NULL AFTER post_history_instructions,
  ADD COLUMN system_prompt_raw MEDIUMTEXT NULL AFTER alternate_greetings,
  ADD COLUMN character_book_id VARCHAR(32) NULL AFTER system_prompt_raw,
  ADD COLUMN edit_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER character_book_id;

-- ========== 用户文本模型设置 ==========
CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR(32) PRIMARY KEY,
  -- 模型与记忆
  model_id INT NOT NULL DEFAULT 2,
  max_context_tokens INT NOT NULL DEFAULT 10000,
  max_output_tokens INT NOT NULL DEFAULT 400,
  max_character_tokens INT NOT NULL DEFAULT 3000,
  script_max_output_tokens INT NOT NULL DEFAULT 500,
  output_language_code VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  content_format ENUM('roleplay','novel','script') NOT NULL DEFAULT 'roleplay',
  knowledge_enabled TINYINT(1) NOT NULL DEFAULT 0,
  -- 状态栏
  status_bar_auto TINYINT(1) NOT NULL DEFAULT 1,
  status_bar_max_tokens INT NOT NULL DEFAULT 300,
  -- 剧情选项
  plot_auto TINYINT(1) NOT NULL DEFAULT 0,
  plot_options_count INT NOT NULL DEFAULT 4,
  -- 图片
  image_auto_generate TINYINT(1) NOT NULL DEFAULT 0,
  image_auto_background TINYINT(1) NOT NULL DEFAULT 0,
  image_character_weight DECIMAL(3,2) NOT NULL DEFAULT 0.60,
  image_aspect_ratio VARCHAR(16) NOT NULL DEFAULT 'PORTRAIT',
  image_resolution VARCHAR(8) NOT NULL DEFAULT 'SD',
  image_style_id INT NOT NULL DEFAULT 25,
  -- 人设
  active_persona_id BIGINT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB;

-- ========== 我的人设 ==========
CREATE TABLE IF NOT EXISTS personas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_user (user_id, id DESC)
) ENGINE=InnoDB;

-- ========== 长期记忆 ==========
CREATE TABLE IF NOT EXISTS knowledge_memories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  character_card_id VARCHAR(32) NOT NULL,
  archive_id BIGINT NULL,
  kind ENUM('plot','character','relation','item','other') NOT NULL DEFAULT 'plot',
  content TEXT NOT NULL,
  source_message_id BIGINT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_user_card (user_id, character_card_id, id DESC)
) ENGINE=InnoDB;

-- ========== 消息补状态栏/选项/配图 ==========
ALTER TABLE messages
  ADD COLUMN status_bar TEXT NULL AFTER content,
  ADD COLUMN plot_options JSON NULL AFTER status_bar,
  ADD COLUMN image_url VARCHAR(1024) NULL AFTER plot_options,
  ADD COLUMN meta JSON NULL AFTER image_url;
