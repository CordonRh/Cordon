/// <reference types="node" />
/**
 * Hosted DvP sequencer. The same matching as services/tee-sequencer, run once
 * a minute by pg_cron (POST /api/sequencer): orders wait in dvp_orders sealed to the
 * SEQUENCER_SEAL_SEED key; each settled or excluded trade's result goes back sealed to
 * the trader's receiving key through note_inbox. Orders carry their traders' order
 * proofs, never spending keys: the sequencer can settle an order as placed or not at all.
 * Results are a convenience: every trader can rebuild its notes from the TradeSettled
 * event (cordon.ts recoverOrder), so a lost delivery never loses funds.
 * Note: the operator can still read orders (amounts, note openings); accepted (Low)
 * in SECURITY.md.
 */
import {
  authorised,
  wellFormed,
  commit,
  fetchCircuits,
  initHasher,
  needsOracle,
  NoteTree,
  open,
  orderPublicInputs,
  dvpNotesFor,
  pair,
  Prover,
  seal,
  sealKeyFromSeed,
  toHex,
  tradeArgs,
  tradeInputs,
  wipe,
  type Note,
  type Order,
} from "@cordon/sdk";
import { dvpSettlerAbi, priceOracleAbi, robinhoodChain } from "@cordon/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createWalletClient, hexToBytes, http, parseEventLogs, type Address } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

import { chainEnv } from "./chain";

const TOLERANCE_BPS = 25n;
const MAX_BATCH_GAS = 30_000_000n; // Arbitrum Orbit per-transaction limit is 32M
/** Milliseconds an order may wait for its notes to reach the indexed tree before it closes. */
export const OFF_TREE_GRACE = 10 * 60_000;

/** What a trader seals: the enclave order plus where to send the result. */
export type SequencedOrder = Order & { reply: string; ref?: string };

/** The hosted sequencer's sealing key pair (from SEQUENCER_SEAL_SEED). */
export const sequencerKey = () => sealKeyFromSeed(hexToBytes(process.env.SEQUENCER_SEAL_SEED as `0x${string}`));

const hex32 = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;
const asAddress = (x: bigint) => `0x${x.toString(16).padStart(40, "0")}` as Address;
const stored = (n: Note) => ({
  ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)])),
  commit: commit(n).toString(),
  status: "pending",
});

