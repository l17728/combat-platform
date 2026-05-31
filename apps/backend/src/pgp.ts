/**
 * PGP 签名校验 (v2.4 升级包签名)
 *
 * 升级包约定:
 *   foo-v2.4.0.tar.gz       — 升级包
 *   foo-v2.4.0.tar.gz.asc   — 同名 detached armored 签名(可选)
 *
 * 公钥来源(优先级):
 *   1. env  UPGRADE_PGP_PUBKEY  (整段 armored ASCII)
 *   2. file ~/.config/combat/upgrade-pubkey.asc
 *
 * 校验流程纯函数:不读 env / fs,由 caller 注入 pubkey + signature。
 * 设计意图:加签是可选 + 安全增强,而非强制;允许未签名升级,但 UI 应警告并要求二次确认。
 */
import * as openpgp from "openpgp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface VerifyResult {
  valid: boolean;
  signedBy?: string;
  keyId?: string;
  error?: string;
}

/** 校验 detached signature。pkg/sig/pubkey 都允许 Buffer 或 string. */
export async function verifyDetachedSignature(
  payload: Buffer | Uint8Array | string,
  detachedSigArmored: string,
  pubkeyArmored: string
): Promise<VerifyResult> {
  // 1. parse pubkey
  let publicKey: openpgp.Key;
  try {
    publicKey = await openpgp.readKey({ armoredKey: pubkeyArmored });
  } catch (e) {
    return { valid: false, error: `pubkey 解析失败: ${(e as Error).message}` };
  }
  // 2. parse signature
  let signature: openpgp.Signature;
  try {
    signature = await openpgp.readSignature({ armoredSignature: detachedSigArmored });
  } catch (e) {
    return { valid: false, error: `签名解析失败: ${(e as Error).message}` };
  }
  // 3. craft message + verify
  const data =
    typeof payload === "string"
      ? new TextEncoder().encode(payload)
      : payload instanceof Buffer
        ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        : payload;
  let message: openpgp.Message<Uint8Array>;
  try {
    message = await openpgp.createMessage({ binary: data });
  } catch (e) {
    return { valid: false, error: `payload 加载失败: ${(e as Error).message}` };
  }
  let verification: Awaited<ReturnType<typeof openpgp.verify>>["signatures"];
  try {
    const result = await openpgp.verify({
      message,
      signature,
      verificationKeys: publicKey,
    });
    verification = result.signatures;
  } catch (e) {
    return { valid: false, error: `verify 异常: ${(e as Error).message}` };
  }
  if (!verification || verification.length === 0) {
    return { valid: false, error: "签名中不含可验证条目" };
  }
  // openpgp v6: verification[i].verified 是 Promise<true | throws>
  try {
    await verification[0].verified;
  } catch (e) {
    return { valid: false, error: `签名无效: ${(e as Error).message}` };
  }
  // 提取签名人(取 pubkey 第一个 userID)
  let signedBy = "<unknown>";
  try {
    const userId = publicKey.users[0]?.userID?.userID;
    if (userId) signedBy = userId;
  } catch {}
  let keyId: string | undefined;
  try {
    keyId = verification[0].keyID?.toHex?.() || undefined;
  } catch {}
  return { valid: true, signedBy, keyId };
}

/** 加载 PGP 公钥(env 优先,fallback 用户配置目录)。返回 null = 未配置. */
export function loadConfiguredPubkey(): string | null {
  if (process.env.UPGRADE_PGP_PUBKEY) return process.env.UPGRADE_PGP_PUBKEY;
  const candidates = [
    join(homedir(), ".config", "combat", "upgrade-pubkey.asc"),
    join(process.cwd(), "data", "upgrade-pubkey.asc"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf8");
      } catch {}
    }
  }
  return null;
}
