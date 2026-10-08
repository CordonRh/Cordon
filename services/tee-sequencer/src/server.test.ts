import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  commit,
  DVP_GIVES,
  generateSealKey,
  initHasher,
  NoteTree,
  orderHash,
  ownerPkOf,
  seal,
  underlying,
  type Order,
  type OrderTerms,
} from "@cordon/sdk";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { privateKeyToAccount } from "viem/accounts";
import { chainClients, loadTree, sequencer } from "./server";

const STOCK = 0xaan;
const USD = 0xbbn;
const addr = (x: bigint) => `0x${x.toString(16).padStart(40, "0")}`;
// $100 per share (18 decimals) and $1 per USDG (6 decimals), per raw unit at 1e27 = $1.
const PRICE: Record<string, bigint> = { [addr(STOCK)]: 10n ** 11n, [addr(USD)]: 10n ** 21n };
const nowS = () => Math.floor(Date.now() / 1000);

let sealKey: Awaited<ReturnType<typeof generateSealKey>>;
beforeAll(async () => {
  await initHasher();
  sealKey = await generateSealKey();
});

/** Alice gives one share for 100 USDG, Bob the reverse; `nullifier` tags each order's note. */
function pairTerms(usdRaw = 100_000_000n): [OrderTerms, OrderTerms] {
  const stock = underlying(STOCK, 10n ** 18n, ownerPkOf(0xa11cen), 1n);
  const usd = underlying(USD, usdRaw, ownerPkOf(0xb0bn), 2n);
  const base = { expiresAt: nowS() + 600, wantMin: 0n };
  return [
    { ...base, salt: 5n, gives: [{ note: stock, amount: stock.raw }], wants: { asset: USD, kind: 0n }, receivePk: ownerPkOf(0xa11cen) },
    { ...base, salt: 6n, gives: [{ note: usd, amount: usd.raw }], wants: { asset: STOCK, kind: 0n }, receivePk: ownerPkOf(0xb0bn) },
  ];
}
const order = (t: OrderTerms, nullifier: bigint): Order => ({
  ...t,
  auth: { proof: "0x00", orderHash: orderHash(t), nullifiers: [nullifier, ...Array(DVP_GIVES - 1).fill(0n)] },
});

type Opts = { verify?: boolean; prove?: boolean; stale?: bigint; tree?: bigint[]; updatedAgo?: bigint };

/** A sequencer over fakes, served on a random port. */
function setup(o: Opts = {}) {
  const reads: string[] = [];
  const submitted: { args: unknown[] }[] = [];
  const now = BigInt(nowS());
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      reads.push(functionName);
      switch (functionName) {
        case "feeds": return [args![0], 3600];
        // The newest round is too new for the batch time; the one before it is in force.
        case "latestRoundData": return [7n, 0n, 0n, now - (o.updatedAgo ?? 0n), 7n];
        case "getRoundData": return [args![0], 0n, 0n, now - 120n, args![0]];
        case "rawPriceAt":
          if (o.stale !== undefined && args![0] === addr(o.stale)) throw new Error("stale");
          return PRICE[args![0] as string];
      }
      throw new Error(functionName);
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const wallet = { writeContract: async (w: { args: unknown[] }) => (submitted.push(w), "0xbatch") };
  const prover = {
    verify: async () => o.verify ?? true,
    prove: async () => {
      if (o.prove === false) throw new Error("unsatisfied");
      return { proof: new Uint8Array([1]), publicInputs: Array(200).fill("0x01") };
    },
  };
  const s = sequencer({
    client, wallet, prover, sealKey, attestation: "doc", oracle: addr(0x0an) as never, settler: addr(0x5en) as never,
    loadTree: async () => new NoteTree(o.tree ?? []),
    batchSeconds: 60, toleranceBps: 25n,
  } as never);
  const server: Server = createServer(s.handle).listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  servers.push(server);
  const post = async (body: unknown) => {
    const r = await fetch(`${url}/legs`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const place = async (o: Order) => post({ encryptedLegs: await seal(sealKey.publicKey, o) });
  return { s, url, post, place, reads, submitted };
}
const servers: Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

test("GET /key serves the seal key with its attestation; other routes 404", async () => {
  const { url } = setup();
  const r = await fetch(`${url}/key`);
  expect(await r.json()).toEqual({ publicKey: sealKey.publicKey, attestation: "doc" });
  expect((await fetch(`${url}/nope`)).status).toBe(404);
  expect((await fetch(`${url}/legs`)).status).toBe(404); // GET
});

test("accepts a sealed, well-formed, authorised and proven order", async () => {
  const { place, s } = setup();
  const [ta] = pairTerms();
  const r = await place(order(ta, 11n));
  expect(r.status).toBe(200);
  expect(r.json.accepted).toBe(true);
  expect(r.json.batchEta).toBeGreaterThan(nowS());
  expect(s.pending()).toHaveLength(1);
});

test("a newer order over the same note replaces the older one", async () => {
  const { place, s } = setup();
  const [ta] = pairTerms();
  await place(order(ta, 11n));
  await place(order({ ...ta, salt: 99n }, 11n));
  expect(s.pending().map((o) => o.salt)).toEqual([99n]);
});

test("rejects junk, expired, far-future, rerouted, unproven and oversized orders alike", async () => {
  const { place, post, s } = setup();
  const [ta] = pairTerms();
  const bad = [
    await post("{not json"),
    await post({ encryptedLegs: "garbage" }),
    await place({ ...order(ta, 1n), expiresAt: nowS() - 1 }),
    await place({ ...order(ta, 1n), expiresAt: nowS() + 7200 }),
    await place({ ...order(ta, 1n), receivePk: 1n }), // terms no longer match the proven hash
    await place({ ...order(ta, 1n), gives: [] }), // malformed
    await post("x".repeat(200_001)),
  ];
  expect(bad.map((r) => r.status)).toEqual(Array(7).fill(400));
  expect(bad.every((r) => r.json.accepted === false && r.json.batchEta === 0)).toBe(true);
  expect(s.pending()).toHaveLength(0);
  const unproven = setup({ verify: false });
  expect((await unproven.place(order(ta, 1n))).status).toBe(400);
});

test("batch: fewer than two live orders does nothing", async () => {
  const { s, place, reads } = setup();
  await s.batch();
  await place(order(pairTerms()[0], 1n));
  await s.batch();
  expect(reads).toEqual([]);
});

test("batch: pins the round in force, proves the pair, submits and wipes", async () => {
  const [ta, tb] = pairTerms();
  const { s, place, reads, submitted } = setup({
    tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)],
    updatedAgo: 0n,
  });
  await place(order(ta, 1n));
  await place(order(tb, 2n));
  await s.batch();
  expect(reads.filter((r) => r === "getRoundData")).toHaveLength(2); // walked back once per asset
  expect(submitted).toHaveLength(1);
  const [batchTime, prices, trades] = submitted[0].args as [bigint, { asset: string; kind: number; roundId: bigint; quote: bigint }[], unknown[]];
  expect(batchTime).toBeLessThanOrEqual(BigInt(nowS()) - 30n);
  expect(prices).toHaveLength(16);
  expect(prices.slice(0, 2)).toEqual([
    { asset: addr(STOCK), kind: 0, roundId: 6n, quote: 0n },
    { asset: addr(USD), kind: 0, roundId: 6n, quote: 0n },
  ]);
  expect(prices[2].asset).toBe("0x0000000000000000000000000000000000000000");
  expect(trades).toHaveLength(1);
  expect(s.pending()).toHaveLength(0);
});

