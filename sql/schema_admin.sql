-- 后台管理:模型配置 + 用户管理 + 运营
USE `wujie_tavern`;

-- 文字模型配置(可增删改,替代硬编码)
CREATE TABLE IF NOT EXISTS admin_text_models (
  id            INT PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  display_name  VARCHAR(64) NOT NULL,
  backend       VARCHAR(64) NOT NULL,
  provider      VARCHAR(64) NOT NULL DEFAULT 'custom',
  credit_per_1k INT NOT NULL DEFAULT 3,
  tier          ENUM('low','mid','high') NOT NULL DEFAULT 'low',
  max_tokens    INT NOT NULL DEFAULT 800,
  temperature   DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  vip_only      TINYINT(1) NOT NULL DEFAULT 0,
  sort          INT NOT NULL DEFAULT 0,
  description   VARCHAR(255) NOT NULL DEFAULT '',
  updated_at    BIGINT NOT NULL
) ENGINE=InnoDB;

-- 生图模型配置
CREATE TABLE IF NOT EXISTS admin_image_models (
  id            VARCHAR(32) PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  provider      VARCHAR(64) NOT NULL DEFAULT 'placeholder',
  endpoint      VARCHAR(512) NOT NULL DEFAULT '',
  api_key       VARCHAR(255) NOT NULL DEFAULT '',
  model_name    VARCHAR(128) NOT NULL DEFAULT '',
  credit        INT NOT NULL DEFAULT 120,
  width         INT NOT NULL DEFAULT 512,
  height        INT NOT NULL DEFAULT 512,
  aspect_ratio  VARCHAR(16) NOT NULL DEFAULT 'PORTRAIT',
  resolution    VARCHAR(8) NOT NULL DEFAULT 'SD',
  style_id      INT NOT NULL DEFAULT 25,
  steps         INT NOT NULL DEFAULT 28,
  cfg_scale     DECIMAL(4,2) NOT NULL DEFAULT 7.00,
  extra_params  JSON NULL,
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  sort          INT NOT NULL DEFAULT 0,
  description   VARCHAR(255) NOT NULL DEFAULT '',
  updated_at    BIGINT NOT NULL
) ENGINE=InnoDB;

-- 全局系统配置(键值)
CREATE TABLE IF NOT EXISTS admin_config (
  k          VARCHAR(64) PRIMARY KEY,
  v          TEXT NULL,
  label      VARCHAR(128) NOT NULL DEFAULT '',
  group_name VARCHAR(32) NOT NULL DEFAULT 'general',
  type       ENUM('string','int','bool','text','json') NOT NULL DEFAULT 'string',
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB;

-- 管理员操作日志
CREATE TABLE IF NOT EXISTS admin_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor      VARCHAR(64) NOT NULL,
  action     VARCHAR(64) NOT NULL,
  target     VARCHAR(128) NULL,
  detail     JSON NULL,
  ip         VARCHAR(64) NULL,
  created_at BIGINT NOT NULL,
  KEY idx_time (created_at DESC)
) ENGINE=InnoDB;

-- 种子:文字模型(对应 MODEL_REGISTRY)
INSERT INTO admin_text_models
  (id, name, display_name, backend, credit_per_1k, tier, max_tokens, enabled, vip_only, sort, description, updated_at)
