/**
 * Circuit inputs from notes, and contract call arguments from a proof's public
 * inputs. The orderings match circuits/<name>/src/main.nr and the engine contracts
 * (the Foundry tests in contracts/test build exactly the same shapes).
 */
import { FIELD, h1, h2, h3 } from "./hash";
import { commit, encCommit, encInput, KIND, noteInput, type Encumbrance, type Note } from "./note";
import { DEPTH, type NoteTree } from "./tree";

const s = (x: bigint | number) => x.toString();
const big = (h: string) => BigInt(h);
const at = (tree: NoteTree, n: Note) => {
  const i = tree.indexOf(commit(n));
  if (i < 0) throw new Error("note not in tree");
  return { index: s(i), path: tree.path(i).map(s) };
};
const EMPTY_PATH = Array.from({ length: DEPTH }, () => "0");

// ---------------------------------------------------------------- transfer / withdraw

/** Inputs for the transfer circuit (join-split, optional withdrawal of underlying). */
export function transferInputs(p: {
  tree: NoteTree;
  now: bigint;
  sk: bigint;
  ins: [Note, Note];
  outs: [Note, Note];
  withdrawRaw?: bigint;
  recipient?: `0x${string}`;
}) {
  const w = [0, 1].map((i) => (p.ins[i].raw === 0n ? { index: "0", path: EMPTY_PATH } : at(p.tree, p.ins[i])));
  return {
    root: s(p.tree.root),
    now: s(p.now),
    asset: s(p.withdrawRaw ? p.ins[0].asset : 0n),
    withdraw_raw: s(p.withdrawRaw ?? 0n),
    recipient: s(BigInt(p.recipient ?? 0)),
    sk: s(p.sk),
    ins: p.ins.map(noteInput),
    in_index: w.map((x) => x.index),
    in_path: w.map((x) => x.path),
    outs: p.outs.map(noteInput),
  };
}

/** CordonPool.transact(proof, Transfer) */
export const transferArgs = (pub: string[], asset: `0x${string}`, withdrawRaw: bigint, recipient: `0x${string}`) => ({
  root: big(pub[0]),
  now_: big(pub[1]),
  asset,
  withdrawRaw,
  recipient,
  nullifiers: [big(pub[5]), big(pub[6])] as const,
  commits: [big(pub[7]), big(pub[8])] as const,
});

// ---------------------------------------------------------------- bundle

/** The five claim notes a bundle creates (masked kinds are still returned, unused). */
export function claimNotes(u: Note, feeRaw: bigint, jNow: bigint, now: bigint, blindings: bigint[]): Note[] {
  const bundleId = h1(commit(u));
  return [1n, 2n, 3n, 4n, 5n].map((kind, k) => ({
    ...u,
    raw: u.raw - feeRaw,
    kind,
    bundleId,
    jBundle: jNow,
    accruedTo: kind === KIND.INCOME ? now : 0n,
    blinding: blindings[k],
  }));
}

/** Inputs for the bundle circuit (an underlying note split into claim notes). */
export function bundleInputs(p: {
  tree: NoteTree;
  now: bigint;
  jNow: bigint;
  claimMask: number;
  sk: bigint;
  underlying: Note;
  blindings: bigint[];
}) {
  const feeRaw = p.underlying.raw / 1000n;
  return {
    feeRaw,
    inputs: {
      root: s(p.tree.root),
      now: s(p.now),
      asset: s(p.underlying.asset),
      j_now: s(p.jNow),
      claim_mask: s(p.claimMask),
      fee_raw: s(feeRaw),
      sk: s(p.sk),
      underlying: noteInput(p.underlying),
      ...at(p.tree, p.underlying),
      blindings: p.blindings.map(s),
    },
  };
}

/** BundleVerifier.bundle(proof, Bundle) */
export const bundleArgs = (pub: string[], asset: `0x${string}`, feeRaw: bigint) => ({
  root: big(pub[0]),
  now_: big(pub[1]),
  asset,
  feeRaw,
  nullifier: big(pub[6]),
  commits: pub.slice(7, 12).map(big) as [bigint, bigint, bigint, bigint, bigint],
});

