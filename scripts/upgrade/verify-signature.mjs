#!/usr/bin/env node
/**
 * 独立的升级包签名校验工具(不依赖后端)。
 *
 * 用法:
 *   node scripts/upgrade/verify-signature.mjs <pkg.tar.gz> <pubkey.asc> [--sig <pkg.tar.gz.asc>]
 *
 * 默认从 <pkg>.asc 推断签名路径,可用 --sig 覆盖。
 * 退出码:
 *   0 = 签名有效
 *   1 = 签名无效 / 校验失败
 *   2 = 参数/IO 错误
 */
import { readFileSync, existsSync } from "node:fs";
import * as openpgp from "openpgp";

function usage() {
  console.error("用法: node scripts/upgrade/verify-signature.mjs <pkg.tar.gz> <pubkey.asc> [--sig <pkg.tar.gz.asc>]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { positional: [], opts: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out.opts[k] = v;
        i++;
      } else {
        out.opts[k] = true;
      }
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

async function main() {
  const { positional, opts } = parseArgs(process.argv);
  if (positional.length < 2) usage();
  const [pkgPath, pubkeyPath] = positional;
  const sigPath = opts.sig || `${pkgPath}.asc`;
  for (const p of [pkgPath, pubkeyPath, sigPath]) {
    if (!existsSync(p)) {
      console.error(`文件不存在: ${p}`);
      process.exit(2);
    }
  }
  let pkgBuf, pubkeyArmored, sigArmored;
  try {
    pkgBuf = readFileSync(pkgPath);
    pubkeyArmored = readFileSync(pubkeyPath, "utf8");
    sigArmored = readFileSync(sigPath, "utf8");
  } catch (e) {
    console.error(`读取失败: ${e.message}`);
    process.exit(2);
  }
  let publicKey, signature;
  try {
    publicKey = await openpgp.readKey({ armoredKey: pubkeyArmored });
  } catch (e) {
    console.error(`pubkey 解析失败: ${e.message}`);
    process.exit(1);
  }
  try {
    signature = await openpgp.readSignature({ armoredSignature: sigArmored });
  } catch (e) {
    console.error(`签名解析失败: ${e.message}`);
    process.exit(1);
  }
  const message = await openpgp.createMessage({ binary: new Uint8Array(pkgBuf) });
  let verification;
  try {
    const r = await openpgp.verify({ message, signature, verificationKeys: publicKey });
    verification = r.signatures[0];
    await verification.verified;
  } catch (e) {
    console.error(`签名无效: ${e.message}`);
    process.exit(1);
  }
  const signedBy = publicKey.users[0]?.userID?.userID || "<unknown>";
  let keyId = "<unknown>";
  try {
    keyId = verification.keyID?.toHex?.() || "<unknown>";
  } catch {}
  console.log(JSON.stringify({ ok: true, signedBy, keyId, pkg: pkgPath }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(`未捕获异常: ${e.stack || e.message}`);
  process.exit(2);
});