test("batch: a fresh newest round is used as is", async () => {
  const [ta, tb] = pairTerms();
  const { s, place, reads, submitted } = setup({
    tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)],
    updatedAgo: 120n,
  });
  await place(order(ta, 1n));
  await place(order(tb, 2n));
  await s.batch();
  expect(reads).not.toContain("getRoundData");
  expect((submitted[0].args[1] as { roundId: bigint }[])[0].roundId).toBe(7n);
});

test("batch: orders over notes missing from the tree wait", async () => {
  const [ta, tb] = pairTerms();
  const { s, place, submitted } = setup({ tree: [commit(ta.gives[0].note)] });
  await place(order(ta, 1n));
  await place(order(tb, 2n));
  await s.batch();
  expect(submitted).toHaveLength(0);
  expect(s.pending()).toHaveLength(2);
});

test("batch: a stale price leaves that asset's orders waiting", async () => {
  const [ta, tb] = pairTerms();
  const { s, place, submitted } = setup({ tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], stale: STOCK });
  await place(order(ta, 1n));
  await place(order(tb, 2n));
  await s.batch();
  expect(submitted).toHaveLength(0);
  expect(s.pending()).toHaveLength(2);
});

test("batch: an unprovable pair is dropped and nothing is submitted", async () => {
  const [ta, tb] = pairTerms();
  const { s, place, submitted } = setup({ tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], prove: false });
  await place(order(ta, 1n));
  await place(order(tb, 2n));
  const error = console.error;
  console.error = () => {};
  await s.batch();
  console.error = error;
  expect(submitted).toHaveLength(0);
  expect(s.pending()).toHaveLength(0);
});

test("loadTree pages the commitments feed 1000 leaves at a time", async () => {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    urls.push(`${u} ${(init.headers as Record<string, string>).apikey}`);
    const n = urls.length === 1 ? 1000 : 1;
    return Response.json(Array.from({ length: n }, (_, i) => ({ commit: String(urls.length * 10_000 + i) })));
  }) as typeof fetch;
  try {
    const t = await loadTree("https://db.invalid", "anon");
    expect(urls).toEqual([
      "https://db.invalid/rest/v1/commitments?select=commit&leaf=gte.0&order=leaf&limit=1000 anon",
      "https://db.invalid/rest/v1/commitments?select=commit&leaf=gte.1000&order=leaf&limit=1000 anon",
    ]);
    expect(t.indexOf(20_000n)).toBe(1000);
  } finally {
    globalThis.fetch = real;
  }
});

test("chainClients signs with the sequencer key", () => {
  const key = `0x${"44".repeat(32)}` as const;
  const { client, wallet } = chainClients("http://127.0.0.1:9", key);
  expect(wallet.account.address).toBe(privateKeyToAccount(key).address);
  expect(typeof client.readContract).toBe("function");
});
