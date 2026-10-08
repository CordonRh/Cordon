// indexer: chain events -> public tables (commitments, deposits, nullifiers, assets,
// income_index, encumbrances, dvp_batches, vaults, nav_history, solvency).
// Short and idempotent: at most MAX_RANGE confirmed blocks per run; cron re-invokes.
import { decodeEventLog, erc20Abi, type Log } from "npm:viem@2.56.9";
import * as abis from "../_shared/abis.ts";
import { type Client, type Db, db, deployment, lower, publicClient, serveWorker } from "../_shared/env.ts";

const CONFIRMATIONS = BigInt(Deno.env.get("INDEXER_CONFIRMATIONS") ?? "20");
const MAX_RANGE = 2000n;
const REWIND = 200n;
const CLASSES = ["STOCK8056", "TREASURY", "VAULT4626"] as const;
const CLAIMS = ["PRINCIPAL", "INCOME", "VOTE", "REDEEM", "CONTROL"] as const;
const TEMPLATES = ["LOCKUP", "PLEDGE", "LIEN"] as const;
const MODES = ["NONE", "ACTIVE", "REDEEM_ONLY"] as const;

const allAbi = Object.values(abis).flat();
/** The names whose bit is set in `mask` (bit i -> names[i]). */
export const bits = <T extends string>(mask: number, names: readonly T[]) => names.filter((_, i) => (mask >> i) & 1);
const hex = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;

/** Last block of a run starting at `from`: at most MAX_RANGE blocks, never past `head`. */
export const rangeEnd = (from: bigint, head: bigint) => (from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head);

/** Block to roll back to when the cursor block was reorged out: REWIND blocks back, floored at 0. */
export const rewindFrom = (lastBlock: bigint) => (lastBlock > REWIND ? lastBlock - REWIND : 0n);

/** Indexes the next confirmed range of protocol events and advances the cursor. */
export async function run(d = deployment(), client: Client = publicClient(), sb: Db = db()) {
  const cursorKey = lower(d.pool);

  const { data: cur } = await sb.from("indexer_cursor").select("last_block,last_hash").eq("contract", cursorKey).maybeSingle();
  const start = BigInt(d.deployBlock ?? 0);
  let from = cur ? BigInt(cur.last_block) + 1n : start;
  if (from < start) from = start; // cursor from before a (re)deployment

  // Reorg check: the block we stopped at must still be canonical.
  if (cur) {
    const b = await client.getBlock({ blockNumber: BigInt(cur.last_block) });
    if (b.hash !== cur.last_hash) {
      const back = rewindFrom(BigInt(cur.last_block));
      // Rows inserted after `back` go; flags set by later events (released, enforced, settled) are not
      // rolled back. Note: CONFIRMATIONS makes that rare; keep per-event history if it ever matters.
      for (const [t, col] of [["commitments", "block"], ["deposits", "block"], ["nullifiers", "block"], ["income_index", "block"], ["encumbrances", "created_block"]]) {
        const del = await sb.from(t).delete().gt(col, Number(back));
        if (del.error) throw del.error;
      }
      from = back + 1n;
    }
  }

  const head = (await client.getBlockNumber()) - CONFIRMATIONS;
  if (head < from) return { idle: true };
  const to = rangeEnd(from, head);

  const addresses = [
    d.pool, d.bundleVerifier, d.actionEngine, d.assetGate, d.dvpSettler,
    d.encumbranceRegistry, d.navAttestor, d.solvencyVerifier, d.screeningGate,
  ];
  const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
  const times = new Map<bigint, string>();
  const time = async (n: bigint) => {
    if (!times.has(n)) times.set(n, new Date(Number((await client.getBlock({ blockNumber: n })).timestamp) * 1000).toISOString());
    return times.get(n)!;
  };

  for (const log of logs) await handle(log, sb, client, time);

  const last = await client.getBlock({ blockNumber: to });
  await sb.from("indexer_cursor").upsert({ contract: cursorKey, last_block: Number(to), last_hash: last.hash, updated_at: new Date().toISOString() });
  return { from: String(from), to: String(to), logs: logs.length };
}

serveWorker(() => run());

