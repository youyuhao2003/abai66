@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ============================================================
rem  启动脚本
rem  真实密钥请写在 .env 文件里，或在系统环境变量中设置
rem  本文件只放非敏感的默认值
rem ============================================================

set PORT=8899

set DB_HOST=127.0.0.1
set DB_PORT=3307
set DB_USER=root
set DB_PASSWORD=
set DB_NAME=abai66

rem ===== 大模型（密钥留空，从 .env 或环境变量读） =====
set LLM_BASE=https://your-llm-api.example.com
set LLM_KEY=
set LLM_MODEL=deepseek-v4.1-flash

rem ===== 后台令牌（部署后务必修改） =====
set ADMIN_TOKEN=change-me-please

rem 若存在 .env，交给 node --env-file 读取（Node 20.6+）
if exist ".env" (
  echo [配置] 检测到 .env，使用文件中的密钥
  node --env-file=.env server.mysql.mjs
) else (
  if "%LLM_KEY%"=="" echo [提示] 未检测到 .env 且 LLM_KEY 为空，模型调用会失败
  node server.mysql.mjs
)

pause
