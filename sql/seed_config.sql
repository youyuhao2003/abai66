-- ============================================================
--  无界创镜 AI 酒馆 · 初始化配置
--  在 schema_full.sql 之后执行
--  只包含系统配置与模型档位，不含用户数据
-- ============================================================

USE `abai66`;

-- ---------- 文字模型档位 ----------
INSERT INTO admin_text_models
  (id, name, display_name, backend, provider, credit_per_1k, tier, max_tokens, temperature,
   enabled, vip_only, sort, description, updated_at)
VALUES
  (1,'Lite','基础 Lite','gpt-4o-mini','openai',1,'low',600,0.90,1,0,1,'最便宜的档位',UNIX_TIMESTAMP()*1000),
  (2,'Flash','快速 Flash','gpt-4o-mini','openai',3,'low',800,0.90,1,0,2,'默认，速度快',UNIX_TIMESTAMP()*1000),
  (3,'Ultimate','旗舰 Ultimate','gpt-4o','openai',12,'high',2000,0.90,1,1,3,'旗舰，长文控',UNIX_TIMESTAMP()*1000),
  (4,'Prime','至尊 Prime','gpt-4o','openai',15,'high',2000,0.90,1,1,4,'顶级演绎',UNIX_TIMESTAMP()*1000),
  (5,'Max','均衡 Max','gpt-4o','openai',8,'mid',1500,0.90,1,0,5,'平衡档',UNIX_TIMESTAMP()*1000),
  (6,'Apex','进阶 Apex','gpt-4o','openai',9,'mid',1500,0.90,1,0,6,'平衡档+',UNIX_TIMESTAMP()*1000),
  (7,'Heart','官方 Heart','gpt-4o','openai',12,'high',2000,0.90,1,1,7,'官方角色专属',UNIX_TIMESTAMP()*1000),
  (8,'Spark','畅想 Spark','gpt-4o-mini','openai',7,'mid',1200,0.90,1,1,8,'VIP 专享进阶',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- ---------- 生图引擎 ----------
INSERT INTO admin_image_models
  (id, name, provider, endpoint, api_key, model_name, credit, width, height,
   aspect_ratio, resolution, style_id, steps, cfg_scale, enabled, sort, description, updated_at)
VALUES
  ('placeholder','占位图引擎','placeholder','','','',120,512,768,'PORTRAIT','SD',25,28,7.00,1,1,
   '内置占位图，无需配置即可使用',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---------- 全局参数 ----------
INSERT INTO admin_config (k, v, label, group_name, type, updated_at) VALUES
  ('site.name','无界创镜 AI 酒馆','站点名称','general','string',UNIX_TIMESTAMP()*1000),
  ('site.notice','','顶部公告','general','string',UNIX_TIMESTAMP()*1000),

  ('chat.maxContextTokens','10000','默认上下文长度','chat','int',UNIX_TIMESTAMP()*1000),
  ('chat.maxOutputTokens','800','默认回复长度','chat','int',UNIX_TIMESTAMP()*1000),
  ('chat.statusBarAuto','1','默认开启状态栏','chat','bool',UNIX_TIMESTAMP()*1000),
  ('chat.plotAuto','1','默认开启剧情选项','chat','bool',UNIX_TIMESTAMP()*1000),

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
  ('llm.key','','LLM 密钥（部署后填写）','llm','string',UNIX_TIMESTAMP()*1000),
  ('llm.defaultModel','gpt-4o-mini','默认底层模型','llm','string',UNIX_TIMESTAMP()*1000),

  ('security.adminToken','change-me-please','后台访问令牌（部署后务必修改）','security','string',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE label = VALUES(label);
