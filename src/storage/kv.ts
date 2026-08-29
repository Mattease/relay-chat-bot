import type { PendingVerify, UserRecord } from "../types";

const KEY = {
  user: (id: number) => `user:${id}`,
  topic: (topicId: number) => `topic:${topicId}`,
  verify: (id: number) => `verify:${id}`,
  rate: (id: number, minute: number) => `rate:${id}:${minute}`,
  meta: (k: string) => `meta:${k}`,
  blocked: (id: number) => `blocked:${id}`,
  /** private chat message_id → topic message_id */
  msgPrivate: (userId: number, msgId: number) => `msg:${userId}:p:${msgId}`,
  /** topic message_id → private chat message_id */
  msgTopic: (userId: number, msgId: number) => `msg:${userId}:t:${msgId}`,
} as const;

/** How long reply-to mappings are kept (30 days) */
const MSG_MAP_TTL_SECONDS = 30 * 24 * 60 * 60;

export class Store {
  constructor(private kv: KVNamespace) {}

  async getUser(userId: number): Promise<UserRecord | null> {
    const raw = await this.kv.get(KEY.user(userId));
    return raw ? (JSON.parse(raw) as UserRecord) : null;
  }

  async getUserByTopic(topicId: number): Promise<UserRecord | null> {
    const userId = await this.kv.get(KEY.topic(topicId));
    if (!userId) return null;
    return this.getUser(Number(userId));
  }

  async saveUser(user: UserRecord): Promise<void> {
    await Promise.all([
      this.kv.put(KEY.user(user.userId), JSON.stringify(user)),
      this.kv.put(KEY.topic(user.topicId), String(user.userId)),
    ]);
  }

  async deleteUser(user: UserRecord): Promise<void> {
    await Promise.all([
      this.kv.delete(KEY.user(user.userId)),
      this.kv.delete(KEY.topic(user.topicId)),
      this.kv.delete(KEY.verify(user.userId)),
    ]);
  }

  async setPendingVerify(pending: PendingVerify, ttlSeconds = 600): Promise<void> {
    await this.kv.put(KEY.verify(pending.userId), JSON.stringify(pending), {
      expirationTtl: ttlSeconds,
    });
  }

  async getPendingVerify(userId: number): Promise<PendingVerify | null> {
    const raw = await this.kv.get(KEY.verify(userId));
    return raw ? (JSON.parse(raw) as PendingVerify) : null;
  }

  async clearPendingVerify(userId: number): Promise<void> {
    await this.kv.delete(KEY.verify(userId));
  }

  /** Sliding-window-ish rate limit: count messages in current UTC minute */
  async checkRateLimit(userId: number, limit: number): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000);
    const key = KEY.rate(userId, minute);
    const current = Number((await this.kv.get(key)) ?? "0");
    if (current >= limit) return false;
    await this.kv.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
  }

  async getMeta(key: string): Promise<string | null> {
    return this.kv.get(KEY.meta(key));
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.kv.put(KEY.meta(key), value);
  }

  async incrStat(name: string, by = 1): Promise<number> {
    const key = KEY.meta(`stat:${name}`);
    const next = Number((await this.kv.get(key)) ?? "0") + by;
    await this.kv.put(key, String(next));
    return next;
  }

  /** Map a relayed message between the user's private chat and their forum topic */
  async saveMessageMap(
    userId: number,
    privateMsgId: number,
    topicMsgId: number,
  ): Promise<void> {
    const opts = { expirationTtl: MSG_MAP_TTL_SECONDS };
    await Promise.all([
      this.kv.put(KEY.msgPrivate(userId, privateMsgId), String(topicMsgId), opts),
      this.kv.put(KEY.msgTopic(userId, topicMsgId), String(privateMsgId), opts),
    ]);
  }

  /** Resolve reply target in the other chat (private ↔ topic) */
  async getMappedMessageId(
    userId: number,
    side: "private" | "topic",
    messageId: number,
  ): Promise<number | null> {
    const key =
      side === "private"
        ? KEY.msgPrivate(userId, messageId)
        : KEY.msgTopic(userId, messageId);
    const raw = await this.kv.get(key);
    return raw ? Number(raw) : null;
  }
}
