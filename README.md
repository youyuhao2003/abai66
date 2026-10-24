# 无界创镜 AI 酒馆

一个可自托管的 AI 角色扮演对话平台。用户可以创作角色、与角色进行沉浸式对话，平台提供状态栏、剧情分支、长期记忆、角色相册与完整的管理后台。

前端 Vue 3（免构建，浏览器直接运行），后端 Node.js 原生 HTTP + MySQL 8。除 `mysql2` 外无第三方依赖。

---

## 功能概览

### 角色扮演对话

- **角色卡系统** —— 角色描述、性格、场景、外观、开场白、示例对话、历史后指令，字段体系兼容主流角色卡格式
- **状态栏** —— 每次回复后自动生成角色状态（好感度、情绪、场景、亲密度、衣物、秘密、当前需求、关系阶段、内心想法），百分比自动渲染为进度条
- **剧情选项** —— 每轮自动生成 4 条可点选的回复，分「台词」与「动作」两类，点击即发送
- **剧情指令** —— 6 种导演指令：剧情续写、剧情扩写、风格定制、场景转换、视角切换、设定覆盖
- **长期记忆** —— 自动从对话中抽取关键信息，按角色隔离存储，后续对话自动召回
- **世界书** —— 角色专属设定集，按关键词注入上下文
- **流式输出** —— SSE 逐字推送，正文写完后再补状态栏和选项
- **角色相册** —— 支持解锁机制，未解锁时缩略图模糊
- **重新生成** —— 对不满意的回复重新生成

### 社区与运营

- 角色卡详情页：热度、评论、悬赏池、作者主页、关注、打赏
- 排行榜：趋势 / 最新 / 热门 / 点赞
- 用户体系：注册、登录、多设备会话、邀请奖励、会员、签到
- 额度系统：对话按 token 计费，支持充值、兑换码、邀请返利

### 管理后台

`/admin` 提供八个模块：

| 模块 | 能力 |
|---|---|
| 数据看板 | 用户、消息、订单、营收、7 日趋势、人气榜 |
| 文字模型 | 档位增删改、计费、温度、长度、VIP 限定、连通性测试 |
| 生图模型 | 引擎配置、接口地址、密钥、尺寸、价格 |
| 全局参数 | 站点、对话默认值、经济、热度权重、LLM 接入、安全 |
| 用户管理 | 搜索、详情、调整额度、设置会员、封禁、解封、额度流水、设备列表 |
| 角色卡 | 搜索、下架、恢复 |
| 订单 | 订单列表与状态 |
| 操作日志 | 所有后台变更留痕 |

后台修改**即时生效**，无需重启。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3（`vue.global.prod.js`，无构建步骤） |
| 后端 | Node.js 原生 `http` 模块 |
| 数据库 | MySQL 8.0 / utf8mb4，`mysql2` 连接池 |
| 大模型 | 任何 OpenAI 兼容接口（`/v1/chat/completions`） |
| 通信 | HKDF-SHA256 派生密钥 + AES-256-GCM 加密载荷 |
| 流式 | Server-Sent Events |

---

## 目录结构

