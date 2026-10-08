/**
 * Order matching and trade building for sealed DvP batches (spec §3.4, §4).
 * Pure: prices and the note tree are passed in, so it runs the same in the enclave
 * and in tests. Orders carry their traders' order proofs, never spending keys.
 */
import { classHash, DVP_GIVES, dvpInputs, orderHash, type DvpLeg, type DvpPrice, type OrderAuth, type OrderGive, type OrderTerms } from "./builders";
import { KIND } from "./note";
import type { NoteTree } from "./tree";

export type Give = OrderGive;
export type Order = OrderTerms & { auth: OrderAuth };
export type Trade = { a: Order; b: Order; legs: [DvpLeg[], DvpLeg[]] };

/** Value per raw unit for a (asset, kind); undefined when it cannot be priced now. */
export type PriceSource = (asset: bigint, kind: bigint, quote27?: bigint) => bigint | undefined;

const key = (asset: bigint, kind: bigint) => `${asset}:${kind}`;

/** Underlying legs are priced by the oracle; everything else carries a quote. */
export const needsOracle = (kind: bigint) => kind === KIND.UNDERLYING;

const isBig = (x: unknown): x is bigint => typeof x === "bigint" && x >= 0n;
const NOTE_FIELDS = ["asset", "raw", "kind", "bundleId", "jBundle", "termFrom", "termUntil", "accruedTo", "lock", "ownerPk", "blinding"] as const;

/** Shape check for a decrypted order: anything malformed is closed before it can throw later. */
export function wellFormed(o: unknown): o is Order {
  const x = o as Order;
  return (
    !!x &&
    Array.isArray(x.gives) &&
    x.gives.length >= 1 &&
    x.gives.length <= DVP_GIVES &&
    x.gives.every(
      (g) =>
        !!g &&
        !!g.note &&
        NOTE_FIELDS.every((k) => isBig(g.note[k])) &&
        isBig(g.amount) &&
        g.amount > 0n &&
        g.amount <= g.note.raw &&
        (g.quote27 === undefined || isBig(g.quote27)),
    ) &&
    !!x.wants &&
    isBig(x.wants.asset) &&
    isBig(x.wants.kind) &&
    (x.wants.quote27 === undefined || isBig(x.wants.quote27)) &&
    (x.wants.classHash === undefined || isBig(x.wants.classHash)) &&
    isBig(x.wantMin) &&
    isBig(x.receivePk) &&
    isBig(x.salt) &&
    Number.isSafeInteger(x.expiresAt) &&
    !!x.auth &&
    typeof x.auth.proof === "string" &&
    /^0x[0-9a-f]+$/i.test(x.auth.proof) &&
    isBig(x.auth.orderHash) &&
    Array.isArray(x.auth.nullifiers) &&
    x.auth.nullifiers.length === DVP_GIVES &&
    x.auth.nullifiers.every(isBig)
  );
}

/** An order whose proof covers exactly these terms: anything else would be excluded on-chain. */
export const authorised = (o: Order) => o.auth.orderHash === orderHash(o);

function value(o: Order, price: PriceSource) {
  let v = 0n;
  for (const g of o.gives) {
    const p = price(g.note.asset, g.note.kind, g.quote27);
    if (p === undefined) return undefined;
    v += g.amount * p;
  }
  return v;
}

/** Every give is what the other side wants; claims also at the quote it agreed to. */
const fits = (o: Order, other: Order) =>
  o.gives.length > 0 &&
  o.gives.length <= DVP_GIVES &&
  o.gives.every(
    (g) =>
      g.note.asset === other.wants.asset &&
      g.note.kind === other.wants.kind &&
      (needsOracle(g.note.kind) ||
        (g.quote27 !== undefined && g.quote27 === other.wants.quote27 && classHash(g.note) === (other.wants.classHash ?? 0n))),
  ) &&
  o.gives.reduce((sum, g) => sum + g.amount, 0n) >= other.wantMin;

/** Two orders match when each gives what the other wants and the values net within tolerance. */
export function matches(a: Order, b: Order, price: PriceSource, toleranceBps: bigint) {
  if (!fits(a, b) || !fits(b, a)) return false;
  const va = value(a, price);
  const vb = value(b, price);
  if (va === undefined || vb === undefined) return false;
  const [hi, lo] = va > vb ? [va, vb] : [vb, va];
  return (hi - lo) * 10_000n <= toleranceBps * hi;
}

/**
 * Greedy pairing into one batch. All trades share one price table (the settler
 * pins a single table per batch), so a pair that would push it past 16 entries
 * carries to the next batch, as do unmatched orders.
 */
export function pair(orders: Order[], price: PriceSource, toleranceBps: bigint) {
  const prices: DvpPrice[] = [];
  const idx = new Map<string, number>();
  const trades: Trade[] = [];
  const used = new Set<number>();
  for (let i = 0; i < orders.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < orders.length; j++) {
      if (used.has(j) || !matches(orders[i], orders[j], price, toleranceBps)) continue;
      const fresh = new Set(
        [...orders[i].gives, ...orders[j].gives].map((g) => key(g.note.asset, g.note.kind)).filter((k) => !idx.has(k)),
      );
      if (prices.length + fresh.size > 16) continue;
      used.add(i).add(j);
      trades.push(build(orders[i], orders[j], price, prices, idx));
      break;
    }
  }
  return { trades, prices, rest: orders.filter((_, i) => !used.has(i)) };
}

function build(a: Order, b: Order, price: PriceSource, prices: DvpPrice[], idx: Map<string, number>): Trade {
  const legs = (o: Order) =>
    o.gives.map((g) => {
      const k = key(g.note.asset, g.note.kind);
      if (!idx.has(k)) {
        idx.set(k, prices.length);
        prices.push({ asset: g.note.asset, kind: g.note.kind, price: price(g.note.asset, g.note.kind, g.quote27)! });
      }
      return { priceIdx: idx.get(k)! };
    });
  return { a, b, legs: [legs(a), legs(b)] };
}

/** Inputs for the dvp circuit from a paired trade and the batch price table. */
export const tradeInputs = (t: Trade, prices: DvpPrice[], tree: NoteTree, now: bigint, toleranceBps: bigint) =>
  dvpInputs({ tree, now, toleranceBps, prices, orders: [t.a, t.b], legs: t.legs });

/** Best-effort wipe of note openings once a batch is done (JS cannot pin memory). */
export function wipe(orders: Order[]) {
  for (const o of orders) {
    for (const g of o.gives) g.note = { ...g.note, ownerPk: 0n, blinding: 0n };
  }
  orders.length = 0;
}
