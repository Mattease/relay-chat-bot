# Relay Chat Bot

基于 **Cloudflare Workers** 的 Telegram 双向聊天机器人：用户私聊机器人，消息自动进入群组 **Forum 话题**；管理员在话题里回复即可回传用户。无需自建服务器，**全程浏览器操作，无需本机安装 Node / Wrangler**。

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

## 线上部署指南（纯浏览器）

整条链路在 **GitHub + Cloudflare Dashboard + 浏览器** 完成，不需要本机终端、不需要 `npm` / `wrangler`。

准备好：一个 [Cloudflare](https://dash.cloudflare.com) 账号、一个 [GitHub](https://github.com) 账号。

### 一、准备材料（Telegram）

| 材料 | 怎么拿 |
| --- | --- |
| `BOT_TOKEN` | Telegram 找 [@BotFather](https://t.me/BotFather) → `/newbot` → 复制 Token |
| 管理员 User ID | 找 [@userinfobot](https://t.me/userinfobot) → `/start` → 记下数字 ID |
| 话题群 + 群 ID | 见下方步骤 |
| `WEBHOOK_SECRET` | 任意密码生成器生成 32 位随机串 |
| `ADMIN_PATH` | 自定义隐藏路径，例如 `manage_a7f3k9`（勿用默认值） |

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

### 二、Fork 本仓库

打开本仓库页面，点击右上角 **Fork**，得到你自己的副本（例如 `https://github.com/<你的用户名>/relay-chat-bot`）。

后续配置都在你 Fork 出的仓库里改，不要改上游仓库。

### 三、创建 KV（Cloudflare Dashboard）

1. 打开 [Workers KV](https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces)。
2. **Create instance / 创建**，名称例如 `relay-chat-bot-kv`。
3. 创建后进入该命名空间，复制 **Namespace ID**（一长串十六进制）。

纯线上部署不需要 preview 命名空间：下一步把同一个 ID 填到 `id` 与 `preview_id` 即可。

### 四、在 GitHub 网页改配置

打开你 Fork 仓库里的 `wrangler.toml` → **Edit**（铅笔图标），按下面改完后 **Commit changes**：

1. **KV ID**（把占位符换成上一步的 Namespace ID）：

   ```toml
   [[kv_namespaces]]
   binding = "KV"
   id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
   preview_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
   ```

2. **`[vars]` 业务配置**（**不要**把 Bot Token 写进这个文件）：

   ```toml
   [vars]
   SUPERGROUP_ID = "-100xxxxxxxxxx"   # 第一步拿到的群 ID
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

> Worker 名称须保持 `name = "relay-chat-bot"`，与 Dashboard 项目名一致，否则 Git 构建会失败。

### 五、用 Cloudflare 连接仓库并发布

1. 打开 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **Create** → **Import a repository**（Workers 标签下）。
2. 授权 GitHub，选中你 Fork 的 `relay-chat-bot`。
3. 配置大致如下后点 **Save and Deploy**：
   - **Project name**：`relay-chat-bot`（须与 `wrangler.toml` 的 `name` 一致）
   - **Production branch**：`master` 或 `main`（与你仓库默认分支一致）
   - **Build command**：留空
   - **Deploy command**：`npx wrangler deploy`（一般默认即可）
4. 等待构建成功。成功后记下 Worker 地址，例如：

   ```text
   https://relay-chat-bot.<你的子域>.workers.dev
   ```

也可在该 Worker 的 Overview / Domains 里查看。

### 六、写入 Secrets（Dashboard）

Token 与 Webhook 密钥不要进 Git，在 Dashboard 里加：

1. 进入 Worker `relay-chat-bot` → **Settings** → **Variables and Secrets**（或 Variables）。
2. 添加两个 **Secret**（Encrypt / Secret 类型）：

   | Name | Value |
   | --- | --- |
   | `BOT_TOKEN` | BotFather 给的 Token |
   | `WEBHOOK_SECRET` | 第一步准备的随机串 |

3. 保存并按提示 **Deploy** / 生效到 Production。

> `[vars]` 也可在同一页用 Plaintext 变量覆盖；若已在 `wrangler.toml` 写好，通常不必再填一遍。

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
5. 在话题里试一下 `/info`、在 General 话题试一下 `/help`。

到这里部署完成；关掉浏览器也不影响 Bot 运行。

### 九、更新与回滚

| 改什么 | 怎么做 |
| --- | --- |
| 代码 | 在 GitHub 网页改文件并 Commit，Cloudflare 会自动重新构建部署 |
| `wrangler.toml` 里的 `[vars]` | 改完 Commit 推送即可；或在 Dashboard → Variables 修改后 Deploy |
| Secrets | Dashboard → Variables and Secrets → 编辑后 Deploy |
| 重新绑定 / 停用 Webhook | 浏览器打开 `.../registerWebhook` 或 `.../unRegisterWebhook` |

回滚：在 Worker → **Deployments** 里选历史版本重新 Deploy。

### 十、常见问题

| 现象 | 排查 |
| --- | --- |
| 打开 `registerWebhook` 提示改 `ADMIN_PATH` | 仍是默认 `manage_change_me`，在 GitHub 改 `wrangler.toml` 后等重新部署，或在 Dashboard Variables 改掉 |
| `registerWebhook` 返回 404 | URL 里的 `ADMIN_PATH` 与线上配置不一致 |
| Git 构建失败：Worker name | Dashboard 项目名必须是 `relay-chat-bot` |
| Git 构建失败：KV id | `wrangler.toml` 里仍是占位符，换成真实 Namespace ID 后重新 Commit |
| 群里没有新话题 | 确认群已开 Topics；Bot 是管理员且有 Manage Topics；`SUPERGROUP_ID` 正确 |
| 管理员回复用户收不到 | 确认你的 TG ID 写在 `ADMIN_UIDS` 里；必须在**该用户话题**内回复，不要在 General |
| 用户说「被禁止」 | 话题内执行过 `/block`，用 `/unblock` 解除 |
| `getUpdates` 一直空 | 若已 `registerWebhook`，长轮询会被占用属正常；群 ID 可临时 `unRegisterWebhook` 后再用 `getUpdates`，或看群消息转发到 [@RawDataBot](https://t.me/RawDataBot) |
| Secret 不生效 | 确认类型是 Secret、已 Deploy 到 Production，名称拼写为 `BOT_TOKEN` / `WEBHOOK_SECRET` |

### 配置项速查

| 名称 | 类型 | 设置方式 |
| --- | --- | --- |
| `BOT_TOKEN` | Secret | Dashboard → Variables and Secrets |
| `WEBHOOK_SECRET` | Secret | Dashboard → Variables and Secrets |
| `SUPERGROUP_ID` 等 | vars | GitHub 改 `wrangler.toml`，或 Dashboard Variables |
| KV | 绑定 | Dashboard 创建命名空间 + `wrangler.toml` 填 ID |

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
