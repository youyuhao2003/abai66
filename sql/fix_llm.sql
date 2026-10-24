-- ============================================================
--  LLM 配置修正模板
--
--  数据库里的 admin_config 优先级高于环境变量，
--  所以部署后必须把这里改成你自己的服务地址，
--  否则即使环境变量填对了也不会生效。
--
--  执行前把下面的占位地址换成你的真实地址。
-- ============================================================

USE abai66;

-- 你的 LLM 服务地址（OpenAI 兼容 /v1/chat/completions）
UPDATE admin_config SET v = 'https://your-llm-api.example.com' WHERE k = 'llm.base';

-- 默认底层模型名
UPDATE admin_config SET v = 'your-model-name' WHERE k = 'llm.defaultModel';

-- 密钥留空 -> 回落环境变量 LLM_KEY，避免明文落库
UPDATE admin_config SET v = '' WHERE k = 'llm.key';

-- 文字模型档位：backend 要填你的服务实际支持的模型名
UPDATE admin_text_models SET backend = 'your-fast-model' WHERE id IN (1, 2, 8);
UPDATE admin_text_models SET backend = 'your-pro-model'  WHERE id IN (3, 4, 5, 6, 7);

-- 校验
SELECT k, v FROM admin_config WHERE k LIKE 'llm.%';
SELECT id, name, backend, enabled FROM admin_text_models ORDER BY id;