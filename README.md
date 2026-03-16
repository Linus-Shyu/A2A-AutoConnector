## A2A-AutoConnector

**A2A-AutoConnector** 是一个 24 小时在线的全自动社交分身，它代表开发者在 Second Me 宇宙中持续搜索「Developer / Rust / Builder」同类 Agent，并自动发起 A2A 对话，帮助主人在闭关写代码时也能持续结识有趣的灵魂。

> Demo: `https://a2a.linusshyu.dev/`

---

## Features

- **Second Me OAuth2 登录**
  - 使用官方授权码模式（`https://go.second.me/oauth/`）。
  - `GET /login` 跳转到 Second Me 授权页。
  - `GET /api/auth/callback` 接收 `code`，调用 `api/oauth/token/code` 换取 Access Token。
  - Token 落盘到 `token.json`，并带有 `expires_at`，支持使用 `refresh_token` 自动刷新。

- **身份映射：分身 / Shade 获取**
  - 通过 Second Me API 获取当前授权用户的信息 / 兴趣标签，识别当前分身。
  - 后续在搜索结果中过滤掉自己，避免自己给自己发 A2A。

- **自主探测：定时搜索同类 Agent**
  - 基于 `node-cron`，默认每 **30 分钟** 执行一次 Worker。
  - 调用搜索接口，按标签 `Developer / Rust / Builder` 找到一批候选 Agent。

- **自主交互：自动发起 A2A 对话**
  - 为每个候选 Agent 执行：
    - 使用 `data/chatted.json` 持久化记录已发起过 A2A 的 `shade_id`，去重。
    - 对未聊过的 Agent 调用 A2A 对话接口：

      > 你好！我的主人是一个热爱技术的开发者，他最近在闭关写代码，特意派我来认识有趣的灵魂。期待与你的 Agent 交流。

    - 成功后把对方 `shade_id` 写入 `chatted.json`，避免重复打扰。

- **实时日志流（SSE）**
  - 后端维护轻量日志缓冲，通过 `GET /events` 暴露为 SSE 流。
  - 前端在主页下方展示「实时日志」窗口，显示：
    - 搜索 / 匹配 / 发起聊天等关键动作。

---

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Server**: Express
- **HTTP Client**: axios
- **Config**: dotenv
- **Scheduler**: node-cron
- **Process Manager**: pm2
- **Tunnel / Domain**: Cloudflare Tunnel → `a2a.linusshyu.dev`

---

## Getting Started (Local Dev)

### 1. Clone & install

```bash
git clone git@github.com:Linus-Shyu/A2A-AutoConnector.git
cd A2A-AutoConnector
npm install
```

### 2. Prepare `.env`

复制 `.env.example` 为 `.env`，并填写你在 Second Me 开发者平台创建应用后拿到的配置：

```env
OAUTH_CLIENT_ID=your_client_id_here
OAUTH_CLIENT_SECRET=your_client_secret_here

OAUTH_AUTH_URL=https://go.second.me/oauth/
OAUTH_TOKEN_URL=https://api.mindverse.com/gate/lab/api/oauth/token/code
OAUTH_REFRESH_URL=https://api.mindverse.com/gate/lab/api/oauth/token/refresh
OAUTH_SCOPE=user.info.shades chat

SECONDME_API_BASE_URL=https://api.mindverse.com/gate/lab

PORT=3000
OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback
CRON_SCHEDULE=*/30 * * * *
```

> 本地开发时，记得在 Second Me 开发者平台里把 Redirect URI 配置成 `http://localhost:3000/api/auth/callback`。

### 3. Run in dev mode

```bash
npm run dev
```

访问：

- `http://localhost:3000/`

点击「激活我的社交分身」完成 OAuth 授权。  
授权成功后，页面会显示「分身已上线」，并在底部实时刷新 Agent 的行动日志。

---

## Production / 24×7 Running (pm2 + Cloudflare Tunnel)

### 1. Build & start with pm2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

### 2. Cloudflare Tunnel（示例）

假设你已经在 Cloudflare 上托管了 `linusshyu.dev`，并创建了名为 `zhihu-a2a` 的 Tunnel：

`~/.cloudflared/config.yml` 示例：

```yaml
tunnel: zhihu-a2a
credentials-file: /Users/<your-user>/.cloudflared/<your-tunnel-id>.json
protocol: http2

ingress:
  - hostname: a2a.linusshyu.dev
    service: http://localhost:3000
  - service: http_status:404
```

启动：

```bash
cloudflared tunnel run zhihu-a2a
```

同时把 `.env` 中的回调地址改为：

```env
OAUTH_REDIRECT_URI=https://a2a.linusshyu.dev/api/auth/callback
```

在 Second Me 开发者后台也同步改为同一个 Redirect URI。  
此时外网访问 `https://a2a.linusshyu.dev/` 即可体验线上 Demo。

---

## Folder Structure

```text
.
├── public/
│   └── index.html        # 深色首页 + 激活按钮 + 实时日志 UI
├── src/
│   ├── auth.ts           # OAuth2 /login + /callback + token 持久化与刷新
│   ├── agent.ts          # 自主探测 + 自主交互（search + A2A）
│   ├── index.ts          # Express 入口，Web + Cron + SSE
│   └── logs.ts           # 轻量日志缓冲 + 事件订阅
├── ecosystem.config.cjs  # pm2 配置
├── Procfile              # Heroku / Zeabur 等兼容
├── package.json
└── tsconfig.json
```

---

## License

MIT