const feedAbi = [
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
  {
    type: "function", name: "getRoundData", stateMutability: "view", inputs: [{ type: "uint80" }],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
] as const;

/**
 * What an open, unspent order does this batch: "pair" once every note it gives is in the
 * indexed tree; otherwise "wait" (indexer lag) until it is older than OFF_TREE_GRACE, then
 * "close", so orders over notes that never existed cannot crowd out real ones. An order
 * with no known placement time counts as placed at the epoch (it closes at once).
 */
export function offTreeFate(inTree: boolean, placedAtMs: number | undefined, nowMs: number): "pair" | "wait" | "close" {
  if (inTree) return "pair";
  return nowMs - (placedAtMs ?? 0) > OFF_TREE_GRACE ? "close" : "wait";
}

/** A reply key is a raw 32-byte X25519 public key (base64). */
function validReply(reply: unknown) {
  if (typeof reply !== "string") return false;
  try {
    return atob(reply).length === 32;
  } catch {
    return false;
  }
}

async function tree(sb: SupabaseClient) {
  const leaves: bigint[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("commitments").select("commit").order("leaf").range(from, from + 999);
    if (error) throw error;
    leaves.push(...data.map((r) => BigInt(r.commit)));
    if (data.length < 1000) return new NoteTree(leaves);
  }
}

/** One hosted DvP batch: reads open orders, pairs them, proves and settles the trades, posts results. */
export async function runBatch(origin: string) {
  const c = chainEnv();
  const e = process.env;
  const url = e.SUPABASE_URL ?? e.VITE_SUPABASE_URL;
  if (!c || !url || !e.SEQUENCER_SEAL_SEED || !e.SEQUENCER_PRIVATE_KEY || !e.SUPABASE_SERVICE_ROLE_KEY) {
    return { skipped: "sequencer not configured" };
  }
  const sb = createClient(url, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const close = (ids: number[]) => sb.from("dvp_orders").update({ closed: true }).in("id", ids);
  // One bad reply key or a full inbox must never stop the other deliveries.
  const post = async (reply: string, payload: unknown) => {
    try {
      const { error } = await sb.from("note_inbox").insert({ box: await seal(reply, payload) });
      if (error) console.error("inbox post failed", error.message);
    } catch (err) {
      console.error("inbox post failed", err);
    }
  };

  // Serverless file systems are read-only except /tmp; bb caches its CRS under HOME / CRS_PATH.
  process.env.HOME = "/tmp";
  process.env.CRS_PATH ??= "/tmp/.bb-crs";
  await initHasher();
  const key = await sequencerKey();
  const { data: rows, error } = await sb.rpc("dvp_take");
  if (error) throw error;
  // Leases only keep overlapping runs apart. Every order this run took and did not settle or
  // close is released when it ends, so the next run sees all open orders together: with a
  // lease longer than the cron interval, two orders placed a minute apart alternated between
  // runs and never met.
  const taken = ((rows ?? []) as { id: number }[]).map((r) => r.id);
  try {
    // Orders that are unreadable, expired, or not covered by a valid order proof close at once.
    const prover = new Prover(fetchCircuits(`${origin}/circuits`));
    const nowS = Math.floor(Date.now() / 1000);
    const read: (SequencedOrder & { id: number })[] = [];
    for (const r of (rows ?? []) as { id: number; box: string }[]) {
      let ok = false;
      let o: SequencedOrder | null = null;
      try {
        o = await open<SequencedOrder>(key.privateKey, r.box);
        ok =
          wellFormed(o) &&
          o.expiresAt > nowS &&
          validReply(o.reply) &&
          (o.ref === undefined || (typeof o.ref === "string" && o.ref.length <= 64)) &&
          authorised(o) &&
          (await prover.verify("order", { proof: hexToBytes(o.auth.proof), publicInputs: orderPublicInputs(o.auth) }));
      } catch {
        ok = false;
      }
      if (ok && o) read.push({ ...o, id: r.id });
      else await close([r.id]);
    }

    // Before pairing: an order whose note was spent since it was placed closes; one whose
    // notes are not in the tree waits (indexer lag) and pairs with nobody, and closes after
    // OFF_TREE_GRACE, so orders over notes that never existed cannot crowd out real ones.
    const t = await tree(sb);
    const { data: ages } = await sb.from("dvp_orders").select("id,created_at").in("id", read.map((o) => o.id));
    const placedAt = new Map((ages ?? []).map((r) => [r.id as number, Date.parse(r.created_at as string)]));
    const nullsOf = (o: Order) => o.auth.nullifiers.filter((n) => n !== 0n).map(hex32);
    const { data: spentRows } = await sb.from("nullifiers").select("nullifier").in("nullifier", read.flatMap(nullsOf));
    const spent = new Set((spentRows ?? []).map((r) => r.nullifier as string));
    // Several open orders over one note: the newest stands, older ones close.
    const newest = new Map<string, number>();
    for (const o of read) for (const n of nullsOf(o)) newest.set(n, Math.max(newest.get(n) ?? 0, o.id));
    const orders: (SequencedOrder & { id: number })[] = [];
    for (const o of read) {
      if (nullsOf(o).some((n) => spent.has(n) || newest.get(n) !== o.id)) await close([o.id]);
      else {
        const fate = offTreeFate(o.gives.every((g) => t.indexOf(commit(g.note)) >= 0), placedAt.get(o.id), Date.now());
        if (fate === "pair") orders.push(o);
        else if (fate === "close") await close([o.id]);
      }
    }
    if (orders.length < 2) return { orders: orders.length, trades: 0 };

    // One round per underlying asset for the whole batch: the round in force at the batch
    // time `now` (the settler checks exactly that). A stale feed leaves its orders waiting.
    const { client, deployment } = c;
    const now = BigInt(nowS) - 30n;
    const rounds = new Map<bigint, { roundId: bigint; price: bigint }>();
    for (const o of orders) {
      for (const g of o.gives) {
        if (!needsOracle(g.note.kind) || rounds.has(g.note.asset)) continue;
        const asset = asAddress(g.note.asset);
        const [feed] = await client.readContract({ address: deployment.priceOracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
        let [roundId, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
        for (let back = 0; updatedAt > now && back < 10 && roundId > 1n; back++) {
          [roundId, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [roundId - 1n] });
        }
        const price = await client
          .readContract({ address: deployment.priceOracle, abi: priceOracleAbi, functionName: "rawPriceAt", args: [asset, roundId, now] })
          .catch(() => undefined);
        if (price !== undefined) rounds.set(g.note.asset, { roundId, price });
      }
    }
    const price = (asset: bigint, kind: bigint, quote27?: bigint) => (needsOracle(kind) ? rounds.get(asset)?.price : quote27);
    const { trades, prices: table } = pair(orders, price, TOLERANCE_BPS);
    if (!trades.length) return { orders: orders.length, trades: 0 };

    const proven = [];
    for (const tr of trades) {
      // A pair that cannot be proven closes and is reported; the rest of the batch goes on.
      try {
        const p = await prover.prove("dvp", tradeInputs(tr, table, t, now, TOLERANCE_BPS));
        proven.push({ tr, args: tradeArgs(toHex(p.proof), p.publicInputs, TOLERANCE_BPS, [tr.a.auth, tr.b.auth]) });
      } catch (err) {
        console.error("trade not provable", err);
        for (const o of [tr.a, tr.b] as SequencedOrder[]) await post(o.reply, { t: "dvp", ref: o.ref, failed: true });
        await close([(tr.a as SequencedOrder & { id: number }).id, (tr.b as SequencedOrder & { id: number }).id]);
      }
    }
    if (!proven.length) return { orders: orders.length, trades: 0 };

    const zero = "0x0000000000000000000000000000000000000000" as Address;
    const prices = Array.from({ length: 16 }, (_, i) => {
      const p = table[i];
      if (!p) return { asset: zero, kind: 0, roundId: 0n, quote: 0n };
      const oracleLeg = needsOracle(p.kind);
      return { asset: asAddress(p.asset), kind: Number(p.kind), roundId: oracleLeg ? rounds.get(p.asset)!.roundId : 0n, quote: oracleLeg ? 0n : p.price };
    });
    const chain = robinhoodChain(e.RPC_URL_4663 ?? e.VITE_RPC_URL_4663, Number((deployment as { chainId?: number }).chainId ?? 4663));
    const wallet = createWalletClient({
      chain,
      account: privateKeyToAccount(e.SEQUENCER_PRIVATE_KEY as `0x${string}`, { nonceManager }),
      transport: http(e.RPC_URL_4663 ?? e.VITE_RPC_URL_4663),
    });
    // Keep the batch under the chain's per-transaction gas limit: later trades wait for the
    // next batch (their orders stay open) rather than sinking this one.
    const submit = { address: deployment.dvpSettler, abi: dvpSettlerAbi, functionName: "submitBatch" } as const;
    while (proven.length > 1) {
      const gas = await client
        .estimateContractGas({ ...submit, account: wallet.account, args: [now, prices as never, proven.map((x) => x.args) as never] })
        .catch(() => MAX_BATCH_GAS + 1n);
      if (gas <= MAX_BATCH_GAS) break;
      proven.pop();
    }
    const hash = await wallet.writeContract({ ...submit, args: [now, prices as never, proven.map((x) => x.args) as never] });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`batch reverted: ${hash}`);
    const excluded = new Set(
      parseEventLogs({ abi: dvpSettlerAbi, eventName: "TradeExcluded", logs: receipt.logs }).map((l) => Number(l.args.index)),
    );

    // Each party learns its spent notes, its change and what it received.
    for (const [i, { tr }] of proven.entries()) {
      for (const [party, o] of [[0, tr.a], [1, tr.b]] as const) {
        const order = o as SequencedOrder;
        if (excluded.has(i)) {
          await post(order.reply, { t: "dvp", ref: order.ref, failed: true });
          continue;
        }
        // The same derivation the trader runs on the chain's memos (cordon.ts recoverOrder).
        const memos = proven[i].args.memos;
        const add: Note[] = dvpNotesFor(order, party, memos);
        const gave = order.gives.map((g) => commit(g.note).toString());
        await post(order.reply, { t: "dvp", ref: order.ref, tx: hash, spent: gave, add: add.map(stored) });
      }
      await close([(tr.a as SequencedOrder & { id: number }).id, (tr.b as SequencedOrder & { id: number }).id]);
    }
    wipe(proven.flatMap(({ tr }) => [tr.a, tr.b]));
    return { orders: orders.length, trades: proven.length, excluded: excluded.size, tx: hash };
  } finally {
    if (taken.length) await sb.from("dvp_orders").update({ taken_until: null }).in("id", taken).eq("closed", false);
  }
}
