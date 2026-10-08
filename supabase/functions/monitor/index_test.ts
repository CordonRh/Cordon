import { arg, callServed, eq, fakeDb, mkLog, ok, served, throws } from "../_shared/fakes.ts";
import { parseAbi, type Log } from "npm:viem@2.56.9";
import * as abis from "../_shared/abis.ts";
import { alertBody, dedupeKey, eventAlert, isLargeWithdrawal, parseWatch, run } from "./index.ts";

const handler = served.at(-1)!;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const d = {
  control: addr(1), timelock: addr(2), assetGate: addr(3), priceOracle: addr(4), actionEngine: addr(5), pool: addr(6),
} as never;
const [A1, A2, BIG, SMALL] = [addr(0xa1), addr(0xa2), addr(0xb1), addr(0xb2)];
const timelockAbi = parseAbi([
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
]);

const chain = (opts: { head?: bigint; logs?: Log[]; paused?: number } = {}) => {
  const scanned: { fromBlock: bigint; toBlock: bigint }[] = [];
  return {
    scanned,
    getBlockNumber: () => Promise.resolve(opts.head ?? 1000n),
    getLogs: (p: { fromBlock: bigint; toBlock: bigint }) => (scanned.push(p), Promise.resolve(opts.logs ?? [])),
    getBalance: ({ address }: { address: string }) => Promise.resolve(address === addr(0xc2) ? 10n ** 18n : 10n ** 15n),
    readContract: ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      switch (functionName) {
        case "owed": return Promise.resolve(50n);
        case "paused": return Promise.resolve(opts.paused ?? 0);
        case "assetCount": return Promise.resolve(2n);
        case "assetList": return Promise.resolve(args![0] === 0n ? A1 : A2);
        case "feeds": return args![0] === A1 ? Promise.resolve([addr(0xf1), 3600]) : Promise.reject(new Error("no feed"));
        case "latestRoundData": return Promise.resolve([5n, 1n, 0n, 0n, 5n]);
        case "ok": return Promise.resolve(false);
        case "sequencer": return Promise.resolve(addr(0xc3));
      }
      throw new Error(functionName);
    },
  };
};

const withFetch = async (status: number, fn: (posted: { url: string; body: string }[]) => Promise<void>) => {
  const real = globalThis.fetch;
  const posted: { url: string; body: string }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    posted.push({ url, body: String(init.body) });
    return Promise.resolve(new Response("", { status }));
  }) as typeof fetch;
  try {
    await fn(posted);
  } finally {
    globalThis.fetch = real;
  }
};

Deno.test("pure rules: event classes, withdrawal size, dedupe, watch list", () => {
  eq(eventAlert("KeeperSet", { keeper: A1, enabled: 1n }, "0x01"), {
    kind: "governance", detail: { event: "KeeperSet", args: { keeper: A1, enabled: "1" }, tx: "0x01" },
  });
  eq(eventAlert("Unpaused", {}, null)?.kind, "pause");
  eq(eventAlert("StepHeld", {}, null)?.detail.action, "scheduleSplit or confirmStep");
  eq(eventAlert("Deposited", {}, null), undefined);
  eq([isLargeWithdrawal(10n, 90n), isLargeWithdrawal(9n, 90n)], [true, false]);
  const now = new Date("2026-10-07T12:34:56Z");
  eq(dedupeKey({ kind: "oracle", detail: { a: 1 } }, now), 'oracle:{"a":1}:2026-10-07T12');
  eq(dedupeKey({ kind: "governance", detail: { a: 1 } }, now), 'governance:{"a":1}');
  eq(parseWatch(""), []);
  eq(parseWatch("keeper:0x1,relayer:0x2"), [["keeper", "0x1"], ["relayer", "0x2"]]);
});

