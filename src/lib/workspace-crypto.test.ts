import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  WORKSPACE_KEY_MESSAGE,
  decryptJson,
  deriveWorkspaceKey,
  encryptJson,
  fromBase64,
  toBase64,
} from "./workspace-crypto";

const alice = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // gitleaks:allow (Anvil default account #1)
);
const bob = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // gitleaks:allow (Anvil default account #2)
);

describe("workspace encryption", () => {
  test("the same wallet re-derives the same key", async () => {
    const sig = await alice.signMessage({ message: WORKSPACE_KEY_MESSAGE });
    const a = await deriveWorkspaceKey(sig);
    const b = await deriveWorkspaceKey(await alice.signMessage({ message: WORKSPACE_KEY_MESSAGE }));
    expect(a.keyCheck).toBe(b.keyCheck);
    const sealed = await encryptJson(a.key, { name: "Desk", requests: [] });
    expect(await decryptJson(b.key, sealed)).toEqual({ name: "Desk", requests: [] });
  });

  test("v = 0/1 and v = 27/28 signatures give the same key", async () => {
    const sig = await alice.signMessage({ message: WORKSPACE_KEY_MESSAGE });
    const v = parseInt(sig.slice(-2), 16);
    const lowV = sig.slice(0, -2) + (v - 27).toString(16).padStart(2, "0");
    expect((await deriveWorkspaceKey(lowV)).keyCheck).toBe(
      (await deriveWorkspaceKey(sig)).keyCheck,
    );
  });

  test("another wallet cannot decrypt and has a different key check", async () => {
    const a = await deriveWorkspaceKey(await alice.signMessage({ message: WORKSPACE_KEY_MESSAGE }));
    const b = await deriveWorkspaceKey(await bob.signMessage({ message: WORKSPACE_KEY_MESSAGE }));
    expect(a.keyCheck).not.toBe(b.keyCheck);
    const sealed = await encryptJson(a.key, { secret: 1 });
    await expect(decryptJson(b.key, sealed)).rejects.toThrow();
  });

  test("ciphertext reveals nothing in plaintext and uses fresh IVs", async () => {
    const { key } = await deriveWorkspaceKey(
      await alice.signMessage({ message: WORKSPACE_KEY_MESSAGE }),
    );
    const value = { name: "NVDA bundle", amount: 1234 };
    const one = await encryptJson(key, value);
    const two = await encryptJson(key, value);
    expect(one.iv).not.toBe(two.iv);
    expect(atob(one.ciphertext)).not.toContain("NVDA");
    expect(one.iv).toMatch(/^[A-Za-z0-9+/]{16}$/);
  });

  test("base64 helpers round-trip large payloads", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(200_000));
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  test("rejects malformed signatures", async () => {
    await expect(deriveWorkspaceKey("0x1234")).rejects.toThrow();
  });
});