```
.
├── server.mysql.mjs          # 服务入口（路由、静态资源、鉴权）
├── start.bat                 # Windows 启动脚本（含配置项）
├── .env.example              # 环境变量模板
├── package.json
├── lib/
│   ├── db.mysql.mjs          # 连接池、事务、额度增减
│   ├── crypto.mjs            # 加密载荷
│   ├── config.mjs            # 后台配置热加载
│   ├── llm.mjs               # 大模型调用（支持流式）
│   ├── chat_engine.mjs       # prompt 构建、状态栏解析、选项生成
│   ├── stream_chat.mjs       # SSE 流式对话
│   ├── directives.mjs        # 六种剧情指令
│   ├── engine_actions.mjs    # 对话设置、人格、记忆
│   ├── actions_part1.mjs     # 角色卡、对话、会话
│   ├── actions_part2.mjs     # 生图、支付、任务、社区
│   ├── actions_part3.mjs     # 小游戏、模型设置、偏好
│   ├── actions_registry.mjs  # 动作注册表
│   ├── card_detail.mjs       # 详情页、相册、评论、悬赏
│   ├── admin_api.mjs         # 后台接口
│   ├── popularity.mjs        # 热度算法
│   └── users.mjs             # 用户、会话、邀请、会员
├── public/
│   ├── index.html            # 单页应用（20 个页面模板）
│   ├── app.vue.js            # Vue 3 逻辑
│   ├── style.css             # 主题样式
│   └── admin.html            # 管理后台（单文件）
├── sql/
│   ├── schema_full.sql       # 完整表结构（57 张表，无数据）
│   └── seed_config.sql       # 初始配置（模型档位、全局参数）
├── seed_roommate.mjs         # 示例角色卡导入脚本
├── clean_test_data.mjs       # 测试数据清理（默认干跑）
└── test_*.mjs                # 测试套件
```

---

## 安装部署

### 环境要求

- **Node.js** ≥ 18
- **MySQL** ≥ 8.0
- 一个 OpenAI 兼容的大模型接口（自建或第三方均可）

### 第一步：准备数据库

```bash
mysql -u root -p < sql/schema_full.sql
mysql -u root -p < sql/seed_config.sql
```

第一条建库建表（库名 `wujie_tavern`，57 张表），第二条写入模型档位与初始参数。

### 第二步：安装依赖

```bash
npm install
```

只会安装 `mysql2`。

### 第三步：配置

复制环境变量模板：

```bash
cp .env.example .env
```

填写关键项：

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的密码
DB_NAME=wujie_tavern

# 大模型（必填）
LLM_BASE=https://api.openai.com
LLM_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# 后台令牌（必填，务必修改）
ADMIN_TOKEN=换成一个你自己的强口令
```

Windows 用户也可以直接编辑 `start.bat`，里面的变量会作为环境变量传入。

> 本项目不内置 dotenv。若使用 `.env` 文件，用 `node --env-file=.env server.mysql.mjs` 启动（Node 20.6+），
> 或直接设置系统环境变量，或修改 `start.bat`。

### 第四步：启动

```bash
npm start
# 或
node server.mysql.mjs
```

Windows 双击 `start.bat`。

启动后：

- 前台：<http://127.0.0.1:8788>
- 后台：<http://127.0.0.1:8788/admin>

### 第五步：进入后台配置模型

1. 打开后台，输入 `ADMIN_TOKEN`
2. 进入「全局参数 → LLM 接入」，填入接口地址、密钥、默认模型
3. 进入「文字模型」，把 8 个档位的「底层模型」改成你实际可用的模型名
4. 进入「生图模型」，默认的 `placeholder` 引擎无需配置即可使用

### 第六步（可选）：导入示例角色

```bash
node seed_roommate.mjs
```

会创建一张带完整字段的示例角色卡。

---

## 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8788` | 服务端口 |
| `DB_HOST` | `127.0.0.1` | 数据库地址 |
| `DB_PORT` | `3306` | 数据库端口 |
| `DB_USER` | `root` | 数据库用户 |
| `DB_PASSWORD` | 空 | 数据库密码 |
| `DB_NAME` | `wujie_tavern` | 数据库名 |
| `LLM_BASE` | `https://api.openai.com` | 大模型接口地址 |
| `LLM_KEY` | 空 | 大模型密钥，**必填** |
| `LLM_MODEL` | `gpt-4o-mini` | 默认底层模型 |
| `CRYPTO_IKM` | 内置 | 加密主密钥（64 位十六进制） |
| `CRYPTO_SALT` | 内置 | 加密盐（32 位十六进制） |
| `ADMIN_TOKEN` | `change-me-please` | 后台令牌，**务必修改** |

环境变量与后台配置同时存在时，**后台配置优先**（加密密钥除外）。

### 生成自定义加密密钥

```bash
node -e "import('./lib/crypto.mjs').then(m=>console.log(m.generateKeyPair()))"
```