/** Inputs for the unbundle circuit (claim notes recombined into underlying). */
export function unbundleInputs(p: {
  tree: NoteTree;
  now: bigint;
  jNow: bigint;
  tLast: bigint;
  claimMask: number;
  sk: bigint;
  claims: Note[]; // 5 slots, PRINCIPAL..CONTROL; masked slots may hold any note
  outBlinding: bigint;
}) {
  const w = p.claims.map((c, k) => ((p.claimMask >> k) & 1 ? at(p.tree, c) : { index: "0", path: EMPTY_PATH }));
  const outRaw = (p.claims[0].raw * p.jNow) / p.claims[0].jBundle;
  return {
    outRaw,
    inputs: {
      root: s(p.tree.root),
      now: s(p.now),
      asset: s(p.claims[0].asset),
      j_now: s(p.jNow),
      t_last: s(p.tLast),
      claim_mask: s(p.claimMask),
      sk: s(p.sk),
      claims: p.claims.map(noteInput),
      index: w.map((x) => x.index),
      path: w.map((x) => x.path),
      out_blinding: s(p.outBlinding),
      out_raw: s(outRaw),
    },
  };
}

/** BundleVerifier.unbundle arguments from the proof's public inputs. */
export const unbundleArgs = (pub: string[], asset: `0x${string}`) => ({
  root: big(pub[0]),
  now_: big(pub[1]),
  asset,
  nullifiers: pub.slice(6, 11).map(big) as [bigint, bigint, bigint, bigint, bigint],
  commit: big(pub[11]),
});

/** Inputs for the term circuit (an INCOME note split at `until`). */
export function termInputs(p: { tree: NoteTree; now: bigint; sk: bigint; income: Note; until: bigint; blindings: [bigint, bigint] }) {
  return {
    root: s(p.tree.root),
    now: s(p.now),
    sk: s(p.sk),
    income: noteInput(p.income),
    ...at(p.tree, p.income),
    until: s(p.until),
    blindings: p.blindings.map(s),
  };
}

/** BundleVerifier.term arguments from the proof's public inputs. */
export const termArgs = (pub: string[]) => ({
  root: big(pub[0]),
  now_: big(pub[1]),
  nullifier: big(pub[2]),
  commits: [big(pub[3]), big(pub[4])] as const,
});

/** tStart/tEnd follow the circuit; jStart/jEnd come from ActionEngine.indexAt. */
export function incomeInputs(p: {
  tree: NoteTree;
  sk: bigint;
  note: Note;
  tEnd: bigint;
  jStart: bigint;
  jEnd: bigint;
  blindings: [bigint, bigint];
}) {
  const tStart = p.note.accruedTo > p.note.termFrom ? p.note.accruedTo : p.note.termFrom;
  const payoutRaw = (p.note.raw * (p.jStart - p.jEnd)) / p.note.jBundle;
  return {
    tStart,
    payoutRaw,
    inputs: {
      root: s(p.tree.root),
      asset: s(p.note.asset),
      t_start: s(tStart),
      t_end: s(p.tEnd),
      j_start: s(p.jStart),
      j_end: s(p.jEnd),
      sk: s(p.sk),
      note: noteInput(p.note),
      ...at(p.tree, p.note),
      payout_raw: s(payoutRaw),
      blindings: p.blindings.map(s),
    },
  };
}

/** BundleVerifier.claimIncome arguments from the proof's public inputs. */
export const claimArgs = (pub: string[], asset: `0x${string}`) => ({
  root: big(pub[0]),
  asset,
  tStart: big(pub[2]),
  tEnd: big(pub[3]),
  nullifier: big(pub[6]),
  next: big(pub[7]),
  payout: big(pub[8]),
});

// ---------------------------------------------------------------- encumbrances

