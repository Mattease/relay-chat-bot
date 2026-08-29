import type { Env } from "../types";
import type { TgCallbackQuery, TgMessage } from "../telegram/types";
import { BotService } from "./service";
import { isAdmin, adminHelp, userCard, escapeHtml, parseCommand } from "../utils/format";

export async function handlePrivateMessage(
  env: Env,
  bot: BotService,
  msg: TgMessage,
): Promise<void> {
  const from = msg.from;
  if (!from || from.is_bot) return;

  const text = (msg.text ?? "").trim();

  // /start
  if (text === "/start" || text.startsWith("/start ")) {
    const user = await bot.ensureSession(from);

    if (user.blocked) {
      await bot.api.sendMessage(from.id, "你已被禁止使用本服务。");
      return;
    }

    if (!bot.isVerificationValid(user)) {
      await bot.api.sendMessage(from.id, bot.welcomeText(), { parse_mode: "HTML" });
      await bot.sendVerificationChallenge(from.id);
      return;
    }

    await bot.api.sendMessage(from.id, bot.welcomeText(), { parse_mode: "HTML" });
    return;
  }

  const user = await bot.ensureSession(from);

  if (user.blocked) {
    await bot.api.sendMessage(from.id, "你已被禁止使用本服务。");
    return;
  }

  if (user.closed) {
    await bot.api.sendMessage(from.id, "当前会话已关闭，请稍后再试或联系管理员。");
    return;
  }

  if (!bot.isVerificationValid(user)) {
    const pending = await bot.store.getPendingVerify(from.id);
    if (!pending) {
      await bot.sendVerificationChallenge(from.id);
    } else {
      await bot.api.sendMessage(from.id, "请先完成上方的人机验证，再发送消息。");
    }
    return;
  }

  const ok = await bot.store.checkRateLimit(from.id, bot.rateLimit);
  if (!ok) {
    await bot.api.sendMessage(from.id, `发送过于频繁，请稍后再试（上限 ${bot.rateLimit} 条/分钟）。`);
    return;
  }

  try {
    await bot.relayUserToTopic(user, msg);
  } catch (err) {
    console.error("relay user→topic failed", err);
    await bot.api.sendMessage(from.id, "消息转发失败，请稍后重试。");
  }
}

