/**
 * Sealed box for DvP legs: ephemeral X25519 -> HKDF-SHA256 -> AES-256-GCM, to the
 * sequencer enclave's public key. Only the enclave can open an order.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(shared: ArrayBuffer, epk: Uint8Array<ArrayBuffer>, usage: KeyUsage) {
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epk, info: enc.encode("cordon-dvp-legs-v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** A fresh X25519 key pair for sealed boxes. */
export async function generateSealKey() {
  const kp = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = b64(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privateKey: kp.privateKey, publicKey };
}

/** A deterministic X25519 key from 32 seed bytes (a wallet's receiving key, or the sequencer's). */
export async function sealKeyFromSeed(seed: Uint8Array) {
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...seed]);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  const { x } = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = x!.replace(/-/g, "+").replace(/_/g, "/") + "=";
  return { privateKey, publicKey };
}

/** Encrypts a JSON value to a raw X25519 public key (base64). */
export async function seal(recipientPublicKey: string, value: unknown): Promise<string> {
  const eph = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const rpk = await crypto.subtle.importKey("raw", unb64(recipientPublicKey), { name: "X25519" }, false, []);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: rpk }, eph.privateKey, 256);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(shared, epk, "encrypt"),
    enc.encode(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v))),
  );
  return [b64(epk), b64(iv), b64(ct)].join(".");
}

/** Opens a sealed box with the recipient's private key; throws if it was not sealed to it. */
export async function open<T>(privateKey: CryptoKey, box: string): Promise<T> {
  const [epkB, ivB, ctB] = box.split(".");
  const epk = unb64(epkB);
  const pub = await crypto.subtle.importKey("raw", epk, { name: "X25519" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub }, privateKey, 256);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB) }, await aesKey(shared, epk, "decrypt"), unb64(ctB));
  return JSON.parse(dec.decode(pt), (_, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
}