/** Inputs for the encumber circuit (a free note locked to an encumbrance). */
export function encumberInputs(p: { tree: NoteTree; sk: bigint; note: Note; enc: Encumbrance; lockedBlinding: bigint }) {
  return {
    root: s(p.tree.root),
    asset: s(p.note.asset),
    kind: s(p.enc.kind),
    until: s(p.enc.until),
    release_hash: s(p.enc.releaseHash),
    sk: s(p.sk),
    note: noteInput(p.note),
    ...at(p.tree, p.note),
    enc: encInput(p.enc),
    locked_blinding: s(p.lockedBlinding),
  };
}

/** EncumbranceRegistry.encumber arguments from the proof's public inputs. */
export const encumberArgs = (pub: string[], asset: `0x${string}`, enc: Encumbrance) => ({
  root: big(pub[0]),
  asset,
  kind: Number(enc.kind),
  until: enc.until,
  releaseHash: enc.releaseHash,
  nullifier: big(pub[5]),
  lockedCommit: big(pub[6]),
  encCommit: big(pub[7]),
});

/** unlock (after release) and enforce (after default) spend the locked note. */
/** unlock / enforce inputs. Output blindings are derived in-circuit from the encumbrance. */
export function lockedSpendInputs(p: { tree: NoteTree; locked: Note; enc: Encumbrance }) {
  return {
    root: s(p.tree.root),
    enc_commit: s(encCommit(p.enc)),
    note: noteInput(p.locked),
    ...at(p.tree, p.locked),
    enc: encInput(p.enc),
  };
}

/** Blinding of a note unlock/enforce creates: tranche i (0-3), the owner's residual (4), the unlocked note (5). */
export const lockedOutputBlinding = (enc: Encumbrance, slot: number) => h3(enc.blinding, BigInt(slot), 0n);

/** Arguments shared by EncumbranceRegistry.unlock and enforce (spends of a locked note). */
export const lockedSpendArgs = (pub: string[]) => ({
  root: big(pub[0]),
  encCommit: big(pub[1]),
  nullifier: big(pub[2]),
  commits: pub.slice(3).map(big),
});

// ---------------------------------------------------------------- DvP

export const DVP_LEGS = 16;
export const DVP_GIVES = 8; // per order: two orders per trade
export const DVP_PRICES = 16;

export type DvpPrice = { asset: bigint; kind: bigint; price: bigint };
export type OrderGive = {
  note: Note;
  amount: bigint;
  /** Agreed value per raw unit (1e27 = $1) for claim notes; underlying uses the oracle. */
  quote27?: bigint;
};

/** What a trader authorises with its order proof (circuits/lib `Order`); the sequencer cannot change any of it. */
export type OrderTerms = {
  gives: OrderGive[];
  /** For a claim kind, `classHash` is the exact class wanted (see `classHash`); 0 for underlying. */
  wants: { asset: bigint; kind: bigint; quote27?: bigint; classHash?: bigint };
  /** Fewest raw units accepted in return; the trade cannot be proven for less. */
  wantMin: bigint;
  receivePk: bigint;
  expiresAt: number;
  /** Secret seed: the new notes' blindings and the published amount masks derive from it. */
  salt: bigint;
};

/** DvPSettler.OrderAuth: the trader's own order proof, made with its spending key. */
export type OrderAuth = { proof: `0x${string}`; orderHash: bigint; nullifiers: bigint[] };

/** Note::class_hash in circuits/lib: everything that makes claim notes of one kind differ in value. */
export const classHash = (n: Note) => h3(h3(n.bundleId, n.jBundle, n.termFrom), n.termUntil, n.accruedTo);

/** circuits/lib `derive`: blindings and masks both parties can rebuild from a seed. */
export const derive = (seed: bigint, slot: bigint, tag: bigint) => h3(seed, slot, tag);
export const TAG = { OUT: 1n, CHANGE: 2n, MEMO: 3n } as const;

/** Order::hash in circuits/lib. */
export function orderHash(o: OrderTerms): bigint {
  const want = h3(o.wants.asset, o.wants.kind, o.wants.quote27 ?? 0n);
  let h = h3(want, o.receivePk, h3(BigInt(o.expiresAt), o.salt, h2(o.wantMin, o.wants.classHash ?? 0n)));
  for (let i = 0; i < DVP_GIVES; i++) {
    const g = o.gives[i];
    h = g ? h3(h, commit(g.note), h2(g.amount, g.quote27 ?? 0n)) : h3(h, 0n, 0n);
  }
  return h;
}

