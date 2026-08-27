/** Cloudflare Worker bindings */
export interface Env {
  KV: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  SUPERGROUP_ID: string;
  ADMIN_UIDS: string;
  ADMIN_PATH: string;
  VERIFY_ENABLED: string;
  VERIFY_TTL_DAYS: string;
  RATE_LIMIT_PER_MIN: string;
  WELCOME_MESSAGE: string;
  VERIFY_MESSAGE: string;
}

export interface UserRecord {
  userId: number;
  topicId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: number;
  verified: boolean;
  verifiedAt?: number;
  blocked: boolean;
  closed: boolean;
  messageCount: number;
}

export interface PendingVerify {
  userId: number;
  answer: number;
  createdAt: number;
  attempts: number;
}

export type AdminCommand =
  | "help"
  | "info"
  | "block"
  | "unblock"
  | "close"
  | "open"
  | "reset"
  | "retopic"
  | "stats";
