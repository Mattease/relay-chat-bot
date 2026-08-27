# Relay Chat Bot

基于 **Cloudflare Workers** 的 Telegram 双向聊天机器人：用户私聊机器人，消息自动进入群组 **Forum 话题**；管理员在话题里回复即可回传用户。无需自建服务器。

## 功能

- **话题隔离**：每位用户独立 Forum Topic，会话互不干扰
- **双向中继**：文本 / 图片 / 视频 / 文件 / 贴纸等均通过 `copyMessage` 原样转发
- **防广告验证**：算术选择题人机验证，可配置有效期与开关
- **权限管理**：封禁 / 解封、关闭会话、重置验证、重建话题
- **频率限制**：默认 45 条/分钟，防刷屏
- **隐藏管理接口**：用自定义 `ADMIN_PATH` 注册 Webhook / 初始化

## 架构

```
用户私聊 Bot  ──webhook──►  Cloudflare Worker + KV
                              │
                              ▼
                    管理群（开启 Topics）
                    ├── General（系统命令）
                    ├── Alice · @alice
                    └── Bob · 123456789
```

状态保存在 Cloudflare KV（用户 ↔ 话题映射、验证、计数）；Bot Token 仅以 Worker Secret 存放。

## 准备

| 项目 | 获取方式 |
| --- | --- |
| Cloudflare 账号 | [dash.cloudflare.com](https://dash.cloudflare.com) |
| Bot Token | [@BotFather](https://t.me/BotFather) → `/newbot` |
| 管理员 User ID | [@userinfobot](https://t.me/userinfobot) |
| 话题群 | 新建群 → 设置开启 **Topics** → 拉入 Bot 并设为管理员 |

Bot 管理员权限至少需要：**Manage Topics**、**Delete Messages**、发送消息。

获取群 ID：把 Bot 拉进群后访问  
`https://api.telegram.org/bot<TOKEN>/getUpdates`  
在 JSON 中找 `"chat":{"id":-100xxxxxxxxxx}`。

## 部署

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV

```bash
npx wrangler kv namespace create KV
npx wrangler kv namespace create KV --preview
```

把返回的 id 填进 `wrangler.toml` 的 `id` / `preview_id`。

### 3. 配置变量

编辑 `wrangler.toml` 中的 `[vars]`：

| 变量 | 说明 |
| --- | --- |
| `SUPERGROUP_ID` | 话题群 ID（`-100…`） |
| `ADMIN_UIDS` | 管理员 TG User ID，多个逗号分隔 |
| `ADMIN_PATH` | 隐藏管理路径（请改成复杂字符串） |
| `VERIFY_ENABLED` | 是否启用人机验证 |
| `VERIFY_TTL_DAYS` | 验证有效天数 |
| `RATE_LIMIT_PER_MIN` | 每分钟消息上限 |
| `WELCOME_MESSAGE` | 欢迎语（支持 HTML） |

设置密钥：

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # 任意长随机串
```

本地开发可复制 `.dev.vars.example` 为 `.dev.vars`。

### 4. 发布

```bash
npm run deploy
```

### 5. 激活

假设 Worker 地址为 `https://relay-chat-bot.<subdomain>.workers.dev`，`ADMIN_PATH=manage_abc123`：

1. 注册 Webhook：  
   `https://relay-chat-bot.<subdomain>.workers.dev/manage_abc123/registerWebhook`
2. 初始化群提示：  
   `https://relay-chat-bot.<subdomain>.workers.dev/manage_abc123/init`

## 使用

### 用户

1. 私聊 Bot，发送 `/start`
2. 完成算术验证（若开启）
3. 正常发消息；回复会出现在对应话题

### 管理员（在用户话题中）

| 命令 | 作用 |
| --- | --- |
| （直接打字 / 发媒体） | 回复给该用户 |
| `/info` | 用户详情 |
| `/block` `/unblock` | 封禁 / 解封 |
| `/close` `/open` | 关闭 / 打开会话 |
| `/reset` | 要求重新验证 |
| `/retopic` | 删除并重建话题 |

### General 话题

| 命令 | 作用 |
| --- | --- |
| `/help` | 帮助 |
| `/stats` | 简易统计 |

## 管理 URL

| 路径 | 作用 |
| --- | --- |
| `/{ADMIN_PATH}/registerWebhook` | 绑定 Webhook |
| `/{ADMIN_PATH}/unRegisterWebhook` | 解除 Webhook |
| `/{ADMIN_PATH}/init` | 向群发送就绪提示 |
| `/{ADMIN_PATH}/me` | 查看 Bot 身份 |
| `/webhook` | Telegram 回调（勿公开调用） |

## 本地开发

```bash
cp .dev.vars.example .dev.vars
# 填入 BOT_TOKEN / WEBHOOK_SECRET，并改好 wrangler.toml
npm run dev
```

可用 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) 或临时隧道把本地端口暴露给 Telegram Webhook。

## 目录结构

```
src/
  index.ts              # Worker 入口 / 路由
  types.ts              # Env 与业务类型
  bot/
    service.ts          # 会话、验证、转发
    handlers.ts         # 私聊 / 群话题 / 回调查询
  telegram/
    api.ts              # Bot API 封装
    types.ts
  storage/
    kv.ts               # KV 存取
  utils/
    format.ts           # 格式化与验证码
```

## 许可

MIT