function orderInput(o: OrderTerms) {
  if (o.gives.length === 0 || o.gives.length > DVP_GIVES) throw new Error(`an order gives 1 to ${DVP_GIVES} notes`);
  return {
    gives: Array.from({ length: DVP_GIVES }, (_, i) => {
      const g = o.gives[i];
      return g
        ? { active: true, note: noteInput(g.note), amount: s(g.amount), price_quote: s(g.quote27 ?? 0n) }
        : { active: false, note: noteInput(EMPTY_NOTE), amount: "0", price_quote: "0" };
    }),
    want_asset: s(o.wants.asset),
    want_kind: s(o.wants.kind),
    want_quote: s(o.wants.quote27 ?? 0n),
    want_class: s(o.wants.classHash ?? 0n),
    want_min: s(o.wantMin),
    receive_pk: s(o.receivePk),
    expiry: s(o.expiresAt),
    salt: s(o.salt),
  };
}

/** Inputs for the trader's order proof (in its browser, with its spending key). */
export const orderInputs = (sk: bigint, o: OrderTerms) => ({ sk: s(sk), order: orderInput(o) });

/** DvPSettler.OrderAuth from an order proof. */
export const orderAuth = (proof: `0x${string}`, pub: string[]): OrderAuth => ({
  proof,
  orderHash: big(pub[0]),
  nullifiers: pub.slice(1, 1 + DVP_GIVES).map(big),
});

/** The order proof's public inputs, to verify an OrderAuth off-chain. */
export const orderPublicInputs = (a: OrderAuth) =>
  [a.orderHash, ...a.nullifiers].map((x) => `0x${x.toString(16).padStart(64, "0")}` as `0x${string}`);

/** Sequencer-side data per give: its price table entry (blindings are derived in-circuit). */
export type DvpLeg = { priceIdx: number };

/** Inputs for the dvp circuit from a matched trade. */
export function dvpInputs(p: {
  tree: NoteTree;
  now: bigint;
  toleranceBps: bigint;
  prices: DvpPrice[];
  orders: [OrderTerms, OrderTerms];
  legs: [DvpLeg[], DvpLeg[]];
}) {
  if (p.prices.length > DVP_PRICES) throw new Error("trade too large");
  const price = (i: number) => p.prices[i] ?? { asset: 0n, kind: 0n, price: 0n };
  const legs = p.orders.map((o, k) =>
    Array.from({ length: DVP_GIVES }, (_, i) => {
      const g = o.gives[i];
      if (!g) return { price_idx: "0", index: "0", path: EMPTY_PATH };
      return { price_idx: s(p.legs[k][i].priceIdx), ...at(p.tree, g.note) };
    }),
  );
  return {
    root: s(p.tree.root),
    now: s(p.now),
    tolerance_bps: s(p.toleranceBps),
    price_asset: Array.from({ length: DVP_PRICES }, (_, i) => s(price(i).asset)),
    price_kind: Array.from({ length: DVP_PRICES }, (_, i) => s(price(i).kind)),
    price: Array.from({ length: DVP_PRICES }, (_, i) => s(price(i).price)),
    orders: p.orders.map(orderInput),
    legs,
  };
}

/** DvPSettler.Trade from a dvp proof and the two traders' order proofs. */
export function tradeArgs(proof: `0x${string}`, pub: string[], toleranceBps: bigint, orders: [OrderAuth, OrderAuth]) {
  const o = 3 + 3 * DVP_PRICES + 2;
  return {
    proof,
    root: big(pub[0]),
    toleranceBps,
    orders,
    commits: pub.slice(o, o + 2 * DVP_LEGS).map(big),
    memos: pub.slice(o + 2 * DVP_LEGS, o + 3 * DVP_LEGS).map(big),
  };
}

