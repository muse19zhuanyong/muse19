// 飞书相关：验签、token、发消息
// 被 muse19-feishu-webhook / muse19-feishu-scheduler 共同引用

import { enc, timingSafeEqual } from "./utils.ts";

export const FEISHU_API = "https://open.feishu.cn";
const SIG_WINDOW_S = 7 * 3600; // 签名时间戳窗口：覆盖飞书事件重试链

function env(name: string): string {
  return Deno.env.get(name) ?? "";
}

/**
 * 飞书事件签名算法：
 * signature = SHA256( X-Lark-Request-Timestamp + X-Lark-Request-Nonce
 * + EncryptKey + 原始请求体字符串)
 */
export async function verifySignature(
  rawBody: string,
  headers: Headers,
  encryptKey: string,
): Promise<boolean> {
  const timestamp = headers.get("x-lark-request-timestamp") ?? "";
  const nonce = headers.get("x-lark-request-nonce") ?? "";
  const signature = headers.get("x-lark-signature") ?? "";
  if (!timestamp || !nonce || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SIG_WINDOW_S) {
    console.warn(`[feishu] timestamp out of window: ${timestamp}`);
    return false;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(timestamp + nonce + encryptKey + rawBody),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, signature);
}

/** 事件体 AES 解密（仅在飞书控制台开启"事件加密"时才需要；建议保持关闭）。 */
export async function decryptBody(
  encryptB64: string,
  encryptKey: string,
): Promise<string> {
  const raw = Uint8Array.from(atob(encryptB64), (c) => c.charCodeAt(0));
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(encryptKey),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: raw.slice(0, 16) },
    key,
    raw.slice(16),
  );
  // WebCrypto AES-CBC 解密已自动去除 PKCS#7 填充，直接解码即可；
  // 此前手动再 strip 一次会把正常 JSON 截断（导致飞书报“返回数据不是合法的JSON格式”）
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------- 发消息
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getTenantAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.token;
  }
  const res = await fetch(
    `${FEISHU_API}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: env("MUSE19_FEISHU_APP_ID"),
        app_secret: env("MUSE19_FEISHU_APP_SECRET"),
      }),
    },
  );
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(
      `get tenant_access_token failed: ${data.code} ${data.msg}`,
    );
  }
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: now + data.expire * 1000,
  };
  return tokenCache.token;
}

// 机器人自己的 open_id（模块级缓存，冷启动时查一次）。
// 用途：群聊里只响应真正 @ 机器人自己的消息，@ 别人时不理。
let botOpenIdCache: string | null = null;
export async function getBotOpenId(): Promise<string> {
  if (botOpenIdCache) return botOpenIdCache;
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_API}/open-apis/bot/v3/info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0 || !data.bot?.open_id) {
    throw new Error(`get bot info failed: ${data.code} ${data.msg}`);
  }
  botOpenIdCache = data.bot.open_id as string;
  return botOpenIdCache;
}

/** 判断群聊消息的 @ 名单里是否包含机器人自己。 */
export async function isBotMentioned(mentions: any[] | undefined): Promise<boolean> {
  if (!mentions || mentions.length === 0) return false;
  let botOpenId = "";
  try {
    botOpenId = await getBotOpenId();
  } catch (e) {
    console.log(`[feishu] getBotOpenId failed, fallback to any-mention: ${e}`);
    return true; // 查不到身份时沿用旧逻辑，避免正常 @ 被吞
  }
  return mentions.some((m) => {
    const id = m?.id ?? {};
    return id.open_id === botOpenId || id.union_id === botOpenId || id.user_id === botOpenId;
  });
}

export async function feishuPost(path: string, body: unknown): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`feishu ${path} failed: ${data.code} ${data.msg}`);
  }
  console.log(`[feishu] POST ${path} ok`);
}

/** 私聊：直接发到会话；群聊：在原消息下盖楼回复。 */
export async function replyMessage(
  chatType: string,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const t = text.length > 7000 ? text.slice(0, 7000) : text;
  if (chatType === "p2p") {
    await feishuPost("/open-apis/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: t }),
    });
  } else {
    await feishuPost(`/open-apis/im/v1/messages/${messageId}/reply`, {
      msg_type: "text",
      content: JSON.stringify({ text: t }),
    });
  }
}

/** 主动推送：按 chat_id 直接发（私聊/群聊通用，用于 scheduler）。 */
export async function sendTextToChat(
  chatId: string,
  text: string,
): Promise<void> {
  const t = text.length > 7000 ? text.slice(0, 7000) : text;
  await feishuPost("/open-apis/im/v1/messages?receive_id_type=chat_id", {
    receive_id: chatId,
    msg_type: "text",
    content: JSON.stringify({ text: t }),
  });
}

/** 从飞书 text 消息中提取纯文本，并去掉群聊 @机器人 前缀（如 @_user_1）。 */
export function extractText(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson);
    const t = typeof c.text === "string" ? c.text : "";
    return t.replace(/@_user_\d+\s*/g, "").trim();
  } catch {
    return "";
  }
}

// 从 post 富文本消息提取纯文本（含链接 href）
export function extractPostText(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson);
    const post = c.post;
    if (!post) return "";
    const parts: string[] = [];
    for (const lang of Object.keys(post)) {
      const block = post[lang];
      if (block.title) parts.push(block.title);
      const content = block.content as any[][];
      if (Array.isArray(content)) {
        for (const line of content) {
          if (!Array.isArray(line)) continue;
          const lineParts: string[] = [];
          for (const el of line) {
            if (!el || typeof el !== "object") continue;
            if (el.tag === "text" && el.text) lineParts.push(el.text);
            else if (el.tag === "a" && el.href) lineParts.push(el.href);
            else if (el.tag === "at" && el.text) lineParts.push(el.text);
          }
          if (lineParts.length) parts.push(lineParts.join(""));
        }
      }
    }
    return parts.join("\n").replace(/@_user_\d+\s*/g, "").trim();
  } catch {
    return "";
  }
}

// 从 interactive 卡片消息提取文本（user_dsl 中的 markdown 内容）
export function extractInteractiveText(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson);
    const parts: string[] = [];
    if (c.title) parts.push(c.title);
    // user_dsl 是转义的 JSON 字符串，里面有 markdown 内容
    if (typeof c.user_dsl === "string") {
      try {
        const dsl = JSON.parse(c.user_dsl);
        const elements = dsl?.body?.elements as any[];
        if (Array.isArray(elements)) {
          for (const el of elements) {
            if (typeof el.content === "string") {
              // 去掉 font 标签，保留文本
              const text = el.content
                .replace(/<font[^>]*>/g, "")
                .replace(/<\/font>/g, "")
                .replace(/\\n/g, "\n")
                .trim();
              if (text) parts.push(text);
            }
          }
        }
      } catch {
        // user_dsl 解析失败，尝试直接提取
        const m = c.user_dsl.match(/"content":"((?:[^"\\]|\\.)*)"/g);
        if (m) {
          for (const match of m) {
            try {
              const content = JSON.parse(`{${match}}`).content as string;
              const text = content.replace(/<font[^>]*>/g, "").replace(/<\/font>/g, "").replace(/\\n/g, "\n").trim();
              if (text) parts.push(text);
            } catch { /* ignore */ }
          }
        }
      }
    }
    // elements 中的纯文本
    if (Array.isArray(c.elements)) {
      for (const row of c.elements) {
        if (!Array.isArray(row)) continue;
        for (const el of row) {
          if (el?.tag === "text" && el.text && el.text !== "请升级至最新版本客户端，以查看内容") {
            parts.push(el.text);
          }
        }
      }
    }
    return parts.join("\n").trim();
  } catch {
    return "";
  }
}
