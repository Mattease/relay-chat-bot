/**
 * Ad / spam filter for private messages relayed to the owner.
 *
 * Design notes (why not a single giant wordlist):
 * - A single common word (e.g. "服务器", "价格") appears in legitimate
 *   messages too, so a lone keyword must NOT auto-block.
 * - The AzurLab Tg-Ad-RegEx approach is used instead: an ad noun
 *   (keyword1) + an action/price word (keyword2) together, or a strong
 *   pattern (bot mention + offer, link + price, energy-rental wording).
 * - Strong patterns and dual+signal patterns auto-block. Dual keywords
 *   alone only flag (handled by the caller relaying with a warning is
 *   NOT done here; this function returns null for them so they pass
 *   through and the admin can one-tap block from the card button).
 * - Sources consulted: AzurLab/Tg-Ad-RegEx dual-keyword rules, and the
 *   actual ad that triggered this feature (energy rental, @GasVipBot,
 *   trongas.vip, TRX per-transaction pricing).
 */

export interface SpamHit {
  /** Human-readable rule name, shown in the admin interception notice. */
  rule: string;
  matched: string;
}

const STRONG_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  // The exact ad class seen in production: energy rental + bot + site.
  { rule: "能量租赁广告", re: /能量租赁|能量闪租|闪租|余[额量]租赁|租能量/ },
  { rule: "能量租赁广告", re: /trongas|gasvip/i },
  // A bot mention combined with an offer/site/price word.
  {
    rule: "机器人推广",
    re: /@\w+bot\b.{0,80}(租赁|优惠|官网|充值|价格|购买|下单|客服|闪兑|能量)/i,
  },
  // Link + price in the same message (typical ad format).
  {
    rule: "链接+价格广告",
    re: /(https?:\/\/|t\.me\/|www\.)\S*.{0,120}(\d+(\.\d+)?\s*(trx|usdt|元|¥|\/笔|每笔))/i,
  },
  // Explicit price-list format: "1笔 / 65K 能量：2.2 TRX".
  { rule: "价格清单广告", re: /\d+\s*笔.{0,40}\d+(\.\d+)?\s*trx/i },
  { rule: "价格清单广告", re: /每[日天].{0,40}\d+(\.\d+)?\s*trx/i },
];

// Ad nouns (keyword1 in Tg-Ad-RegEx terms).
const AD_NOUNS = [
  "租赁", "优惠", "折扣", "推广", "代理", "兼职", "招聘", "招募",
  "博彩", "棋牌", "菠菜", "贷款", "网贷", "套现", "换汇", "跑分",
  "卡商", "洗钱", "代收", "代付", "返利", "赚钱", "高薪", "日结",
  "刷单", "点赞", "增粉", "引流", "高仿", "莆田", "查档", "社工",
  "开房", "定位", "代购", "签名", "独服", "高防", "cdn",
  "usdt", "trx", "能量", "闪兑", "投资", "理财", "包赔", "包赢",
];

// Action / price / contact words (keyword2 in Tg-Ad-RegEx terms).
const ACTION_WORDS = [
  "出售", "卖", "收", "咨询", "点我", "加我", "点头像", "滴滴",
  "加v", "vx", "v信", "私聊", "担保", "现货", "批发", "大量",
  "价格", "元", "充值", "购买", "下单", "联系", "客服", "限时",
  "仅需", "只需", "优惠价", "一手", "二手", "团队", "工作室",
];

const HAS_LINK_OR_BOT = /(https?:\/\/|t\.me\/|www\.|@\w+bot\b)/i;
const HAS_PRICE = /\d+(\.\d+)?\s*(trx|usdt|元|¥|\/笔|每笔)/i;

/** Return the first spam hit, or null if the text passes. */
export function findSpamHit(text: string | undefined | null): SpamHit | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;

  for (const p of STRONG_PATTERNS) {
    const m = t.match(p.re);
    if (m) return { rule: p.rule, matched: m[0].slice(0, 60) };
  }

  const lower = t.toLowerCase();
  const noun = AD_NOUNS.find((w) => lower.includes(w.toLowerCase()));
  if (!noun) return null;
  const action = ACTION_WORDS.find((w) => lower.includes(w.toLowerCase()));
  if (!action) return null;

  // Dual keywords only auto-block when there is also a link/bot/price
  // signal; otherwise a legitimate "服务器价格咨询" style message would
  // be killed. Dual-only messages pass through and can be blocked
  // with one tap from the session card button.
  if (HAS_LINK_OR_BOT.test(t) || HAS_PRICE.test(t)) {
    return { rule: "广告双关键词+链接/价格", matched: `${noun} + ${action}` };
  }
  return null;
}