VALUES
  (1,'Lite','创镜 Lite','deepseek-v4.1-flash',1,'low',600,1,0,1,'最便宜的档位',UNIX_TIMESTAMP()*1000),
  (2,'Flash','创镜 Flash','deepseek-v4.1-flash',3,'low',800,1,0,2,'默认,速度快',UNIX_TIMESTAMP()*1000),
  (3,'Ultimate','无界创镜 Ultimate','deepseek-v4-pro',12,'high',2000,1,1,3,'旗舰,长文控',UNIX_TIMESTAMP()*1000),
  (4,'Prime','无界创镜 Prime','deepseek-v4-pro',15,'high',2000,1,1,4,'顶级演绎',UNIX_TIMESTAMP()*1000),
  (5,'Max','无界创镜 Max','deepseek-v4-pro',8,'mid',1500,1,0,5,'平衡档',UNIX_TIMESTAMP()*1000),
  (6,'Apex','无界创镜 Apex','deepseek-v4-pro',9,'mid',1500,1,0,6,'平衡档+',UNIX_TIMESTAMP()*1000),
  (7,'Heart','无界创镜 Heart','deepseek-v4-pro',12,'high',2000,1,1,7,'官方角色专属',UNIX_TIMESTAMP()*1000),
  (8,'Spark','无界创镜 Spark','deepseek-v4.1-flash',7,'mid',1200,1,1,8,'VIP 专享进阶',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 种子:生图模型
INSERT INTO admin_image_models
  (id, name, provider, endpoint, api_key, model_name, credit, width, height, aspect_ratio, resolution, style_id, steps, cfg_scale, enabled, sort, description, updated_at)
VALUES
  ('art-v3','绘境 v3','placeholder','','','',120,512,768,'PORTRAIT','SD',25,28,7.00,1,1,'当前占位实现(渐变图)',UNIX_TIMESTAMP()*1000),
  ('art-anime','绘境 Anime','placeholder','','','',80,512,768,'PORTRAIT','SD',12,24,6.50,1,2,'二次元风格',UNIX_TIMESTAMP()*1000),
  ('art-ink','绘境 水墨','placeholder','','','',100,512,512,'SQUARE','SD',31,30,7.50,1,3,'国风水墨',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 种子:全局配置
INSERT INTO admin_config (k, v, label, group_name, type, updated_at) VALUES
  ('site.name','无界创镜AI','站点名称','general','string',UNIX_TIMESTAMP()*1000),
  ('site.notice','','顶部公告','general','string',UNIX_TIMESTAMP()*1000),
  ('chat.maxContextTokens','10000','默认上下文长度','chat','int',UNIX_TIMESTAMP()*1000),
  ('chat.maxOutputTokens','400','默认回复长度','chat','int',UNIX_TIMESTAMP()*1000),
  ('chat.statusBarAuto','1','默认开启状态栏','chat','bool',UNIX_TIMESTAMP()*1000),
  ('chat.plotAuto','0','默认开启剧情选项','chat','bool',UNIX_TIMESTAMP()*1000),
  ('economy.signupBonus','2000','注册赠送额度','economy','int',UNIX_TIMESTAMP()*1000),
  ('economy.dailyCheckin','800','每日签到额度','economy','int',UNIX_TIMESTAMP()*1000),
  ('economy.memberBonusRate','66','会员加成(%)','economy','int',UNIX_TIMESTAMP()*1000),
  ('economy.firstRechargeMultiplier','2','首充倍数','economy','int',UNIX_TIMESTAMP()*1000),
  ('popularity.wLike','3','热度权重-点赞','popularity','int',UNIX_TIMESTAMP()*1000),
  ('popularity.wFavorite','8','热度权重-收藏','popularity','int',UNIX_TIMESTAMP()*1000),
  ('popularity.wComment','15','热度权重-评论','popularity','int',UNIX_TIMESTAMP()*1000),
  ('popularity.wChat','2','热度权重-对话','popularity','int',UNIX_TIMESTAMP()*1000),
  ('popularity.wView','0.1','热度权重-浏览','popularity','string',UNIX_TIMESTAMP()*1000),
  ('llm.base','https://api.openai.com','LLM 接口地址','llm','string',UNIX_TIMESTAMP()*1000),
  ('llm.key','','LLM 密钥','llm','string',UNIX_TIMESTAMP()*1000),
  ('llm.defaultModel','gpt-4o-mini','默认底层模型','llm','string',UNIX_TIMESTAMP()*1000),
  ('security.adminToken','change-me-please','后台访问令牌（部署后务必修改）','security','string',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE label=VALUES(label);
