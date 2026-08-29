import type { Env, UserRecord } from "../types";
import type { TgUser } from "../telegram/types";

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

const MEDIA_LABELS: Record<string, string> = {
  photo: "📷 图片",
  video: "🎬 视频",
  document: "📎 文件",
  voice: "🎤 语音",
  audio: "🎵 音频",
  sticker: "🧩 贴纸",
  animation: "🎞 GIF",
  video_note: "📹 视频消息",
};

/** Short label for replied media without text */
export function replyMediaLabel(msg: {
  photo?: unknown;
  video?: unknown;
  document?: unknown;
  voice?: unknown;
  audio?: unknown;
  sticker?: unknown;
  animation?: unknown;
  video_note?: unknown;
}): string | null {
  for (const [key, label] of Object.entries(MEDIA_LABELS)) {
    if (key in msg && (msg as Record<string, unknown>)[key]) return label;
  }
  return null;
}

/** Preview text for a replied message (truncate long text) */
export function replyPreviewText(
  msg: { text?: string; caption?: string } & Parameters<typeof replyMediaLabel>[0],
  maxLen = 120,
): string {
  const text = msg.text ?? msg.caption;
  if (text) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  return replyMediaLabel(msg) ?? "💬 消息";
}

function quoteBlock(preview: string, author?: string | null): string {
  const inner = author
    ? `<b>${escapeHtml(author)}</b>\n${escapeHtml(preview)}`
    : escapeHtml(preview);
  return preview.length > 100
    ? `<blockquote expandable>${inner}</blockquote>`
    : `<blockquote>${inner}</blockquote>`;
}

/** Beautified reply: blockquote + body (HTML) */
export function formatReplyMessage(
  preview: string,
  body: string,
  author?: string | null,
): string {
  return `${quoteBlock(preview, author)}\n\n${escapeHtml(body)}`;
}

/** Beautified reply caption for media */
export function formatReplyCaption(
  preview: string,
  caption: string,
  author?: string | null,
): string {
  return formatReplyMessage(preview, caption, author);
}

/** Quote-only block for media without caption */
export function formatReplyOnly(preview: string, author?: string | null): string {
  return quoteBlock(preview, author);
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
  ].join("\n");
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
