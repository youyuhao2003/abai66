# 初代版部署说明

这是「无界创镜 AI 酒馆」的初代版本，来自主仓库第一个提交 `2bf634a`。

## 启动

双击 `start.bat`，或：

```bat
cd /d E:\abai\66
set PORT=8899
set DB_PORT=3307
set DB_NAME=abai66
node server.mysql.mjs
```

访问：

- 前台 http://127.0.0.1:8899
- 后台 http://127.0.0.1:8899/admin （令牌 `change-me-please`（在 .env 里改））

## 与主版本的区别

| 项 | 初代版 | 主版本 |
|---|---|---|
| 目录 | `E:\abai\66` | `E:\Ai-Project-Code\abccd++\xiangcao_clone` |
| 端口 | 8899 | 8788 |
| 数据库 | `abai66` | `xingye_ai` |
| 加密参数 | 前端硬编码 | 服务端下发 `/api/crypto-params` |
| 接口参数校验 | 无 | 有 |

两个库完全独立，互不影响。

## 已修复的固有问题

初代版 `2bf634a` 提交里前后端密钥不一致，导致所有接口返回
`{"error":"BadEncryptedPayload","message":"cannot decrypt body"}`。

- 后端 `lib/crypto.mjs` 默认密钥是 `0001...1e1f`
- 前端 `public/app.vue.js` 硬编码是 `c7a1f3e8...0f72`

已把后端默认值改回 `c7a1f3e8...0f72`，与前端对齐。
这个 bug 在主版本的 `eac6b72` 提交里用「服务端下发密钥」彻底解决了。

## 数据

- 57 张表，已导入初始配置（8 个文字模型 + 1 个生图引擎 + 19 项全局参数）
- 已导入一张示例角色卡「借住的第七个月」/ 程听
- 用户 `u990001`（旅行者），余额 2000

## 重新导入角色卡

```bat
set DB_PORT=3307
set DB_NAME=abai66
node seed_roommate.mjs
```

## 停止服务

```powershell
Get-Process node | ForEach-Object {
  $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)"
  if ($ci.CommandLine -like '*server.mysql*' -and $ci.ExecutablePath -like '*dsh-primary-runtime*') {
    (Get-Item "E:\abai\66\_app.log").Directory
  }
}
```

或者直接按端口找：

```powershell
Get-NetTCPConnection -LocalPort 8899 -State Listen | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force
}
```
