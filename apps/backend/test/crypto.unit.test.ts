import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt, isEncrypted, __resetKeyForTest } from "../src/crypto.js";

describe("crypto AES-256-GCM (P1)", () => {
  beforeEach(() => {
    __resetKeyForTest();
    delete process.env.COMBAT_ENCRYPT_KEY;
  });

  it("encrypt/decrypt round-trip — 明文 → 密文 → 明文", () => {
    const plain = "smtp-password-123";
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(decrypt(enc)).toBe(plain);
  });

  it("空串保持空串", () => {
    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });

  it("两次加密同一明文 → 不同密文 (随机 IV)", () => {
    const a = encrypt("samekey");
    const b = encrypt("samekey");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("samekey");
    expect(decrypt(b)).toBe("samekey");
  });

  it("非密文字符串解密回自身 (向后兼容明文)", () => {
    expect(decrypt("plain-old-pw")).toBe("plain-old-pw");
    expect(isEncrypted("plain-old-pw")).toBe(false);
  });

  it("COMBAT_ENCRYPT_KEY env 优先", () => {
    process.env.COMBAT_ENCRYPT_KEY = Buffer.alloc(32, 7).toString("base64");
    __resetKeyForTest();
    const plain = "test";
    const enc = encrypt(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it("COMBAT_ENCRYPT_KEY 长度错误 → 抛错", () => {
    process.env.COMBAT_ENCRYPT_KEY = Buffer.alloc(16, 7).toString("base64");
    __resetKeyForTest();
    expect(() => encrypt("x")).toThrow(/32 字节/);
  });
});
