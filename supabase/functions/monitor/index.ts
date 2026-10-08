// monitor: every 5 minutes, raises alerts for what needs a human (SECURITY.md runbook):
// governance and role changes, pauses, held index steps (a split to schedule), large
// withdrawals, stale or failing oracle feeds, and low gas on the operational keys.
// Alerts land in public.alerts and, when ALERT_WEBHOOK_URL is set, are POSTed there
// (Slack / Discord / Telegram webhook formats accept a plain `text` field).
import { formatEther, parseAbi, parseEventLogs, type Address } from "npm:viem@2.56.9";
import {
  actionEngineAbi,
  assetGateAbi,
  cordonControlAbi,
  cordonPoolAbi,
  priceOracleAbi,
} from "../_shared/abis.ts";
import { type Client, type Db, db, deployment, publicClient, serveWorker } from "../_shared/env.ts";

const LOW_GAS = 2_000_000_000_000_000n; // 0.002 ETH
const MAX_RANGE = 5_000n; // per run; a lagging monitor catches up over runs
const timelockAbi = parseAbi([
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event Cancelled(bytes32 indexed id)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);

/** One alert row: a kind and its JSON detail. */
export type Alert = { kind: string; detail: Record<string, unknown> };

const GOVERNANCE = [
  "EngineSet", "KeeperSet", "GuardianSet", "SequencerSet", "FeeRecipientSet", "OwnershipTransferred",
  "OwnershipTransferStarted", "CallScheduled", "CallExecuted", "Cancelled", "AssetRegistered", "ModeSet",
  "TemplatesSet", "FeedSet",
];
const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/** The alert an event raises by its name alone (governance, pause, held index step), if any. */
export function eventAlert(name: string, args: unknown, tx: string | null): Alert | undefined {
  if (GOVERNANCE.includes(name)) return { kind: "governance", detail: json({ event: name, args, tx }) };
  if (name === "Paused" || name === "Unpaused") return { kind: "pause", detail: json({ event: name, args, tx }) };
  if (name === "StepHeld") return { kind: "index-step-held", detail: json({ args, tx, action: "scheduleSplit or confirmStep" }) };
}

/** A withdrawal is large when it took at least 10% of what the pool owed before it. */
export const isLargeWithdrawal = (raw: bigint, owedAfter: bigint) => raw * 10n >= owedAfter + raw;

/** Dedupe key for an alert: state alerts (paused, oracle, low-gas) repeat at most hourly. */
export const dedupeKey = (a: Alert, now: Date) =>
  ["paused", "oracle", "low-gas"].includes(a.kind)
    ? `${a.kind}:${JSON.stringify(a.detail)}:${now.toISOString().slice(0, 13)}`
    : `${a.kind}:${JSON.stringify(a.detail)}`;

/** Parses WATCH_ADDRESSES ("keeper:0x..,relayer:0x..") into [name, address] pairs. */
export const parseWatch = (s: string) => s.split(",").filter(Boolean).map((x) => x.split(":") as [string, Address]);

/** Raises and records alerts since the last run, then posts undelivered ones to the webhook. */
export async function run(
  d = deployment() as ReturnType<typeof deployment> & { timelock: Address },
  sb: Db = db(),
  client: Client = publicClient(),
) {
  const alerts: Alert[] = [];

  // ---- events since the last run
  const head = await client.getBlockNumber();
  const { data: st } = await sb.from("monitor_state").select("value").eq("key", "last_block").maybeSingle();
  const from = st ? BigInt(st.value) + 1n : head;
  const to = from + MAX_RANGE < head ? from + MAX_RANGE : head;
  if (from <= to) {
    const logs = await client.getLogs({
      address: [d.control, d.timelock, d.assetGate, d.priceOracle, d.actionEngine, d.pool],
      fromBlock: from,
      toBlock: to,
    });
    const abi = [...cordonControlAbi, ...timelockAbi, ...assetGateAbi, ...priceOracleAbi, ...actionEngineAbi, ...cordonPoolAbi];
    for (const l of parseEventLogs({ abi, logs, strict: false })) {
      const name = l.eventName as string;
      const alert = eventAlert(name, l.args, l.transactionHash);
      if (alert) alerts.push(alert);
      if (name === "Withdrawn") {
        const { asset, raw } = l.args as { asset: Address; raw: bigint };
        const owed = await client.readContract({ address: d.pool, abi: cordonPoolAbi, functionName: "owed", args: [asset] });
        if (isLargeWithdrawal(raw, owed)) alerts.push({ kind: "large-withdrawal", detail: json({ asset, raw, tx: l.transactionHash }) });
      }
    }
  }

  // ---- pause state and oracle health
  const paused = await client.readContract({ address: d.control, abi: cordonControlAbi, functionName: "paused" });
  if (paused !== 0) alerts.push({ kind: "paused", detail: { flags: paused } });
  const count = await client.readContract({ address: d.assetGate, abi: assetGateAbi, functionName: "assetCount" });
  for (let i = 0n; i < count; i++) {
    const asset = await client.readContract({ address: d.assetGate, abi: assetGateAbi, functionName: "assetList", args: [i] });
    try {
      const [feed] = await client.readContract({ address: d.priceOracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
      const [round] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
      const ok = await client.readContract({ address: d.priceOracle, abi: priceOracleAbi, functionName: "ok", args: [asset, round] });
      if (!ok) alerts.push({ kind: "oracle", detail: { asset, round: round.toString() } });
    } catch (e) {
      alerts.push({ kind: "oracle", detail: { asset, error: String(e).slice(0, 200) } });
    }
  }

  // ---- operational keys: WATCH_ADDRESSES = "keeper:0x..,relayer:0x.." (+ the sequencer)
  const watch = parseWatch(Deno.env.get("WATCH_ADDRESSES") ?? "");
  watch.push(["sequencer", await client.readContract({ address: d.control, abi: cordonControlAbi, functionName: "sequencer" })]);
  for (const [name, addr] of watch) {
    const bal = await client.getBalance({ address: addr });
    if (bal < LOW_GAS) alerts.push({ kind: "low-gas", detail: { name, address: addr, balance: formatEther(bal) } });
  }

  // ---- record (repeat state alerts at most hourly), then move the cursor, so an alert
  // is never lost to a failed run.
  for (const a of alerts) {
    const dedupe = dedupeKey(a, new Date());
    const { error } = await sb.from("alerts").insert({ kind: a.kind, detail: a.detail, dedupe });
    if (error && error.code !== "23505") throw error; // only a duplicate is fine
  }
  if (from <= to) await sb.from("monitor_state").upsert({ key: "last_block", value: to.toString() });

  // ---- notify everything not yet delivered (retries failed webhooks)
  const hook = Deno.env.get("ALERT_WEBHOOK_URL");
  const { data: unsent } = await sb.from("alerts").select("id,kind,detail").eq("notified", false).order("id").limit(50);
  if (hook && unsent?.length) {
    const text = unsent.map((a) => `Cordon ${a.kind}: ${JSON.stringify(a.detail)}`).join("\n").slice(0, 3500);
    const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: alertBody(hook, text) });
    if (res.ok) await sb.from("alerts").update({ notified: true }).in("id", unsent.map((a) => a.id));
  }
  return { alerts: alerts.length, unsent: unsent?.length ?? 0, scanned: from <= to ? `${from}-${to}` : "none" };
}

/**
 * Webhook body: Slack reads `text`, Discord reads `content`, Telegram's sendMessage reads `text`
 * plus the `chat_id` it takes from the webhook URL (`.../bot<token>/sendMessage?chat_id=<id>`).
 */
export function alertBody(hook: string, text: string): string {
  const chat_id = new URL(hook).searchParams.get("chat_id") ?? undefined;
  return JSON.stringify({ text, content: text, chat_id });
}

serveWorker(() => run());
