import { arg, callServed, eq, fakeDb, mkLog, served, throws } from "../_shared/fakes.ts";
import type { Log } from "npm:viem@2.56.9";
import * as abis from "../_shared/abis.ts";
import { bits, handle, rangeEnd, rewindFrom, run } from "./index.ts";

const handler = served.at(-1)!;
const A = "0x000000000000000000000000000000000000000A";
const a = A.toLowerCase();
const V = `0x${"01".repeat(32)}`;
const d = { pool: "0x00000000000000000000000000000000000000Ff", deployBlock: 100 } as never;
const T0 = 1_700_000_000n;
const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString();

const chain = (head: bigint, logs: Log[] = [], hashes: Record<string, string> = {}) => {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  return {
    ranges,
    getBlock: ({ blockNumber }: { blockNumber: bigint }) =>
      Promise.resolve({ hash: hashes[String(blockNumber)] ?? `0xh${blockNumber}`, timestamp: T0 + blockNumber }),
    getBlockNumber: () => Promise.resolve(head),
    getLogs: (p: { fromBlock: bigint; toBlock: bigint }) => (ranges.push(p), Promise.resolve(logs)),
    readContract: ({ functionName }: { functionName: string }) =>
      functionName === "symbol" ? Promise.resolve("TSLAX-LONG-SYMBOL-NAME") : Promise.reject(new Error("no name")),
  };
};

Deno.test("range helpers: at most MAX_RANGE blocks, rewind floored at 0", () => {
  eq(rangeEnd(1n, 10_000n), 2000n);
  eq(rangeEnd(1n, 50n), 50n);
  eq(rewindFrom(1000n), 800n);
  eq(rewindFrom(150n), 0n);
  eq(bits(0b101, ["a", "b", "c"]), ["a", "c"]);
});

Deno.test("first run starts at deployBlock and stores the cursor", async () => {
  const c = chain(5000n, [mkLog(abis.cordonPoolAbi, "Nullified", { nullifier: 9n })]);
  const sb = fakeDb();
  eq(await run(d, c as never, sb as never), { from: "100", to: "2099", logs: 1 });
  eq(c.ranges[0].fromBlock, 100n);
  const cursor = arg(sb.on("indexer_cursor").find((x) => arg(x, "upsert"))!, "upsert");
  eq([cursor.contract, cursor.last_block, cursor.last_hash], ["0x00000000000000000000000000000000000000ff", 2099, "0xh2099"]);
});

Deno.test("resumes after the cursor, clamped to deployBlock, idle when caught up", async () => {
  const at = (last: number) => fakeDb((x) => (x.table === "indexer_cursor" && arg(x, "select") ? { data: { last_block: last, last_hash: `0xh${last}` } } : undefined));
  eq(await run(d, chain(500n) as never, at(300) as never), { from: "301", to: "480", logs: 0 });
  eq(await run(d, chain(500n) as never, at(5) as never), { from: "100", to: "480", logs: 0 });
  eq(await run(d, chain(310n) as never, at(300) as never), { idle: true });
});

Deno.test("a reorged cursor block rewinds and drops the rewound rows", async () => {
  const sb = fakeDb((x) => (x.table === "indexer_cursor" && arg(x, "select") ? { data: { last_block: 1000, last_hash: "0xold" } } : undefined));
  eq(await run(d, chain(1100n) as never, sb as never), { from: "801", to: "1080", logs: 0 });
  eq(sb.calls.filter((x) => x.ops.some(([k]) => k === "delete")).map((x) => [x.table, arg(x, "gt")]), [
    ["commitments", "block"], ["deposits", "block"], ["nullifiers", "block"], ["income_index", "block"], ["encumbrances", "created_block"],
  ]);
});

