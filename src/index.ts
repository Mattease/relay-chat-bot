import type { Env } from "./types";
import type { TgUpdate } from "./telegram/types";
import { BotService } from "./bot/service";
import {
  handleCallback,
  handleGroupMessage,
  handlePrivateMessage,
} from "./bot/handlers";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error("unhandled", err);
      return json({ ok: false, error: String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const adminBase = `/${env.ADMIN_PATH}`.replace(/\/+/g, "/");

  // Health
  if (request.method === "GET" && path === "/") {
    return json({
      ok: true,
      service: "relay-chat-bot",
      hint: `管理接口前缀: /${env.ADMIN_PATH}/...`,
    });
  }

  // Telegram webhook
  if (request.method === "POST" && path === "/webhook") {
    return handleWebhook(request, env, ctx);
  }

  // Hidden admin endpoints
  if (path.startsWith(adminBase)) {
    const sub = path.slice(adminBase.length).replace(/^\//, "") || "";
    return handleAdmin(request, env, sub);
  }

  return json({ ok: false, error: "not found" }, 404);
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // Acknowledge quickly; process in waitUntil to stay under TG's timeout expectations
  ctx.waitUntil(processUpdate(env, update));
  return json({ ok: true });
}

async function processUpdate(env: Env, update: TgUpdate): Promise<void> {
  const bot = new BotService(env);

  try {
    if (update.callback_query) {
      await handleCallback(env, bot, update.callback_query);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    // Skip forum topic service messages
    if (msg.forum_topic_created || msg.new_chat_members || msg.left_chat_member) return;

    if (msg.chat.type === "private") {
      await handlePrivateMessage(env, bot, msg);
      return;
    }

    if (msg.chat.type === "supergroup" || msg.chat.type === "group") {
      await handleGroupMessage(env, bot, msg);
    }
  } catch (err) {
    console.error("processUpdate", err);
  }
}

async function handleAdmin(request: Request, env: Env, sub: string): Promise<Response> {
  if (!env.ADMIN_PATH || env.ADMIN_PATH === "manage_change_me") {
    return json({ ok: false, error: "请先修改 ADMIN_PATH" }, 400);
  }

  const bot = new BotService(env);
  const origin = new URL(request.url).origin;

  if (sub === "registerWebhook" && request.method === "GET") {
    const webhookUrl = `${origin}/webhook`;
    await bot.api.setWebhook(webhookUrl, env.WEBHOOK_SECRET);
    const me = await bot.api.getMe();
    return json({
      ok: true,
      webhook: webhookUrl,
      bot: me.username ? `@${me.username}` : me.id,
    });
  }

  if (sub === "unRegisterWebhook" && request.method === "GET") {
    await bot.api.deleteWebhook();
    return json({ ok: true, message: "webhook removed" });
  }

  if (sub === "init" && request.method === "GET") {
    // Post help into General topic
    await bot.api.sendMessage(bot.groupId, [
      `🤖 <b>Relay Chat Bot 已就绪</b>`,
      ``,
      `用户私聊机器人 → 自动创建话题`,
      `在话题中直接回复 → 转发回用户`,
      ``,
      `发送 /help 查看管理命令。`,
    ].join("\n"), { parse_mode: "HTML" });

    await bot.store.setMeta("initialized_at", new Date().toISOString());
    return json({ ok: true, groupId: bot.groupId });
  }

  if (sub === "me" && request.method === "GET") {
    const me = await bot.api.getMe();
    return json({ ok: true, me });
  }

  return json({
    ok: false,
    error: "unknown admin action",
    available: ["registerWebhook", "unRegisterWebhook", "init", "me"],
  }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