Deno.test("raises every alert class, records them, moves the cursor and notifies", async () => {
  const logs = [
    mkLog(abis.cordonControlAbi, "KeeperSet", { keeper: A1, enabled: true }),
    mkLog(abis.cordonControlAbi, "Paused", { flags: 1 }),
    mkLog(timelockAbi, "CallScheduled", {
      id: `0x${"11".repeat(32)}`, index: 0n, target: A1, value: 0n, data: "0x", predecessor: `0x${"00".repeat(32)}`, delay: 86400n,
    }),
    mkLog(abis.actionEngineAbi, "StepHeld", { asset: A1, j: 2n, heldJ: 3n }),
    mkLog(abis.cordonPoolAbi, "Withdrawn", { asset: BIG, raw: 10n }),
    mkLog(abis.cordonPoolAbi, "Withdrawn", { asset: SMALL, raw: 1n }),
    mkLog(abis.cordonPoolAbi, "Deposited", { depositId: 1n, asset: A1, raw: 5n, commit: 1n, standbyUntil: 1n }),
  ];
  const c = chain({ logs, paused: 3 });
  const sb = fakeDb((x) => {
    if (x.table === "monitor_state") return { data: { value: "900" } };
    if (x.table === "alerts" && arg(x, "insert")?.kind === "governance" && arg(x, "insert").detail.event === "KeeperSet") {
      return { error: { code: "23505" } }; // already recorded: fine
    }
    if (x.table === "alerts" && arg(x, "select")) return { data: [{ id: 1, kind: "paused", detail: { flags: 3 } }, { id: 2, kind: "oracle", detail: {} }] };
  });
  Deno.env.set("WATCH_ADDRESSES", `keeper:${addr(0xc1)},relayer:${addr(0xc2)}`);
  Deno.env.set("ALERT_WEBHOOK_URL", "https://hooks.invalid/x");
  await withFetch(200, async (posted) => {
    const out = await run(d, sb as never, c as never);
    eq(out, { alerts: 10, unsent: 2, scanned: "901-1000" });
    eq(posted.length, 1);
    eq(JSON.parse(posted[0].body).text, 'Cordon paused: {"flags":3}\nCordon oracle: {}');
  });
  eq(c.scanned[0], { address: [addr(1), addr(2), addr(3), addr(4), addr(5), addr(6)], fromBlock: 901n, toBlock: 1000n });
  const kinds = sb.on("alerts").filter((x) => arg(x, "insert")).map((x) => arg(x, "insert").kind);
  eq(kinds, [
    "governance", "pause", "governance", "index-step-held", "large-withdrawal", "paused", "oracle", "oracle",
    "low-gas", "low-gas",
  ]);
  const lowGas = sb.on("alerts").filter((x) => arg(x, "insert")?.kind === "low-gas").map((x) => arg(x, "insert").detail.name);
  eq(lowGas, ["keeper", "sequencer"]);
  eq(arg(sb.on("monitor_state").find((x) => arg(x, "upsert"))!, "upsert"), { key: "last_block", value: "1000" });
  const marked = sb.on("alerts").find((x) => arg(x, "update"))!;
  eq([arg(marked, "update"), marked.ops.at(-1)], [{ notified: true }, ["in", ["id", [1, 2]]]]);
  Deno.env.delete("WATCH_ADDRESSES");
  Deno.env.delete("ALERT_WEBHOOK_URL");
});

Deno.test("first run starts at head; a failed webhook leaves alerts unsent", async () => {
  const sb = fakeDb((x) => (x.table === "alerts" && arg(x, "select") ? { data: [{ id: 1, kind: "oracle", detail: {} }] } : undefined));
  Deno.env.set("ALERT_WEBHOOK_URL", "https://hooks.invalid/x");
  await withFetch(500, async (posted) => {
    const out = await run(d, sb as never, chain() as never);
    eq(out.scanned, "1000-1000");
    eq(posted.length, 1);
  });
  ok(!sb.on("alerts").some((x) => arg(x, "update")), "nothing marked notified");
  Deno.env.delete("ALERT_WEBHOOK_URL");
});

Deno.test("a caught-up cursor scans nothing and keeps the cursor; no hook, no post", async () => {
  const sb = fakeDb((x) => (x.table === "monitor_state" ? { data: { value: "1000" } } : undefined));
  await withFetch(200, async (posted) => {
    const out = await run(d, sb as never, chain() as never);
    eq([out.scanned, out.unsent], ["none", 0]);
    eq(posted.length, 0);
  });
  eq(sb.on("monitor_state").filter((x) => arg(x, "upsert")).length, 0);
});

Deno.test("an alert that fails to record (not a duplicate) fails the run before the cursor moves", async () => {
  const sb = fakeDb((x) => {
    if (x.table === "monitor_state" && arg(x, "select")) return { data: { value: "900" } };
    if (x.table === "alerts" && arg(x, "insert")) return { error: { code: "42501", message: "denied" } };
  });
  await throws(() => run(d, sb as never, chain({ paused: 1 }) as never), /denied/);
  eq(sb.on("monitor_state").filter((x) => arg(x, "upsert")).length, 0);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});

Deno.test("alert body carries Telegram's chat_id from the webhook URL", () => {
  eq(JSON.parse(alertBody("https://api.telegram.org/bot1:x/sendMessage?chat_id=-100", "hi")), { text: "hi", content: "hi", chat_id: "-100" });
  eq(JSON.parse(alertBody("https://hooks.slack.com/services/a/b", "hi")), { text: "hi", content: "hi" });
});
