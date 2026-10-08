import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dvpNotesFor, orderAuth, orderHash, orderInputs, orderPublicInputs, tradeArgs, type OrderTerms } from "./builders";
import { initHasher } from "./hash";
import { authorised, pair, tradeInputs, type Order } from "./matcher";
import { commit, ownerPkOf, underlying } from "./note";
import { Prover, toHex } from "./prover";
import { generateSealKey, open, seal } from "./sealed";
import { NoteTree } from "./tree";

const STOCK = 0xaan;
const USD = 0xbbn;
// $100 per share (18 decimals) and $1 per USDG (6 decimals), per raw unit at 1e27 = $1.
const price = (asset: bigint) => (asset === STOCK ? 10n ** 11n : 10n ** 21n);
const skA = 0xa11cen;
const skB = 0xb0bn;
const circuits = join(import.meta.dir, "../../../public/circuits");
const prover = new Prover(async (n) => JSON.parse(readFileSync(join(circuits, `${n}.json`), "utf8")));

beforeAll(initHasher);

function terms(usdRaw: bigint): [OrderTerms, OrderTerms] {
  const stock = underlying(STOCK, 10n ** 18n, ownerPkOf(skA), 1n);
  const usd = underlying(USD, usdRaw, ownerPkOf(skB), 2n);
  const base = { expiresAt: 2e9, wantMin: 0n };
  return [
    { ...base, salt: 5n, gives: [{ note: stock, amount: stock.raw }], wants: { asset: USD, kind: 0n }, receivePk: ownerPkOf(skA) },
    { ...base, salt: 6n, gives: [{ note: usd, amount: usd.raw }], wants: { asset: STOCK, kind: 0n }, receivePk: ownerPkOf(skB) },
  ];
}

/** What each trader's browser does: prove its own order with its own key. */
async function place(t: OrderTerms, sk: bigint): Promise<Order> {
  const p = await prover.prove("order", orderInputs(sk, t));
  return { ...t, auth: orderAuth(toHex(p.proof), p.publicInputs) };
}

/** Matching only looks at terms; the proofs are checked where they are made and on-chain. */
const unproven = (ts: OrderTerms[]): Order[] =>
  ts.map((t) => ({ ...t, auth: { proof: "0x", orderHash: orderHash(t), nullifiers: [] } }));

test("orders round-trip through the sealed box", async () => {
  const k = await generateSealKey();
  const [a] = unproven(terms(100_000_000n));
  const back = await open<Order>(k.privateKey, await seal(k.publicKey, a));
  expect(back.auth.orderHash).toBe(a.auth.orderHash);
  expect(back.gives[0].note.raw).toBe(10n ** 18n);
  expect(back).not.toHaveProperty("sk");
});

test("a lopsided pair does not match", () => {
  const { trades, rest } = pair(unproven(terms(50_000_000n)), price, 25n);
  expect(trades).toHaveLength(0);
  expect(rest).toHaveLength(2);
});

test(
  "the order proof binds the terms the sequencer sees",
  async () => {
    const [ta] = terms(100_000_000n);
    const a = await place(ta, skA);
    expect(a.auth.orderHash).toBe(orderHash(ta));
    expect(authorised(a)).toBe(true);
    expect(await prover.verify("order", { proof: Buffer.from(a.auth.proof.slice(2), "hex"), publicInputs: orderPublicInputs(a.auth) })).toBe(true);
    // Rerouting what Alice receives breaks the binding.
    expect(authorised({ ...a, receivePk: ownerPkOf(0x5ecn) })).toBe(false);
    // Only the owner's key can prove an order over its notes.
    await expect(prover.prove("order", orderInputs(skB, ta))).rejects.toThrow();
  },
  { timeout: 180_000 },
);

test(
  "a matched pair proves as one DvP trade without spending keys",
  async () => {
    const [ta, tb] = terms(100_000_000n);
    const os = [await place(ta, skA), await place(tb, skB)];
    const { trades, prices } = pair(os, price, 25n);
    expect(trades).toHaveLength(1);
    expect(prices).toHaveLength(2);

    const tree = new NoteTree(os.map((o) => commit(o.gives[0].note)));
    const p = await prover.prove("dvp", tradeInputs(trades[0], prices, tree, 1_800_000_000n, 25n));
    expect(await prover.verify("dvp", p)).toBe(true);
    // The trade proof commits to exactly the hashes the traders proved.
    expect(BigInt(p.publicInputs[3 + 48])).toBe(os[0].auth.orderHash);
    expect(BigInt(p.publicInputs[3 + 48 + 1])).toBe(os[1].auth.orderHash);

    // Each trader rebuilds its new note from the published memos alone, no sequencer needed.
    const args = tradeArgs("0x", p.publicInputs, 25n, [os[0].auth, os[1].auth]);
    const [gotA] = dvpNotesFor(ta, 0, args.memos);
    const [gotB] = dvpNotesFor(tb, 1, args.memos);
    expect(gotA.raw).toBe(100_000_000n);
    expect(gotB.raw).toBe(10n ** 18n);
    expect(args.commits).toContain(commit(gotA));
    expect(args.commits).toContain(commit(gotB));
  },
  { timeout: 180_000 },
);

test("an order that wants more than the other side gives does not match", () => {
  const [ta, tb] = terms(100_000_000n);
  const { trades } = pair(unproven([ta, { ...tb, wantMin: 10n ** 18n + 1n }]), price, 25n);
  expect(trades).toHaveLength(0);
});
