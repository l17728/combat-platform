import { describe, it, expect, beforeAll } from "vitest";
import * as openpgp from "openpgp";
import { verifyDetachedSignature } from "../src/pgp.js";

let pubArmored: string;
let privArmored: string;
let payload: Buffer;
let sigArmored: string;
let signerName: string;

beforeAll(async () => {
  signerName = "Combat Release Bot <release@example.com>";
  const k = await openpgp.generateKey({
    userIDs: [{ name: "Combat Release Bot", email: "release@example.com" }],
    type: "ecc",
    curve: "ed25519",
  });
  pubArmored = k.publicKey;
  privArmored = k.privateKey;
  payload = Buffer.from("hello upgrade package contents");
  const privKey = await openpgp.readPrivateKey({ armoredKey: privArmored });
  const message = await openpgp.createMessage({ binary: payload });
  sigArmored = await openpgp.sign({
    message,
    signingKeys: privKey,
    detached: true,
    format: "armored",
  });
});

describe("verifyDetachedSignature", () => {
  it("returns valid=true for a correctly signed payload", async () => {
    const res = await verifyDetachedSignature(payload, sigArmored, pubArmored);
    expect(res.valid).toBe(true);
    expect(res.signedBy).toContain("Combat Release Bot");
    expect(res.error).toBeUndefined();
  });

  it("returns valid=false when payload is tampered", async () => {
    const tampered = Buffer.from("HELLO upgrade package contents"); // differs
    const res = await verifyDetachedSignature(tampered, sigArmored, pubArmored);
    expect(res.valid).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("returns valid=false when signature is malformed", async () => {
    const res = await verifyDetachedSignature(
      payload,
      "-----BEGIN PGP MESSAGE-----\ngarbage\n-----END PGP MESSAGE-----",
      pubArmored
    );
    expect(res.valid).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("returns valid=false when public key is malformed", async () => {
    const res = await verifyDetachedSignature(payload, sigArmored, "not-a-pubkey");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/pubkey|公钥|key/i);
  });

  it("returns valid=false when signature is signed by a different key", async () => {
    const otherKey = await openpgp.generateKey({
      userIDs: [{ name: "Other", email: "other@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });
    const otherPriv = await openpgp.readPrivateKey({ armoredKey: otherKey.privateKey });
    const message = await openpgp.createMessage({ binary: payload });
    const otherSig = await openpgp.sign({
      message,
      signingKeys: otherPriv,
      detached: true,
      format: "armored",
    });
    const res = await verifyDetachedSignature(payload, otherSig, pubArmored);
    expect(res.valid).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