export async function handleGroupMessage(
  env: Env,
  bot: BotService,
  msg: TgMessage,
): Promise<void> {
  if (msg.chat.id !== bot.groupId) return;
  const from = msg.from;
  if (!from || from.is_bot) return;

  // Only admins can operate from the group
  if (!isAdmin(env, from.id)) return;

  const threadId = msg.message_thread_id;
  const text = (msg.text ?? "").trim();
  const command = parseCommand(text);

  // System / General topic commands
  if (bot.isGeneralTopic(threadId)) {
    if (command === "/help" || command === "/start") {
      await bot.api.sendMessage(bot.groupId, adminHelp(), {
        message_thread_id: threadId,
        parse_mode: "HTML",
      });
      return;
    }
    if (command === "/stats") {
      const users = (await bot.store.getMeta("stat:users")) ?? "0";
      const inn = (await bot.store.getMeta("stat:messages_in")) ?? "0";
      const out = (await bot.store.getMeta("stat:messages_out")) ?? "0";
      await bot.api.sendMessage(
        bot.groupId,
        `<b>统计</b>\n用户数: ${users}\n用户→管理: ${inn}\n管理→用户: ${out}`,
        { message_thread_id: threadId, parse_mode: "HTML" },
      );
      return;
    }
    return;
  }

  if (!threadId) return;

  const user = await bot.store.getUserByTopic(threadId);
  if (!user) {
    if (command.startsWith("/")) {
      await bot.api.sendMessage(bot.groupId, "未找到与该话题关联的用户。", {
        message_thread_id: threadId,
      });
    }
    return;
  }

  // Topic admin commands
  if (command === "/info") {
    await bot.api.sendMessage(bot.groupId, userCard(user), {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
    return;
  }

  if (command === "/block") {
    user.blocked = true;
    await bot.store.saveUser(user);
    await bot.api.sendMessage(bot.groupId, `已封禁用户 ${escapeHtml(bot.formatUserLabel(user))}`, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
    try {
      await bot.api.sendMessage(user.userId, "你已被禁止使用本服务。");
    } catch { /* user may have blocked bot */ }
    return;
  }

  if (command === "/unblock") {
    user.blocked = false;
    await bot.store.saveUser(user);
    await bot.api.sendMessage(bot.groupId, `已解封用户 ${escapeHtml(bot.formatUserLabel(user))}`, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
    return;
  }

  if (command === "/close") {
    user.closed = true;
    await bot.store.saveUser(user);
    try {
      await bot.api.closeForumTopic(bot.groupId, threadId);
    } catch { /* ignore */ }
    await bot.api.sendMessage(bot.groupId, "会话已关闭。", { message_thread_id: threadId });
    return;
  }

  if (command === "/open") {
    user.closed = false;
    await bot.store.saveUser(user);
    try {
      await bot.api.reopenForumTopic(bot.groupId, threadId);
    } catch { /* ignore */ }
    await bot.api.sendMessage(bot.groupId, "会话已重新打开。", { message_thread_id: threadId });
    return;
  }

  if (command === "/reset") {
    user.verified = false;
    user.verifiedAt = undefined;
    await bot.store.saveUser(user);
    await bot.api.sendMessage(bot.groupId, "已重置验证，用户下次发消息需重新验证。", {
      message_thread_id: threadId,
    });
    try {
      await bot.sendVerificationChallenge(user.userId);
    } catch { /* ignore */ }
    return;
  }

  if (command === "/retopic") {
    const fakeFrom = {
      id: user.userId,
      is_bot: false,
      first_name: user.firstName ?? "User",
      last_name: user.lastName,
      username: user.username,
    };
    await bot.recreateTopic(user, fakeFrom);
    return;
  }

  if (command === "/help") {
    await bot.api.sendMessage(bot.groupId, adminHelp(), {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
    return;
  }

  // Ignore other slash commands; relay normal replies
  if (command.startsWith("/")) return;

  // Don't relay service notices we ourselves might echo — only admin content
  try {
    await bot.relayTopicToUser(user, msg);
  } catch (err) {
    console.error("relay topic→user failed", err);
    await bot.api.sendMessage(
      bot.groupId,
      `⚠️ 转发失败：用户可能已停用机器人。\n<code>${escapeHtml(String(err))}</code>`,
      { message_thread_id: threadId, parse_mode: "HTML" },
    );
  }
}

export async function handleCallback(
  env: Env,
  bot: BotService,
  cq: TgCallbackQuery,
): Promise<void> {
  const data = cq.data ?? "";
  const from = cq.from;

  if (!data.startsWith("verify:")) {
    await bot.api.answerCallbackQuery(cq.id);
    return;
  }

  const action = data.slice("verify:".length);

  if (action === "refresh") {
    await bot.api.answerCallbackQuery(cq.id, "已换题");
    await bot.sendVerificationChallenge(from.id);
    return;
  }

  const pending = await bot.store.getPendingVerify(from.id);
  if (!pending) {
    await bot.api.answerCallbackQuery(cq.id, "验证已过期，请重新开始", true);
    await bot.sendVerificationChallenge(from.id);
    return;
  }

  const chosen = Number(action);
  if (Number.isNaN(chosen) || chosen !== pending.answer) {
    pending.attempts += 1;
    await bot.store.setPendingVerify(pending);
    if (pending.attempts >= 5) {
      await bot.store.clearPendingVerify(from.id);
      await bot.api.answerCallbackQuery(cq.id, "错误次数过多，请重新验证", true);
      await bot.sendVerificationChallenge(from.id);
      return;
    }
    await bot.api.answerCallbackQuery(cq.id, "答错了，再试一次", true);
    return;
  }

  const user = await bot.ensureSession(from);
  await bot.markVerified(user);
  await bot.api.answerCallbackQuery(cq.id, "验证成功！");
  await bot.api.sendMessage(
    from.id,
    "✅ 验证通过，现在可以发送消息了。\n\n" + bot.welcomeText(),
    { parse_mode: "HTML" },
  );

  try {
    await bot.api.sendMessage(
      bot.groupId,
      `✅ 用户 ${escapeHtml(bot.formatUserLabel(user))} 已通过验证`,
      { message_thread_id: user.topicId, parse_mode: "HTML" },
    );
  } catch { /* ignore */ }
}
