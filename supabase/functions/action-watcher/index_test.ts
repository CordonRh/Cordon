import { arg, callServed, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData } from "npm:viem@2.56.9";
import { actionEngineAbi } from "../_shared/abis.ts";
import { run, stepMismatch } from "./index.ts";

const handler = served.at(-1)!;
const d = { priceOracle: "0x0000000000000000000000000000000000000001", actionEngine: "0x00000000000000000000000000000000000000Ee" };
const VAULT = "0x000000000000000000000000000000000000000a";
const STOCK = "0x000000000000000000000000000000000000000b";
const FEED = "0x000000000000000000000000000000000000000f";
const E18 = 10n ** 18n;

/** Chain double: the vault has no feed; the stock doubled its multiplier while its price stayed. */
const client = (price: bigint) => ({
  readContract: ({ address, functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
    const r: Record<string, unknown> = {
      convertToAssets: 11n * 10n ** 17n,
      uiMultiplier: 2n * E18,
      newUIMultiplier: 3n * E18,
      effectiveAt: address === STOCK ? 1_700_000_000n : 0n,
      feeds: [args?.[0] === VAULT ? "0x0000000000000000000000000000000000000000" : FEED, 3600],
      latestRoundData: [9n, price, 0n, 1_700_000_000n, 9n],
    };
    return Promise.resolve(r[functionName]);
  },
});

const assets = [
  { asset: VAULT, class: "VAULT4626", multiplier: null },
  { asset: STOCK, class: "STOCK8056", multiplier: String(2n * E18) },
];

Deno.test("stepMismatch: only a multiplier step that moves unit value past MAX_DRIFT", () => {
  eq(stepMismatch(null, 100n, E18), false);
  eq(stepMismatch({ price: "100", multiplier: String(E18) }, 100n, E18), false); // same multiplier
  eq(stepMismatch({ price: "0", multiplier: String(E18) }, 100n, 2n * E18), false); // no prior price
  eq(stepMismatch({ price: "100", multiplier: String(E18) }, 50n, 2n * E18), false); // reinvested: value kept
  eq(stepMismatch({ price: "100", multiplier: String(E18) }, 52n, 2n * E18), false); // 4% drift
  eq(stepMismatch({ price: "100", multiplier: String(E18) }, 100n, 2n * E18), true); // value doubled
});

Deno.test("syncs a moved multiplier and pauses income on a mismatched step", async () => {
  const sb = fakeDb((c) => {
    if (c.table === "assets" && arg(c, "select")) return { data: assets };
    if (c.table === "oracle_marks" && arg(c, "select")) return { data: { price: "100", multiplier: String(E18) } };
  });
  const out = await run(d as never, client(100n) as never, sb as never);
  eq(out, [
    { asset: VAULT, moved: true, mismatch: false },
    { asset: STOCK, moved: false, mismatch: true },
  ]);
  const updates = sb.on("assets").filter((c) => arg(c, "update")).map((c) => arg(c, "update"));
  eq(updates.map((u) => [u.multiplier, u.next_mult, u.next_at]), [
    [String(11n * 10n ** 17n), null, null],
    [String(2n * E18), String(3n * E18), new Date(1_700_000_000_000).toISOString()],
  ]);
  const mark = arg(sb.on("oracle_marks").find((c) => arg(c, "upsert"))!, "upsert");
  eq([mark.asset, mark.round_id, mark.price, mark.ok], [STOCK, "9", "100", true]);
  const jobs = sb.on("rpc:enqueue_keeper").map((c) => arg(c, "args"));
  eq(jobs.map((j) => [j.kind, j.target]), [
    ["action.sync", d.actionEngine.toLowerCase()],
    ["action.pause_income", d.actionEngine.toLowerCase()],
  ]);
  eq(decodeFunctionData({ abi: actionEngineAbi, data: jobs[1].calldata }).args, [STOCK, true]);
});

Deno.test("a consistent step only stores the mark", async () => {
  const sb = fakeDb((c) => {
    if (c.table === "assets" && arg(c, "select")) return { data: [assets[1]] };
    if (c.table === "oracle_marks" && arg(c, "select")) return { data: { price: "100", multiplier: String(E18) } };
  });
  eq(await run(d as never, client(50n) as never, sb as never), [{ asset: STOCK, moved: false, mismatch: false }]);
  eq(sb.on("rpc:enqueue_keeper").length, 0);
});

Deno.test("database errors fail the run", async () => {
  await throws(() => run(d as never, client(1n) as never, fakeDb(() => ({ error: { message: "assets down" } })) as never), /assets down/);
  const sb = fakeDb((c) => {
    if (c.table === "assets" && arg(c, "select")) return { data: [assets[0]] };
    if (c.table === "rpc:enqueue_keeper") return { error: { message: "queue down" } };
  });
  await throws(() => run(d as never, client(1n) as never, sb as never), /queue down/);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