/** Writes one log's event into its table; logs of events we do not index are skipped. */
export async function handle(
  log: Log,
  sb: Db,
  client: Client,
  time: (n: bigint) => Promise<string>,
) {
  let ev;
  try {
    ev = decodeEventLog({ abi: allAbi, data: log.data, topics: log.topics });
  } catch {
    return; // events we do not index (ownership, fees, ...)
  }
  const a = ev.args as Record<string, any>;
  const block = Number(log.blockNumber);
  const tx = log.transactionHash!;
  const check = ({ error }: { error: unknown }) => {
    if (error) throw new Error(`${ev.eventName}: ${JSON.stringify(error)}`);
  };

  switch (ev.eventName) {
    case "Deposited":
      return check(await sb.from("deposits").upsert({
        deposit_id: Number(a.depositId), asset: lower(a.asset), raw: String(a.raw), commit: hex(a.commit),
        standby_until: new Date(Number(a.standbyUntil) * 1000).toISOString(), block,
      }));
    case "Returned":
      return check(await sb.from("deposits").update({ returned: true, settled: true }).eq("deposit_id", Number(a.depositId)));
    case "Flagged":
      return check(await sb.from("deposits").update({ flagged: true }).eq("deposit_id", Number(a.depositId)));
    case "Inserted": {
      const ts = await time(log.blockNumber!);
      check(await sb.from("commitments").upsert({ leaf: Number(a.leaf), commit: hex(a.commit), block, tx, standby_until: ts, cleared: true }));
      return check(await sb.from("deposits").update({ settled: true }).eq("commit", hex(a.commit)));
    }
    case "Nullified":
      return check(await sb.from("nullifiers").upsert({ nullifier: hex(a.nullifier), block }));
    case "AssetRegistered": {
      const asset = a.asset as `0x${string}`;
      const [symbol, name] = await Promise.all([
        client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
        client.readContract({ address: asset, abi: erc20Abi, functionName: "name" }).catch(() => "Unknown"),
      ]);
      return check(await sb.from("assets").upsert({
        asset: lower(asset), symbol: String(symbol).slice(0, 16), name: String(name).slice(0, 80),
        class: CLASSES[Number(a.class)], claim_types: bits(Number(a.claimMask), CLAIMS),
        templates: bits(Number(a.templateMask), TEMPLATES), mode: "ACTIVE", updated_at: new Date().toISOString(),
      }));
    }
    case "ModeSet":
      return check(await sb.from("assets").update({ mode: MODES[Number(a.mode)] }).eq("asset", lower(a.asset)));
    case "IndexUpdated":
      return check(await sb.from("income_index").upsert({
        asset: lower(a.asset), ts: new Date(Number(a.ts) * 1000).toISOString(), block, index: String(a.j), verified: true,
      }));
    case "Encumbered":
      return check(await sb.from("encumbrances").upsert({
        enc_commit: hex(a.encCommit), kind: TEMPLATES[Number(a.kind)],
        until: Number(a.until) ? new Date(Number(a.until) * 1000).toISOString() : null, created_block: block,
      }));
    case "Released":
      return check(await sb.from("encumbrances").update({ released: true }).eq("enc_commit", hex(a.encCommit)));
    case "Enforced":
      return check(await sb.from("encumbrances").update({ enforced: true }).eq("enc_commit", hex(a.encCommit)));
    case "BatchSettled":
      return check(await sb.from("dvp_batches").upsert({
        seq: Number(a.seq), ts: await time(log.blockNumber!), n_trades: Number(a.trades), n_legs: Number(a.legs),
        prices_hash: a.pricesHash, tx,
      }));
    case "VaultRegistered":
      return check(await sb.from("vaults").upsert({ vault_id: a.vaultId, manager_pk_hash: hex(a.vaultPk) }));
    case "Attested": {
      const ts = await time(log.blockNumber!);
      check(await sb.from("vaults").update({
        epoch: Number(a.epoch), nav_per_share: String(a.navPerShare18), total_shares: String(a.totalShares),
        queue_usdg: String(a.queueUsdg), proof_tx: tx, ts,
      }).eq("vault_id", a.vaultId));
      return check(await sb.from("nav_history").upsert({
        vault_id: a.vaultId, epoch: Number(a.epoch), ts, nav_per_share: String(a.navPerShare18), ok: true,
      }));
    }
    case "Solvent":
      return check(await sb.from("solvency").upsert({
        epoch: Number(a.epoch), asset: lower(a.asset), ts: await time(log.blockNumber!),
        pool_balance: String(a.poolBalance), live_claims: String(a.liveClaims), tx,
      }));
  }
}
