import type { Env, UserRecord } from "../types";
import type { ReplyParameters, TgMessage, TgUser } from "../telegram/types";
import { TelegramApi } from "../telegram/api";
import { Store } from "../storage/kv";
import {
  boolEnv,
  displayName,
  escapeHtml,
  intEnv,
  makeCaptcha,
  topicName,
  userCard,
} from "../utils/format";

const GENERAL_TOPIC_ID = 1;

export class BotService {
  readonly api: TelegramApi;
  readonly store: Store;
  readonly groupId: number;
  readonly verifyEnabled: boolean;
  readonly verifyTtlDays: number;
  readonly rateLimit: number;

  constructor(private env: Env) {
    this.api = new TelegramApi(env.BOT_TOKEN);
    this.store = new Store(env.KV);
    this.groupId = Number(env.SUPERGROUP_ID);
    this.verifyEnabled = boolEnv(env.VERIFY_ENABLED, true);
    this.verifyTtlDays = intEnv(env.VERIFY_TTL_DAYS, 30);
    this.rateLimit = intEnv(env.RATE_LIMIT_PER_MIN, 45);
  }

  /** Ensure user has a forum topic; create if missing */
  async ensureSession(from: TgUser): Promise<UserRecord> {
    const existing = await this.store.getUser(from.id);
    if (existing) {
      // refresh profile fields
      existing.username = from.username;
      existing.firstName = from.first_name;
      existing.lastName = from.last_name;
      await this.store.saveUser(existing);
      return existing;
    }

    const topic = await this.api.createForumTopic(this.groupId, topicName(from));
    const user: UserRecord = {
      userId: from.id,
      topicId: topic.message_thread_id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      createdAt: Date.now(),
      verified: !this.verifyEnabled,
      verifiedAt: !this.verifyEnabled ? Date.now() : undefined,
      blocked: false,
      closed: false,
      messageCount: 0,
    };
    await this.store.saveUser(user);
    await this.store.incrStat("users");

    await this.api.sendMessage(
      this.groupId,
      [
        `🆕 <b>新会话</b>`,
        userCard(user),
        ``,
        `回复本话题即可与用户对话。`,
      ].join("\n"),
      { message_thread_id: user.topicId, parse_mode: "HTML" },
    );

    return user;
  }

  isVerificationValid(user: UserRecord): boolean {
    if (!this.verifyEnabled) return true;
    if (!user.verified || !user.verifiedAt) return false;
    const ttlMs = this.verifyTtlDays * 24 * 60 * 60 * 1000;
    return Date.now() - user.verifiedAt < ttlMs;
  }

