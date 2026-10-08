// action-watcher (spec §4): every 60s per asset, read the ERC-8056 multiplier (or
// ERC-4626 assets per share) and the Chainlink mark, sync the ActionEngine when the
// multiplier moved, and pause income claims when a step disagrees with Chainlink.
//
// A reinvested dividend raises the multiplier while the per-share feed price falls
// by the same fraction, so the value of one raw unit (price x multiplier) barely
// moves. A step that shifts that value by more than MAX_DRIFT is a mismatch.
import { encodeFunctionData, erc4626Abi, type Address } from "npm:viem@2.56.9";
import { actionEngineAbi, priceOracleAbi } from "../_shared/abis.ts";
import { type Client, type Db, db, deployment, lower, publicClient, serveWorker } from "../_shared/env.ts";

/** Largest move of one raw unit's value (price x multiplier) a multiplier step may cause. */
export const MAX_DRIFT = 0.05;
const erc8056Abi = [
  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "newUIMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const feedAbi = [
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { type: "uint80", name: "roundId" }, { type: "int256", name: "answer" }, { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" }, { type: "uint80", name: "answeredInRound" },
    ],
  },
] as const;

/**
 * True when a multiplier step disagrees with the feed: the previous mark was taken at
 * another multiplier and one raw unit's value moved by more than MAX_DRIFT since.
 */
export function stepMismatch(prev: { price: string; multiplier: string } | null, answer: bigint, m: bigint) {
  if (!prev || BigInt(prev.multiplier) === m || !(Number(prev.price) > 0)) return false;
  const before = Number(prev.price) * Number(prev.multiplier);
  const after = Number(answer) * Number(m);
  return Math.abs(after / before - 1) > MAX_DRIFT;
}

/** One pass over the active assets: store multipliers and marks, enqueue syncs and pauses. */
export async function run(d = deployment(), client: Client = publicClient(), sb: Db = db()) {
  const { data: assets, error } = await sb.from("assets").select("asset,class,multiplier").eq("mode", "ACTIVE");
  if (error) throw error;

  const out = [];
  for (const row of assets ?? []) {
    const asset = row.asset as Address;
    const m = row.class === "VAULT4626"
      ? await client.readContract({ address: asset, abi: erc4626Abi, functionName: "convertToAssets", args: [10n ** 18n] })
      : await client.readContract({ address: asset, abi: erc8056Abi, functionName: "uiMultiplier" });
    const [nextMult, nextAt] = row.class === "VAULT4626" ? [null, null] : await Promise.all([
      client.readContract({ address: asset, abi: erc8056Abi, functionName: "newUIMultiplier" }),
      client.readContract({ address: asset, abi: erc8056Abi, functionName: "effectiveAt" }),
    ]);
    const u = await sb.from("assets").update({
      multiplier: String(m),
      next_mult: nextMult === null ? null : String(nextMult),
      next_at: nextAt ? new Date(Number(nextAt) * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("asset", row.asset);
    if (u.error) throw u.error;

    // Mark: feed answer at the latest round, stored with the multiplier it applied to.
    const [feed] = await client.readContract({ address: d.priceOracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
    let mismatch = false;
    if (feed !== "0x0000000000000000000000000000000000000000") {
      const [roundId, answer, , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
      const { data: prev } = await sb.from("oracle_marks").select("price,multiplier").eq("asset", row.asset)
        .order("ts", { ascending: false }).limit(1).maybeSingle();
      mismatch = stepMismatch(prev, answer, m);
      const mk = await sb.from("oracle_marks").upsert({
        asset: row.asset, round_id: String(roundId), price: String(answer), multiplier: String(m),
        ts: new Date(Number(updatedAt) * 1000).toISOString(), ok: answer > 0n,
      });
      if (mk.error) throw mk.error;
    }

    const moved = row.multiplier === null || BigInt(row.multiplier) !== m;
    if (moved) {
      await enqueue(sb, "action.sync", d.actionEngine, encodeFunctionData({ abi: actionEngineAbi, functionName: "sync", args: [asset] }));
    }
    if (mismatch) {
      await enqueue(sb, "action.pause_income", d.actionEngine,
        encodeFunctionData({ abi: actionEngineAbi, functionName: "setIncomePaused", args: [asset, true] }));
    }
    out.push({ asset: lower(asset), moved, mismatch });
  }
  return out;
}

serveWorker(() => run());

async function enqueue(sb: Db, kind: string, target: Address, calldata: `0x${string}`) {
  const { error } = await sb.rpc("enqueue_keeper", { kind, target: lower(target), calldata });
  if (error) throw error;
}