输出两个值，填入 `CRYPTO_IKM` 和 `CRYPTO_SALT`。

> 更换密钥后，浏览器缓存的旧数据无法解密，用户需重新登录。

### 接入大模型

任何兼容 `POST /v1/chat/completions` 的服务都可以：

```ini
# OpenAI
LLM_BASE=https://api.openai.com
LLM_MODEL=gpt-4o-mini

# DeepSeek
LLM_BASE=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# 本地 Ollama
LLM_BASE=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:14b

# 自建 vLLM / OneAPI / New API
LLM_BASE=http://你的地址:端口
LLM_MODEL=你的模型名
```

修改后可在后台「文字模型」里点「测试」验证连通性。

---

## 生产部署建议

### 使用反向代理

Node 服务本身不处理 HTTPS，建议放在 Nginx 后面：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # SSE 流式必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

**`proxy_buffering off` 必须加**，否则流式输出会变成一次性返回。

### 进程守护

```ini
# /etc/systemd/system/wujie-tavern.service
[Unit]
Description=Wujie Tavern
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/wujie-tavern
EnvironmentFile=/opt/wujie-tavern/.env
ExecStart=/usr/bin/node --env-file=.env server.mysql.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now wujie-tavern
```

### 上线检查清单

- [ ] 修改 `ADMIN_TOKEN`，不要用默认值
- [ ] 生成并配置 `CRYPTO_IKM` / `CRYPTO_SALT`
- [ ] 数据库使用独立账号，不要用 root
- [ ] 配置 HTTPS
- [ ] Nginx 关闭 `proxy_buffering`
- [ ] 定期备份数据库

---

## 数据备份

```bash
# 备份（含数据）
mysqldump -u root -p --single-transaction --default-character-set=utf8mb4 \
  wujie_tavern > backup_$(date +%F).sql

# 恢复
mysql -u root -p wujie_tavern < backup_2025-01-01.sql
```

---

## 测试

```bash
npm test              # 全端点冒烟（190 个接口）
npm run test:admin    # 后台接口（33 项）
npm run test:stream   # 流式输出
```

其他测试文件：

| 文件 | 内容 |
|---|---|
| `test_split.mjs` | 状态栏剥离（17 项） |
| `test_options.mjs` | 剧情选项格式清洗（9 项） |
| `test_directives.mjs` | 六种剧情指令 |
| `test_engine.mjs` | prompt 构建与解析 |
| `test_realstats.mjs` | 统计与热度（23 项） |
| `test_admin_effect.mjs` | 后台配置生效验证（10 项） |
| `test_persist.mjs` | 数据持久化 |
| `test_refresh.mjs` | 浏览器刷新后数据保持 |

### 清理测试数据

```bash
npm run clean            # 干跑，只报告
npm run clean -- --yes   # 实际删除
```

只清理 `u11/u22/u55/u66/u77/u88` 号段，且默认跳过演示账号。**不会碰真实用户数据。**

---

## 常见问题

**Q：启动报「未配置 LLM 密钥」**
A：填 `LLM_KEY` 环境变量，或进后台「全局参数 → LLM 接入」配置。

**Q：对话没有流式输出**
A：如果用了 Nginx，检查是否设置了 `proxy_buffering off`。

**Q：刷新后对话消失了**
A：先确认没有执行过全表 `DELETE`。检查 `archives` 和 `messages` 表是否还有数据。

**Q：状态栏显示成正文**
A：模型输出了非标准格式。系统会剥离状态栏，若仍漏出，可在后台把「默认开启状态栏」关掉，或换一个指令遵循更好的模型。

**Q：生图返回的是渐变图**
A：默认 `placeholder` 引擎不出真实图片。要接真实生图，在后台「生图模型」里新建引擎，把 `provider` 改成 `openai` 或 `custom`，填好接口地址、密钥、模型名。

---

## 许可

仅供学习与自用部署。使用本项目产生的所有内容由部署者自行负责。
