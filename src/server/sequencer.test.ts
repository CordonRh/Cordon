import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  DVP_GIVES,
  TAG,
  commit,
  derive,
  generateSealKey,
  initHasher,
  open,
  orderHash,
  ownerPkOf,
  Prover,
  seal,
  underlying,
  type OrderTerms,
} from "@cordon/sdk";
import { dvpSettlerAbi } from "@cordon/shared";
import { encodeEventTopics, encodeAbiParameters } from "viem";

import { fakeDb, fakes, withEnv, type Query } from "./fakes";
import { OFF_TREE_GRACE, offTreeFate, runBatch, sequencerKey } from "./sequencer";

describe("offTreeFate (orders whose notes are not in the tree)", () => {
  const placed = 1_700_000_000_000;

  test("an off-tree order younger than the grace keeps waiting", () => {
    expect(offTreeFate(false, placed, placed)).toBe("wait");
    expect(offTreeFate(false, placed, placed + OFF_TREE_GRACE - 1)).toBe("wait");
  });

  test("exactly at the grace period it still waits; one millisecond later it closes", () => {
    expect(offTreeFate(false, placed, placed + OFF_TREE_GRACE)).toBe("wait");
    expect(offTreeFate(false, placed, placed + OFF_TREE_GRACE + 1)).toBe("close");
  });

  test("an off-tree order older than the grace closes", () => {
    expect(offTreeFate(false, placed, placed + 60 * 60_000)).toBe("close");
  });

  test("an order with no known placement time closes", () => {
    expect(offTreeFate(false, undefined, Date.now())).toBe("close");
  });

  test("an in-tree order is never closed by this rule, however old", () => {
    expect(offTreeFate(true, placed, placed)).toBe("pair");
    expect(offTreeFate(true, placed, placed + 365 * 86_400_000)).toBe("pair");
    expect(offTreeFate(true, undefined, Date.now())).toBe("pair");
  });

  test("the grace is about ten minutes", () => {
    expect(OFF_TREE_GRACE).toBe(10 * 60_000);
  });
});

// ---------------------------------------------------------------- runBatch with fakes

const STOCK = 0xaan;
const USD = 0xbbn;
const PRICE: Record<string, bigint> = { aa: 10n ** 11n, bb: 10n ** 21n }; // $100/share, $1/USDG per raw unit
const skA = 0xa11cen;
const skB = 0xb0bn;
const deployment = {
  pool: "0x0000000000000000000000000000000000000001",
  priceOracle: "0x0000000000000000000000000000000000000002",
  dvpSettler: "0x0000000000000000000000000000000000000003",
  chainId: 46630,
};
const FEED = "0x00000000000000000000000000000000000000fe";
const HASH = `0x${"12".repeat(32)}` as const;

let restoreEnv: () => void;
let reply: Awaited<ReturnType<typeof generateSealKey>>;
let key: Awaited<ReturnType<typeof sequencerKey>>;
let nextNullifier = 100n;

beforeAll(async () => {
  await initHasher();
  restoreEnv = withEnv({
    SUPABASE_URL: "https://db.test",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SEQUENCER_SEAL_SEED: `0x${"07".repeat(32)}`,
    SEQUENCER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // gitleaks:allow (Anvil default account #0)
    RPC_URL_4663: "https://rpc.test",
    CORDON_DEPLOYMENT: JSON.stringify(deployment),
    // runBatch points bb's caches at /tmp; put them back afterwards.
    HOME: process.env.HOME,
    CRS_PATH: process.env.CRS_PATH,
  });
  reply = await generateSealKey();
  key = await sequencerKey();
});

afterAll(() => {
  restoreEnv();
  fakes.supabase = fakes.publicClient = fakes.walletClient = null;
});

