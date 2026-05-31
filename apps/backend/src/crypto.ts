// AES-256-GCM 字段级加密:用于 SMTP 密码等敏感配置。
// Key 来源(优先级):
//   1. process.env.COMBAT_ENCRYPT_KEY (32 字节 base64) — 推荐,部署期注入
//   2. derive 自 JWT_SECRET (PBKDF2-HMAC-SHA256, 100k 轮) — 兼容旧部署,无需新 env
//
// 密文格式:base64( IV(12B) || TAG(16B) || CIPHERTEXT(N) )
// 前缀 "enc:v1:" 用于识别"已加密"以便启动期一次性迁移明文。
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:v1:";

let _key: Buffer | null = null;
function getKey(): Buffer {
  if (_key) return _key;
  const fromEnv = process.env.COMBAT_ENCRYPT_KEY;
  if (fromEnv) {
    const k = Buffer.from(fromEnv, "base64");
    if (k.length !== 32) {
      throw new Error(`COMBAT_ENCRYPT_KEY 必须是 32 字节 base64 (当前 ${k.length} 字节)`);
    }
    _key = k;
    return _key;
  }
  // derive 自 JWT_SECRET (即便默认值也行,启动期 auth.ts 已经强制 prod 配置真实 secret)
  const seed = process.env.JWT_SECRET || "combat-platform-secret-2026";
  _key = pbkdf2Sync(seed, "combat-smtp-v1", 100_000, 32, "sha256");
  return _key;
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encrypt(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(token: string): string {
  if (!token) return token;
  if (!isEncrypted(token)) return token; // 兼容明文(未迁移完成)
  try {
    const raw = Buffer.from(token.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // 解密失败 → 返回空串避免 SMTP 用错误明文当密码继续发送(主因:换 key 后老密文不可读)
    return "";
  }
}

// 仅用于测试:重置 cached key(测试切换 env 时调用)
export function __resetKeyForTest(): void {
  _key = null;
}