  async sendVerificationChallenge(userId: number): Promise<void> {
    const { question, answer } = makeCaptcha();
    await this.store.setPendingVerify({
      userId,
      answer,
      createdAt: Date.now(),
      attempts: 0,
    });

    const options = this.shuffleCaptchaOptions(answer);
    await this.api.sendMessage(userId, `${this.env.VERIFY_MESSAGE}\n\n<b>${escapeHtml(question)}</b>`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          options.map((n) => ({
            text: String(n),
            callback_data: `verify:${n}`,
          })),
          [{ text: "🔄 换一题", callback_data: "verify:refresh" }],
        ],
      },
    });
  }

  private shuffleCaptchaOptions(answer: number): number[] {
    const set = new Set<number>([answer]);
    while (set.size < 4) {
      const delta = 1 + Math.floor(Math.random() * 5);
      const candidate = Math.random() < 0.5 ? answer + delta : Math.max(0, answer - delta);
      set.add(candidate);
    }
    return [...set].sort(() => Math.random() - 0.5);
  }

  async markVerified(user: UserRecord): Promise<void> {
    user.verified = true;
    user.verifiedAt = Date.now();
    await this.store.saveUser(user);
    await this.store.clearPendingVerify(user.userId);
  }

  async relayUserToTopic(user: UserRecord, msg: TgMessage): Promise<void> {
    const copied = await this.relayMessage(user, msg, "toTopic");
    await this.store.saveMessageMap(user.userId, msg.message_id, copied.message_id);
    user.messageCount += 1;
    await this.store.saveUser(user);
    await this.store.incrStat("messages_in");
  }

  async relayTopicToUser(user: UserRecord, msg: TgMessage): Promise<void> {
    const copied = await this.relayMessage(user, msg, "toUser");
    await this.store.saveMessageMap(user.userId, copied.message_id, msg.message_id);
    await this.store.incrStat("messages_out");
  }

  private async relayMessage(
    user: UserRecord,
    msg: TgMessage,
    direction: "toTopic" | "toUser",
  ): Promise<{ message_id: number }> {
    const fromSide = direction === "toTopic" ? "private" : "topic";
    const toChatId = direction === "toTopic" ? this.groupId : user.userId;
    const baseOpts =
      direction === "toTopic" ? { message_thread_id: user.topicId } : {};
    const replyCtx = await this.buildReplyContext(user.userId, msg, fromSide);
    const replyParams = replyCtx
      ? this.buildReplyParameters(replyCtx.mappedTargetId)
      : undefined;

    if (replyCtx) {
      console.log("relay reply", direction, {
        preview: replyCtx.preview.slice(0, 40),
        mapped: replyCtx.mappedTargetId,
        replyId: this.getReplyMessageId(msg),
      });
    }

    if (this.isTextOnly(msg)) {
      if (replyCtx) {
        const text = this.formatQuotedBody(replyCtx.preview, msg.text!);
        return this.sendTextRelay(toChatId, text, baseOpts, replyParams);
      }
      return this.api.copyMessage(toChatId, msg.chat.id, msg.message_id, baseOpts);
    }

    const copyOpts: {
      message_thread_id?: number;
      caption?: string;
      reply_parameters?: ReplyParameters;
    } = { ...baseOpts, ...(replyParams ? { reply_parameters: replyParams } : {}) };

    if (replyCtx) {
      copyOpts.caption = msg.caption
        ? this.formatQuotedBody(replyCtx.preview, msg.caption)
        : `↩️ ${replyCtx.preview}`;
    }

    try {
      return await this.api.copyMessage(toChatId, msg.chat.id, msg.message_id, copyOpts);
    } catch (err) {
      if (!replyParams && !replyCtx) throw err;
      console.warn("relay copy failed, retrying without native reply", err);
      const { reply_parameters: _drop, ...withoutReply } = copyOpts;
      return this.api.copyMessage(toChatId, msg.chat.id, msg.message_id, withoutReply);
    }
  }

  private async sendTextRelay(
    toChatId: number,
    text: string,
    baseOpts: { message_thread_id?: number },
    replyParams?: ReplyParameters,
  ): Promise<{ message_id: number }> {
    if (replyParams) {
      try {
        const sent = await this.api.sendMessage(toChatId, text, {
          ...baseOpts,
          reply_parameters: replyParams,
        });
        return { message_id: sent.message_id };
      } catch (err) {
        console.warn("sendMessage with native reply failed, sending visible quote only", err);
      }
    }
    const sent = await this.api.sendMessage(toChatId, text, baseOpts);
    return { message_id: sent.message_id };
  }

  private async buildReplyContext(
    userId: number,
    msg: TgMessage,
    fromSide: "private" | "topic",
  ): Promise<{ preview: string; mappedTargetId: number | null } | null> {
    const source = msg.reply_to_message;
    const external = msg.external_reply;
    const textQuote = msg.quote;

    if (!source && !external && !textQuote) return null;

    const replyId = this.getReplyMessageId(msg);
    const mappedTargetId =
      replyId != null
        ? await this.store.getMappedMessageId(userId, fromSide, replyId)
        : null;

    if (textQuote?.text) {
      const preview =
        textQuote.text.length > 120 ? `${textQuote.text.slice(0, 120)}…` : textQuote.text;
      return { preview, mappedTargetId };
    }

    if (source) {
      return {
        preview: this.replyPreview(source),
        mappedTargetId,
      };
    }

    if (external) {
      return {
        preview: this.replyPreview(external),
        mappedTargetId,
      };
    }

    return null;
  }

  private buildReplyParameters(mappedTargetId: number | null): ReplyParameters | undefined {
    if (mappedTargetId == null) return undefined;
    return { message_id: mappedTargetId };
  }

  /** Plain-text quote prefix — works in all clients, no HTML parsing */
  private formatQuotedBody(preview: string, body: string): string {
    return `↩️ ${preview}\n──────────\n${body}`;
  }

  private replyPreview(msg: Pick<TgMessage, "text" | "caption" | "photo" | "sticker" | "video" | "document" | "voice" | "audio" | "video_note" | "animation">): string {
    if (msg.text) return msg.text.length > 120 ? `${msg.text.slice(0, 120)}…` : msg.text;
    if (msg.caption) return msg.caption.length > 120 ? `${msg.caption.slice(0, 120)}…` : msg.caption;
    if (msg.photo) return "[图片]";
    if (msg.sticker) return "[贴纸]";
    if (msg.video) return "[视频]";
    if (msg.document) return "[文件]";
    if (msg.voice) return "[语音]";
    if (msg.audio) return "[音频]";
    if (msg.video_note) return "[视频消息]";
    if (msg.animation) return "[GIF]";
    return "[消息]";
  }

  private isTextOnly(msg: TgMessage): boolean {
    return (
      !!msg.text &&
      !msg.photo &&
      !msg.video &&
      !msg.document &&
      !msg.audio &&
      !msg.voice &&
      !msg.sticker &&
      !msg.animation &&
      !msg.video_note
    );
  }

  private getReplyMessageId(msg: TgMessage): number | null {
    if (msg.reply_to_message) return msg.reply_to_message.message_id;
    if (msg.external_reply?.message_id != null) return msg.external_reply.message_id;
    return null;
  }

  async recreateTopic(user: UserRecord, from: TgUser): Promise<UserRecord> {
    try {
      await this.api.deleteForumTopic(this.groupId, user.topicId);
    } catch {
      // topic may already be gone
    }
    await this.store.deleteUser(user);

    const topic = await this.api.createForumTopic(this.groupId, topicName(from));
    const next: UserRecord = {
      ...user,
      topicId: topic.message_thread_id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    };
    await this.store.saveUser(next);
    await this.api.sendMessage(
      this.groupId,
      `♻️ 话题已重建\n\n${userCard(next)}`,
      { message_thread_id: next.topicId, parse_mode: "HTML" },
    );
    return next;
  }

  welcomeText(): string {
    return this.env.WELCOME_MESSAGE || "你好！请发送消息，我们会尽快回复。";
  }

  isGeneralTopic(threadId?: number): boolean {
    return threadId == null || threadId === GENERAL_TOPIC_ID;
  }

  formatUserLabel(user: UserRecord): string {
    return `${displayName(user)}${user.username ? ` (@${user.username})` : ""}`;
  }
}