/** A matching pair: Alice gives 1 STOCK for USD, Bob gives `usdRaw` USD for STOCK. */
function pairTerms(salt: bigint, usdRaw = 100_000_000n): [OrderTerms, OrderTerms] {
  const stock = underlying(STOCK, 10n ** 18n, ownerPkOf(skA), salt);
  const usd = underlying(USD, usdRaw, ownerPkOf(skB), salt + 1n);
  const base = { expiresAt: 2e9, wantMin: 0n };
  return [
    {
      ...base,
      salt,
      gives: [{ note: stock, amount: stock.raw }],
      wants: { asset: USD, kind: 0n },
      receivePk: ownerPkOf(skA),
    },
    {
      ...base,
      salt: salt + 1n,
      gives: [{ note: usd, amount: usd.raw }],
      wants: { asset: STOCK, kind: 0n },
      receivePk: ownerPkOf(skB),
    },
  ];
}

/** An order as the trader's browser seals it (the proof itself is checked by the faked prover). */
function signed(t: OrderTerms, extra: Record<string, unknown> = {}) {
  const nullifiers = Array.from({ length: DVP_GIVES }, (_, i) => (i === 0 ? nextNullifier++ : 0n));
  return {
    ...t,
    auth: { proof: "0x01" as `0x${string}`, orderHash: orderHash(t), nullifiers },
    reply: reply.publicKey,
    ref: "r",
    ...extra,
  };
}

type Row = { id: number; order?: unknown; box?: string; age?: number };

/** Runs one batch over `rows` with the given chain behaviour; returns what the database saw. */
async function batch(
  rows: Row[],
  opts: {
    tree?: bigint[];
    spent?: bigint[];
    gas?: (trades: number) => bigint;
    status?: "success" | "reverted";
    excluded?: number[];
    stale?: boolean;
    noPrice?: boolean;
    inboxError?: boolean;
  } = {},
) {
  const boxes = await Promise.all(
    rows.map(async (r) => ({ id: r.id, box: r.box ?? (await seal(key.publicKey, r.order)) })),
  );
  const closed: number[] = [];
  const inbox: string[] = [];
  const db = fakeDb((q: Query) => {
    if (q.table === "rpc:dvp_take") return { data: boxes };
    if (q.table === "commitments")
      return { data: (opts.tree ?? []).map((c) => ({ commit: c.toString() })) };
    if (q.table === "dvp_orders" && q.op === "select")
      return {
        data: rows.map((r) => ({
          id: r.id,
          created_at: new Date(Date.now() - (r.age ?? 0)).toISOString(),
        })),
      };
    if (q.table === "nullifiers")
      return {
        data: (opts.spent ?? []).map((n) => ({
          nullifier: `0x${n.toString(16).padStart(64, "0")}`,
        })),
      };
    if (q.table === "dvp_orders" && q.op === "update")
      closed.push(...(q.arg("in")![1] as number[]));
    if (q.table === "note_inbox") {
      inbox.push((q.arg("insert")![0] as { box: string }).box);
      if (opts.inboxError) return { error: { message: "inbox full" } };
    }
    return undefined;
  });
  fakes.supabase = () => db.client;
  const submitted: unknown[][] = [];
  fakes.publicClient = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "feeds") return [FEED, 3600];
      const late = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      if (functionName === "latestRoundData") return [7n, 0n, 0n, opts.stale ? late : 1n, 7n];
      if (functionName === "getRoundData")
        return [args![0] as bigint, 0n, 0n, opts.stale ? late : 1n, 0n];
      if (functionName === "rawPriceAt") {
        if (opts.noPrice) throw new Error("stale");
        return PRICE[(args![0] as string).slice(-2)];
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    estimateContractGas: async ({ args }: { args: unknown[] }) => {
      const gas = (opts.gas ?? (() => 1_000_000n))((args[2] as unknown[]).length);
      if (gas < 0n) throw new Error("estimate failed");
      return gas;
    },
    waitForTransactionReceipt: async () => ({
      status: opts.status ?? "success",
      logs: (opts.excluded ?? []).map((index) => ({
        address: deployment.dvpSettler,
        topics: encodeEventTopics({
          abi: dvpSettlerAbi,
          eventName: "TradeExcluded",
          args: { seq: 1n },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [BigInt(index)]),
        blockNumber: 1n,
        transactionHash: HASH,
        logIndex: 0,
        blockHash: HASH,
        transactionIndex: 0,
        removed: false,
      })),
    }),
  };
  fakes.walletClient = {
    account: { address: "0x00000000000000000000000000000000000000aa" },
    writeContract: async (call: { args: unknown[] }) => {
      submitted.push(call.args);
      return HASH;
    },
  };
  const result = await runBatch("https://app.test");
  const posts = await Promise.all(
    inbox.map((b) => open<Record<string, unknown>>(reply.privateKey, b)),
  );
  return { result, closed, posts, submitted };
}

