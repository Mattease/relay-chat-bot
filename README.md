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

---

## 线上部署指南

整条链路部署在 Cloudflare，**不需要本地常驻进程**。本机只用来执行几次配置 / 发布命令；发布完成后用浏览器打开线上 URL 激活即可。

### 一、准备材料（Telegram）

按顺序做完，后面会用到这些值：

| 材料 | 怎么拿 |
| --- | --- |
| Cloudflare 账号 | [dash.cloudflare.com](https://dash.cloudflare.com) 注册并登录 |
| `BOT_TOKEN` | Telegram 找 [@BotFather](https://t.me/BotFather) → `/newbot` → 复制 Token |
| 管理员 User ID | 找 [@userinfobot](https://t.me/userinfobot) → `/start` → 记下数字 ID |
| 话题群 + 群 ID | 见下方步骤 |

**建话题群：**

1. Telegram 新建群组，把自己和 Bot 都加进去。
2. 群设置 → **Topics / 话题** → 打开。
3. 把 Bot 设为**管理员**，至少勾选：
   - Manage Topics（管理话题）
   - Delete Messages（删除消息）
   - 发送消息相关权限
4. 在群里随便发一条消息，然后浏览器打开（把 `<TOKEN>` 换成你的 Bot Token）：

   ```text
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

5. 在返回的 JSON 里找到 `"chat":{"id":-100xxxxxxxxxx}`，这个就是 `SUPERGROUP_ID`。

> 若 `getUpdates` 为空：确认 Bot 已在群里，再 @ 一下 Bot 或发一条消息后刷新。

**再准备一个随机串**当作 `WEBHOOK_SECRET`（例如密码生成器生成 32 位），以及一个不容易猜到的 `ADMIN_PATH`（例如 `manage_a7f3k9`）。

### 二、本机一次性工具

需要 Node.js 18+。在项目根目录：

```bash
npm install
npx wrangler login
```

浏览器会弹出 Cloudflare 授权页，登录并允许即可。之后部署命令会打到你的账号。

### 三、创建 KV 命名空间

```bash
npx wrangler kv namespace create KV
npx wrangler kv namespace create KV --preview
```

终端会分别输出类似：

```text
{ binding = "KV", id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
{ binding = "KV", preview_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
```

打开 `wrangler.toml`，把两处占位符换成真实 id：

```toml
[[kv_namespaces]]
binding = "KV"
id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
preview_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
```

### 四、填写业务配置

继续编辑 `wrangler.toml` 的 `[vars]`（**不要**把 Bot Token 写进这个文件）：

```toml
[vars]
SUPERGROUP_ID = "-100xxxxxxxxxx"   # 上一步拿到的群 ID
ADMIN_UIDS = "123456789"           # 你的 TG User ID；多人用逗号分隔
ADMIN_PATH = "manage_a7f3k9"       # 改成你自己的隐藏路径
VERIFY_ENABLED = "true"
VERIFY_TTL_DAYS = "30"
RATE_LIMIT_PER_MIN = "45"
WELCOME_MESSAGE = "你好！请发送消息，我们会尽快回复。"
VERIFY_MESSAGE = "为防止广告骚扰，请先完成人机验证："
```

| 变量 | 说明 |
| --- | --- |
| `SUPERGROUP_ID` | 话题群 ID，以 `-100` 开头 |
| `ADMIN_UIDS` | 能在群里回复用户、执行管理命令的人 |
| `ADMIN_PATH` | 激活 / 管理接口的隐藏前缀，务必改掉默认值 |
| `VERIFY_ENABLED` | `true` / `false`，是否启用人机验证 |
| `VERIFY_TTL_DAYS` | 验证通过后多少天内免再验证 |
| `RATE_LIMIT_PER_MIN` | 单用户每分钟消息上限 |
| `WELCOME_MESSAGE` | `/start` 欢迎语，支持 HTML |
| `VERIFY_MESSAGE` | 验证前提示文案 |

### 五、写入 Secrets（敏感信息）

```bash
npx wrangler secret put BOT_TOKEN
# 粘贴 BotFather 给的 Token 后回车

npx wrangler secret put WEBHOOK_SECRET
# 粘贴你准备的随机串后回车
```

这两项只存在 Cloudflare 账号里，不会进 Git。

### 六、发布到 Cloudflare

```bash
npm run deploy
```

成功时终端会打印 Worker 地址，例如：

```text
https://relay-chat-bot.<你的子域>.workers.dev
```

记下这个域名，下一步要用。也可在 Dashboard → **Workers & Pages** → `relay-chat-bot` 查看。

### 七、线上激活（浏览器）

把下面 URL 里的域名和 `ADMIN_PATH` 换成你的，**用浏览器依次打开**：

1. **注册 Webhook**（把 Telegram 回调指到你的 Worker）

   ```text
   https://relay-chat-bot.<你的子域>.workers.dev/manage_a7f3k9/registerWebhook
   ```

   应看到类似：

   ```json
   { "ok": true, "webhook": "https://.../webhook", "bot": "@你的机器人" }
   ```

2. **初始化管理群提示**

   ```text
   https://relay-chat-bot.<你的子域>.workers.dev/manage_a7f3k9/init
   ```

   话题群的 General 话题里应出现「Relay Chat Bot 已就绪」一类消息。

可选自检：

```text
https://relay-chat-bot.<你的子域>.workers.dev/manage_a7f3k9/me
```

### 八、验收

1. 用**非管理员**小号私聊 Bot，发送 `/start`。
2. 若开启了验证，点选算术题正确选项。
3. 发一条文字 / 一张图 → 管理群应自动出现该用户话题，消息在话题内。
4. 管理员在该话题直接回复 → 用户私聊应收到相同内容。
5. 在话题里试一下 `/info`、`/help`（General 话题）。

到这里线上部署完成；本机关掉终端也不影响 Bot 运行。

### 九、更新与回滚

改完代码或配置后重新发布：

```bash
npm run deploy
```

若只改了 `[vars]`，同样 `npm run deploy` 即可生效。  
只改 Secret 时重新 `wrangler secret put ...`，一般无需改代码。

更换 Webhook 或停用：

```text
.../registerWebhook      # 重新绑定
.../unRegisterWebhook    # 解除绑定（Bot 暂停收消息）
```

### 十、常见问题

| 现象 | 排查 |
| --- | --- |
| 打开 `registerWebhook` 提示改 `ADMIN_PATH` | `wrangler.toml` 里还是默认 `manage_change_me`，改掉后重新 `deploy` |
| `registerWebhook` 返回 404 | URL 里的 `ADMIN_PATH` 与线上配置不一致 |
| 群里没有新话题 | 确认群已开 Topics；Bot 是管理员且有 Manage Topics；`SUPERGROUP_ID` 正确 |
| 管理员回复用户收不到 | 确认你的 TG ID 写在 `ADMIN_UIDS` 里；必须在**该用户话题**内回复，不要在 General |
| 用户说「被禁止」 | 话题内执行过 `/block`，用 `/unblock` 解除 |
| `getUpdates` 一直空 | 若已 `registerWebhook`，长轮询会被占用属正常；群 ID 可临时 `unRegisterWebhook` 后再用 `getUpdates`，或看群消息转发到 [@RawDataBot](https://t.me/RawDataBot) |
| `deploy` 登录失败 | 再执行一次 `npx wrangler login` |

### 配置项速查

| 名称 | 类型 | 设置方式 |
| --- | --- | --- |
| `BOT_TOKEN` | Secret | `wrangler secret put` |
| `WEBHOOK_SECRET` | Secret | `wrangler secret put` |
| `SUPERGROUP_ID` 等 | vars | `wrangler.toml` → `deploy` |
| KV | 绑定 | `wrangler.toml` 的 `kv_namespaces` |

---

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

## 本地开发（可选）

仅调试时需要；日常运行不依赖本机。

```bash
cp .dev.vars.example .dev.vars
# 填入 BOT_TOKEN / WEBHOOK_SECRET，并改好 wrangler.toml
npm run dev
```

可用 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) 把本地端口暴露给 Telegram Webhook。

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