/**
 * A trader's new notes from a settled trade, from its own order terms and the trade's
 * published memos alone (DvPSettler.TradeSettled): change on each of its gives, and what
 * the other side gave it. `side` is its position in the trade (0 or 1). For a claim kind,
 * `wantClass` holds the class fields the order asked for.
 */
export function dvpNotesFor(o: OrderTerms, side: number, memos: bigint[], wantClass?: Partial<Note>) {
  const notes: Note[] = [];
  o.gives.forEach((g, i) => {
    const j = BigInt(side * DVP_GIVES + i);
    const left = g.note.raw - g.amount;
    if (left > 0n) notes.push({ ...g.note, raw: left, blinding: derive(o.salt, j, TAG.CHANGE) });
  });
  const other = 1 - side;
  for (let i = 0; i < DVP_GIVES; i++) {
    const j = other * DVP_GIVES + i;
    if (!memos[j]) continue;
    const raw = (((memos[j] - derive(o.salt, BigInt(j), TAG.MEMO)) % FIELD) + FIELD) % FIELD;
    notes.push({
      ...EMPTY_NOTE,
      ...wantClass,
      asset: o.wants.asset,
      kind: o.wants.kind,
      raw,
      lock: 0n,
      ownerPk: o.receivePk,
      blinding: derive(o.salt, BigInt(j), TAG.OUT),
    });
  }
  return notes;
}

const EMPTY_NOTE: Note = {
  asset: 0n, raw: 0n, kind: 0n, bundleId: 0n, jBundle: 0n, termFrom: 0n, termUntil: 0n,
  accruedTo: 0n, lock: 0n, ownerPk: 0n, blinding: 0n,
};

// ---------------------------------------------------------------- NAV

export const NAV_HOLDINGS = 16;

/** nav_per_share = floor((sum(raw * price, free notes) - liabilities) * 1e9 / total_shares). */
export function navInputs(p: {
  tree: NoteTree;
  vaultSk: bigint;
  vaultPk: bigint;
  epoch: bigint;
  totalShares: bigint;
  liabilities27: bigint;
  prices: { asset: bigint; price: bigint }[];
  holdings: Note[];
}) {
  if (p.holdings.length > NAV_HOLDINGS || p.prices.length > DVP_PRICES) throw new Error("too many holdings");
  let value = 0n;
  const holdings = Array.from({ length: NAV_HOLDINGS }, (_, i) => {
    const n = p.holdings[i];
    if (!n) return { active: false, note: noteInput(EMPTY_NOTE), index: "0", path: EMPTY_PATH, price_idx: "0" };
    const k = p.prices.findIndex((x) => x.asset === n.asset);
    if (k < 0) throw new Error("holding not priced");
    if (n.lock === 0n) value += n.raw * p.prices[k].price;
    return { active: true, note: noteInput(n), ...at(p.tree, n), price_idx: s(k) };
  });
  const navPerShare = ((value - p.liabilities27) * 1_000_000_000n) / p.totalShares;
  return {
    navPerShare,
    inputs: {
      root: s(p.tree.root),
      vault_pk: s(p.vaultPk),
      epoch: s(p.epoch),
      nav_per_share: s(navPerShare),
      total_shares: s(p.totalShares),
      liabilities: s(p.liabilities27),
      price_asset: Array.from({ length: DVP_PRICES }, (_, i) => s(p.prices[i]?.asset ?? 0n)),
      price: Array.from({ length: DVP_PRICES }, (_, i) => s(p.prices[i]?.price ?? 0n)),
      sk: s(p.vaultSk),
      holdings,
    },
  };
}

/** NavAttestor.attest Attestation struct from a nav proof. */
export const navArgs = (pub: string[], a: { epoch: bigint; navPerShare: bigint; totalShares: bigint; liabilities27: bigint; queueUsdg: bigint }) => ({
  epoch: a.epoch,
  navPerShare18: a.navPerShare,
  totalShares: a.totalShares,
  liabilities: a.liabilities27,
  queueUsdg: a.queueUsdg,
  root: big(pub[0]),
  holdingsRoot: big(pub[38]),
  nullifiers: pub.slice(39, 55).map(big),
});
