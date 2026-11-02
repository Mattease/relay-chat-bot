import type { Env, UserRecord } from "../types";
import type { InlineKeyboardMarkup, TgUser } from "../telegram/types";

export function parseAdminIds(env: Env): Set<number> {
  return new Set(
    env.ADMIN_UIDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n)),
  );
}

export function isAdmin(env: Env, userId: number): boolean {
  return parseAdminIds(env).has(userId);
}

/** Extract bot command from message text (handles /cmd@BotName) */
export function parseCommand(text: string): string {
  return text.trim().split(/\s+/)[0]?.replace(/@\w+$/, "") ?? "";
}

export function boolEnv(value: string | undefined, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isUserRecord(user: TgUser | UserRecord): user is UserRecord {
  return "userId" in user;
}

export function displayName(user: TgUser | UserRecord): string {
  if (isUserRecord(user)) {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.join(" ") || `User ${user.userId}`;
  }
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.join(" ") || `User ${user.id}`;
}

export function topicName(user: TgUser): string {
  const name = displayName(user);
  const handle = user.username ? `@${user.username}` : String(user.id);
  const raw = `${name} · ${handle}`;
  return raw.length > 128 ? raw.slice(0, 125) + "…" : raw;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function userCard(user: UserRecord): string {
  const uname = user.username ? `@${escapeHtml(user.username)}` : "无";
  const status = [
    user.blocked ? "🚫 已封禁" : null,
    user.closed ? "🔒 已关闭" : null,
    user.verified ? "✅ 已验证" : "⏳ 未验证",
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `<b>用户信息</b>`,
    `ID: <code>${user.userId}</code>`,
    `名称: ${escapeHtml(displayName(user))}`,
    `用户名: ${uname}`,
    `话题 ID: <code>${user.topicId}</code>`,
    `状态: ${status}`,
    `消息数: ${user.messageCount}`,
    `创建: ${new Date(user.createdAt).toISOString()}`,
  ].join("\n");
}

export function adminHelp(): string {
  return [
    `<b>管理员命令</b>（在对应用户话题中使用）`,
    ``,
    `新会话卡片下方有快捷按钮：🚫 封禁 / 🔒 关闭 / ℹ️ 查看信息，点一下就行，不用打字。`,
    `在话题里输入 / 也会自动弹出下面这些命令（仅管理员可见，普通用户看不到）：`,
    ``,
    `/info — 查看用户信息`,
    `/block — 封禁用户`,
    `/unblock — 解除封禁`,
    `/close — 关闭会话（用户无法继续发消息）`,
    `/open — 重新打开会话`,
    `/reset — 重置验证（要求用户重新验证）`,
    `/retopic — 删除并重建话题`,
    ``,
    `<b>系统话题（General）命令</b>`,
    `/help — 显示本帮助`,
    `/stats — 简单统计`,
    ``,
    `<b>广告拦截</b>：命中广告关键词的消息不会转发进话题，直接自动封禁，并在话题里留一条带原文的拦截通知，误判时用 /unblock 或卡片上的解封按钮恢复。`,
  ].join("\n");
}

/** Inline shortcut buttons shown under the new-session card.
 *  Blocked users get only an unblock button, so the card always shows
 *  the action that makes sense for the current state. */
export function adminCardKeyboard(userId: number, blocked: boolean): InlineKeyboardMarkup {
  if (blocked) {
    return {
      inline_keyboard: [
        [{ text: "🔓 解封用户", callback_data: `admin:unblock:${userId}` }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "🚫 封禁用户", callback_data: `admin:block:${userId}` },
        { text: "🔒 关闭会话", callback_data: `admin:close:${userId}` },
      ],
      [{ text: "ℹ️ 查看信息", callback_data: `admin:info:${userId}` }],
    ],
  };
}

/** Admin commands shown only to group administrators (setMyCommands with
 *  a chat_administrators scope). Private users keep an empty menu. */
export function adminCommands(): Array<{ command: string; description: string }> {
  return [
    { command: "info", description: "查看用户信息" },
    { command: "block", description: "封禁用户" },
    { command: "unblock", description: "解除封禁" },
    { command: "close", description: "关闭会话" },
    { command: "open", description: "重新打开会话" },
    { command: "reset", description: "重置验证" },
    { command: "retopic", description: "删除并重建话题" },
    { command: "help", description: "显示管理帮助" },
  ];
}

/** Generate a simple a±b math captcha */
export function makeCaptcha(): { question: string; answer: number } {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const add = Math.random() < 0.5;
  if (add) {
    return { question: `${a} + ${b} = ?`, answer: a + b };
  }
  const x = Math.max(a, b);
  const y = Math.min(a, b);
  return { question: `${x} − ${y} = ?`, answer: x - y };
}
