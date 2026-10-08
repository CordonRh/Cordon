/** Poseidon2 (BN254) through Barretenberg — the same hash the circuits and contracts use. */
import { BarretenbergSync } from "@aztec/bb.js";

export const FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

let bb: BarretenbergSync | undefined;

/** Loads the Poseidon2 WASM once; call before any hash. */
export async function initHasher(): Promise<void> {
  bb ??= await BarretenbergSync.initSingleton();
}

function toBytes(x: bigint): Uint8Array {
  if (x < 0n || x >= FIELD) throw new Error("not a field element");
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function toBigint(b: Uint8Array): bigint {
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x;
}

/** Poseidon2 over BN254, matching the Noir and Solidity implementations. */
export function poseidon2(...inputs: bigint[]): bigint {
  if (!bb) throw new Error("call initHasher() first");
  return toBigint(bb.poseidon2Hash({ inputs: inputs.map(toBytes) }).hash);
}

/** Poseidon2 of one field element. */
export const h1 = (a: bigint) => poseidon2(a);
/** Poseidon2 of two field elements. */
export const h2 = (a: bigint, b: bigint) => poseidon2(a, b);
/** Poseidon2 of three field elements. */
export const h3 = (a: bigint, b: bigint, c: bigint) => poseidon2(a, b, c);

/** Uniform random field element (spending keys, blindings). */
export function randomField(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return toBigint(b) % FIELD;
}
