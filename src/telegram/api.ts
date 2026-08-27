import type {
  InlineKeyboardMarkup,
  ParseMode,
  TgForumTopic,
  TgMessage,
} from "./types";

interface ApiOk<T> {
  ok: true;
  result: T;
}

interface ApiErr {
  ok: false;
  description?: string;
  error_code?: number;
}

export class TelegramApi {
  private readonly base: string;

  constructor(token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as ApiOk<T> | ApiErr;
    if (!data.ok) {
      throw new Error(`Telegram ${method}: ${data.description ?? "unknown error"}`);
    }
    return data.result;
  }

  sendMessage(
    chatId: number | string,
    text: string,
    opts: {
      message_thread_id?: number;
      parse_mode?: ParseMode;
      reply_markup?: InlineKeyboardMarkup;
      disable_web_page_preview?: boolean;
      reply_to_message_id?: number;
    } = {},
  ): Promise<TgMessage> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...opts,
    });
  }

  /** Copy any message type (text/media/sticker…) without "Forwarded from" header */
  copyMessage(
    toChatId: number | string,
    fromChatId: number | string,
    messageId: number,
    opts: {
      message_thread_id?: number;
      caption?: string;
      parse_mode?: ParseMode;
      reply_to_message_id?: number;
    } = {},
  ): Promise<{ message_id: number }> {
    return this.call("copyMessage", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...opts,
    });
  }

  createForumTopic(
    chatId: number | string,
    name: string,
    iconCustomEmojiId?: string,
  ): Promise<TgForumTopic> {
    return this.call("createForumTopic", {
      chat_id: chatId,
      name: name.slice(0, 128),
      ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {}),
    });
  }

  editForumTopic(
    chatId: number | string,
    messageThreadId: number,
    name: string,
  ): Promise<boolean> {
    return this.call("editForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
      name: name.slice(0, 128),
    });
  }

  closeForumTopic(chatId: number | string, messageThreadId: number): Promise<boolean> {
    return this.call("closeForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
  }

  reopenForumTopic(chatId: number | string, messageThreadId: number): Promise<boolean> {
    return this.call("reopenForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
  }

  deleteForumTopic(chatId: number | string, messageThreadId: number): Promise<boolean> {
    return this.call("deleteForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
  }

  answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<boolean> {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: true,
    });
  }

  deleteWebhook(): Promise<boolean> {
    return this.call("deleteWebhook", { drop_pending_updates: true });
  }

  getMe(): Promise<{ id: number; username?: string; first_name: string }> {
    return this.call("getMe");
  }
}