const proveSpy = spyOn(Prover.prototype, "prove");
const verifySpy = spyOn(Prover.prototype, "verify");
const verifyAllBut0xba = () => verifySpy.mockImplementation(async (_n, p) => p.proof[0] !== 0xba);
verifyAllBut0xba();
afterAll(() => {
  proveSpy.mockRestore();
  verifySpy.mockRestore();
});

/** A dvp proof's public inputs: zero, except the memo that pays Alice `aliceGets` USD. */
function dvpProof(saltA: bigint, aliceGets: bigint) {
  const pub = Array.from({ length: 101 }, () => "0x00");
  const memo = 3 + 48 + 2 + 32 + DVP_GIVES; // Alice (side 0) receives from Bob's first slot
  pub[memo] = `0x${(derive(saltA, BigInt(DVP_GIVES), TAG.MEMO) + aliceGets).toString(16)}`;
  return { proof: new Uint8Array([1, 2]), publicInputs: pub as `0x${string}`[] };
}

afterEach(() => {
  proveSpy.mockReset();
  verifySpy.mockReset();
  verifyAllBut0xba();
});

describe("runBatch", () => {
  test("does nothing until the sequencer is configured", async () => {
    const restore = withEnv({ SEQUENCER_SEAL_SEED: undefined });
    expect(await runBatch("https://app.test")).toEqual({ skipped: "sequencer not configured" });
    restore();
  });

  test("closes unreadable, expired, unauthorised, unproven and malformed orders before pairing", async () => {
    const [a] = pairTerms(10n);
    const { result, closed } = await batch([
      { id: 1, box: "not a sealed box" },
      { id: 2, order: signed({ ...a, expiresAt: 1 }) },
      { id: 3, order: { ...signed(a), reply: "short" } },
      { id: 4, order: { ...signed(a), ref: "x".repeat(65) } },
      { id: 5, order: { ...signed(a), auth: { ...signed(a).auth, orderHash: 1n } } },
      { id: 6, order: { ...signed(a), auth: { ...signed(a).auth, proof: "0xba" } } },
      { id: 7, order: { gives: [] } },
    ]);
    expect(closed.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result).toEqual({ orders: 0, trades: 0 });
  });

  test("closes spent and superseded orders, keeps young off-tree ones waiting, closes stale ones", async () => {
    const [a1] = pairTerms(20n);
    const [a2] = pairTerms(30n);
    const [a3] = pairTerms(40n);
    const spent = signed(a1);
    const older = signed(a2);
    const newer = { ...signed(a2), auth: { ...older.auth } }; // same note, placed later
    const young = signed(a3);
    const stale = signed(pairTerms(50n)[0]);
    const { result, closed } = await batch(
      [
        { id: 1, order: spent },
        { id: 2, order: older },
        { id: 3, order: newer },
        { id: 4, order: young, age: 60_000 },
        { id: 5, order: stale, age: OFF_TREE_GRACE + 60_000 },
      ],
      { tree: [commit(a2.gives[0].note)], spent: [spent.auth.nullifiers[0]] },
    );
    expect(closed.sort()).toEqual([1, 2, 5]);
    // Only the newer order over the indexed note is pairable; one order cannot trade.
    expect(result).toEqual({ orders: 1, trades: 0 });
  });

  test("settles a matched pair and posts each trader its notes", async () => {
    const [ta, tb] = pairTerms(60n);
    proveSpy.mockImplementation(async () => dvpProof(ta.salt, 100_000_000n));
    const { result, closed, posts, submitted } = await batch(
      [
        { id: 11, order: signed(ta, { ref: "alice" }) },
        { id: 12, order: signed(tb, { ref: "bob" }) },
      ],
      { tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)] },
    );
    expect(result).toEqual({ orders: 2, trades: 1, excluded: 0, tx: HASH });
    expect(closed.sort()).toEqual([11, 12]);
    const [now, prices, trades] = submitted[0] as [
      bigint,
      { asset: string; roundId: bigint; quote: bigint }[],
      unknown[],
    ];
    expect(now).toBeLessThan(BigInt(Math.floor(Date.now() / 1000)));
    expect(prices).toHaveLength(16);
    expect(prices.filter((p) => p.roundId === 7n)).toHaveLength(2);
    expect(trades).toHaveLength(1);
    const alice = posts.find((p) => p.ref === "alice")!;
    expect(alice.tx).toBe(HASH);
    expect(alice.spent).toEqual([commit(ta.gives[0].note).toString()]);
    expect((alice.add as { raw: string; asset: string }[])[0]).toMatchObject({
      raw: "100000000",
      asset: USD.toString(),
      status: "pending",
    });
    expect(posts.find((p) => p.ref === "bob")!.add).toEqual([]);
  });

  test("a trade the chain excludes is reported as failed to both sides", async () => {
    const [ta, tb] = pairTerms(70n);
    proveSpy.mockImplementation(async () => dvpProof(ta.salt, 1n));
    const { result, posts, closed } = await batch(
      [
        { id: 21, order: signed(ta) },
        { id: 22, order: signed(tb) },
      ],
      { tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], excluded: [0] },
    );
    expect(result).toMatchObject({ trades: 1, excluded: 1 });
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.failed === true)).toBe(true);
    expect(closed.sort()).toEqual([21, 22]);
  });

  test("a pair that cannot be proven closes and is reported; an inbox failure does not stop the batch", async () => {
    const [ta, tb] = pairTerms(80n);
    proveSpy.mockImplementation(async () => {
      throw new Error("witness failed");
    });
    const err = spyOn(console, "error").mockImplementation(() => {});
    const { result, posts, closed } = await batch(
      [
        { id: 31, order: signed(ta) },
        { id: 32, order: signed(tb) },
      ],
      { tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], inboxError: true },
    );
    err.mockRestore();
    expect(result).toEqual({ orders: 2, trades: 0 });
    expect(posts.map((p) => p.failed)).toEqual([true, true]);
    expect(closed.sort()).toEqual([31, 32]);
  });

  test("keeps the batch under the gas limit: later trades wait for the next batch", async () => {
    const [a1, b1] = pairTerms(90n);
    const [a2, b2] = pairTerms(95n);
    proveSpy.mockImplementation(async () => dvpProof(0n, 0n));
    const { result, closed, submitted } = await batch(
      [
        { id: 41, order: signed(a1) },
        { id: 42, order: signed(b1) },
        { id: 43, order: signed(a2) },
        { id: 44, order: signed(b2) },
      ],
      {
        tree: [a1, b1, a2, b2].map((t) => commit(t.gives[0].note)),
        gas: (n) => (n > 1 ? -1n : 1_000_000n),
      },
    );
    expect(result).toMatchObject({ orders: 4, trades: 1 });
    expect((submitted[0] as unknown[][])[2]).toHaveLength(1);
    expect(closed.sort()).toEqual([41, 42]);
  });

  test("a reverted batch throws", async () => {
    const [ta, tb] = pairTerms(100n);
    proveSpy.mockImplementation(async () => dvpProof(0n, 0n));
    await expect(
      batch(
        [
          { id: 51, order: signed(ta) },
          { id: 52, order: signed(tb) },
        ],
        { tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], status: "reverted" },
      ),
    ).rejects.toThrow("batch reverted");
  });

  test("a stale feed walks back rounds; with no price the orders wait", async () => {
    const [ta, tb] = pairTerms(110n);
    const { result, closed } = await batch(
      [
        { id: 61, order: signed(ta) },
        { id: 62, order: signed(tb) },
      ],
      { tree: [commit(ta.gives[0].note), commit(tb.gives[0].note)], stale: true, noPrice: true },
    );
    expect(result).toEqual({ orders: 2, trades: 0 });
    expect(closed).toEqual([]);
    expect(proveSpy).not.toHaveBeenCalled();
  });
});