Deno.test("every indexed event lands in its table", async () => {
  const P = abis.cordonPoolAbi, G = abis.assetGateAbi, E = abis.encumbranceRegistryAbi, N = abis.navAttestorAbi;
  const logs = [
    mkLog(P, "Deposited", { depositId: 1n, asset: A, raw: 5n, commit: 0xabn, standbyUntil: T0 }),
    mkLog(P, "Returned", { depositId: 1n }),
    mkLog(abis.screeningGateAbi, "Flagged", { depositId: 2n }),
    mkLog(P, "Inserted", { leaf: 0n, commit: 0xabn, root: 1n }),
    mkLog(P, "Nullified", { nullifier: 9n }),
    mkLog(G, "AssetRegistered", { asset: A, class: 2, claimMask: 0b10011, templateMask: 0b101 }),
    mkLog(G, "ModeSet", { asset: A, mode: 2 }),
    mkLog(abis.actionEngineAbi, "IndexUpdated", { asset: A, ts: T0, j: 7n }),
    mkLog(E, "Encumbered", { encCommit: 7n, kind: 1, until: 0n }),
    mkLog(E, "Encumbered", { encCommit: 8n, kind: 0, until: T0 }),
    mkLog(E, "Released", { encCommit: 7n }),
    mkLog(E, "Enforced", { encCommit: 8n }),
    mkLog(abis.dvpSettlerAbi, "BatchSettled", { seq: 1n, trades: 2n, legs: 4n, pricesHash: V }),
    mkLog(N, "VaultRegistered", { vaultId: V, manager: A, vaultPk: 3n }),
    mkLog(N, "Attested", { vaultId: V, epoch: 1n, navPerShare18: 10n, totalShares: 20n, queueUsdg: 30n }),
    mkLog(abis.solvencyVerifierAbi, "Solvent", { asset: A, epoch: 1n, poolBalance: 4n, liveClaims: 3n }),
    mkLog(abis.crdnStakingAbi, "Staked", { who: A, amount: 1n }), // decoded, not indexed
    { ...mkLog(P, "Returned", { depositId: 1n }), topics: [`0x${"ee".repeat(32)}`] } as Log, // unknown event
  ];
  const c = chain(0n);
  const sb = fakeDb();
  const time = (n: bigint) => Promise.resolve(iso(T0 + n));
  for (const l of logs) await handle(l, sb as never, c as never, time);

  eq(sb.calls.map((x) => `${x.table}.${x.ops[0][0]}`), [
    "deposits.upsert", "deposits.update", "deposits.update", "commitments.upsert", "deposits.update",
    "nullifiers.upsert", "assets.upsert", "assets.update", "income_index.upsert", "encumbrances.upsert",
    "encumbrances.upsert", "encumbrances.update", "encumbrances.update", "dvp_batches.upsert", "vaults.upsert",
    "vaults.update", "nav_history.upsert", "solvency.upsert",
  ]);
  const w = (i: number) => sb.calls[i].ops[0][1][0] as Record<string, unknown>;
  eq(w(0), { deposit_id: 1, asset: a, raw: "5", commit: `0x${"0".repeat(62)}ab`, standby_until: iso(T0), block: 7 });
  eq([w(1), w(2), w(4)], [{ returned: true, settled: true }, { flagged: true }, { settled: true }]);
  eq(w(3).standby_until, iso(T0 + 7n));
  const asset = w(6);
  eq([asset.symbol, asset.name, asset.class, asset.claim_types, asset.templates, asset.mode],
    ["TSLAX-LONG-SYMBO", "Unknown", "VAULT4626", ["PRINCIPAL", "INCOME", "CONTROL"], ["LOCKUP", "LIEN"], "ACTIVE"]);
  eq(w(7), { mode: "REDEEM_ONLY" });
  eq([w(9).kind, w(9).until, w(10).kind, w(10).until], ["PLEDGE", null, "LOCKUP", iso(T0)]);
  eq([w(13).n_trades, w(13).n_legs, w(14).manager_pk_hash], [2, 4, `0x${"0".repeat(63)}3`]);
  eq([w(15).epoch, w(15).nav_per_share, w(16).ok, w(17).live_claims], [1, "10", true, "3"]);
});

Deno.test("a failed write names the event", async () => {
  const sb = fakeDb(() => ({ error: { message: "rls" } }));
  await throws(() => handle(mkLog(abis.cordonPoolAbi, "Nullified", { nullifier: 1n }), sb as never, chain(0n) as never, () => Promise.resolve("")), /Nullified: .*rls/);
});

Deno.test("block times are fetched once per block", async () => {
  const c = chain(5000n, [
    mkLog(abis.cordonPoolAbi, "Inserted", { leaf: 0n, commit: 1n, root: 1n }, 150n),
    mkLog(abis.cordonPoolAbi, "Inserted", { leaf: 1n, commit: 2n, root: 1n }, 150n),
  ]);
  let blocks = 0;
  const getBlock = c.getBlock;
  c.getBlock = (p) => (blocks++, getBlock(p));
  const sb = fakeDb();
  await run(d, c as never, sb as never);
  eq(blocks, 2); // block 150 once, then the cursor block
  eq(sb.on("commitments").map((x) => arg(x, "upsert").standby_until), [iso(T0 + 150n), iso(T0 + 150n)]);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
