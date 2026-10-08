/**
 * Client-side workspace encryption. The key is derived from a wallet signature
 * over a fixed message, so the same wallet re-derives it on any device while
 * the server only ever stores ciphertext (spec: no plaintext holdings
 * off-chain except in the user's client).
 */

export const WORKSPACE_KEY_MESSAGE = [
  "Cordon workspace key v1",
  "",
  "Signing derives the key that encrypts your workspace in this browser.",
  "It does not approve a transaction or move assets.",
].join("\n");

const encoder = new TextEncoder();
const SALT = encoder.encode("cordon/workspace/v1");

export interface WorkspaceKey {
  key: CryptoKey;
  /** Lets a device tell a wrong key apart from corrupt data before decrypting. */
  keyCheck: string;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error("Invalid signature.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** Standard base64 of bytes. */
export function toBase64(bytes: Uint8Array): string {
  let raw = "";
  // Chunked so large workspaces don't overflow the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

/** Bytes from standard base64; throws on invalid input. */
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 65-byte secp256k1 signature with `v` normalised to 27/28 (wallets differ). */
function normaliseSignature(signature: string): Uint8Array<ArrayBuffer> {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error("This wallet returned an unsupported signature.");
  if (bytes[64] < 27) bytes[64] += 27;
  return bytes;
}

/** Derives the workspace encryption key and its check value from a wallet signature (HKDF). */
export async function deriveWorkspaceKey(signature: string): Promise<WorkspaceKey> {
  const base = await crypto.subtle.importKey("raw", normaliseSignature(signature), "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  const hkdf = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: SALT,
    info: encoder.encode(info),
  });
  const key = await crypto.subtle.deriveKey(
    hkdf("aes-gcm-256"),
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const keyCheck = toHex(await crypto.subtle.deriveBits(hkdf("key-check"), base, 256));
  return { key, keyCheck };
}

/** Encrypts a JSON value with AES-GCM under a fresh IV. */
export async function encryptJson(key: CryptoKey, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(value));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/** Decrypts and parses a value from encryptJson; throws on a wrong key or tampering. */
export async function decryptJson<T>(
  key: CryptoKey,
  sealed: { ciphertext: string; iv: string },
): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
