// relayer: drains two pgmq queues. `keeper` holds keeper calls (enqueue_keeper) and is
// sent from the keeper key (the address CordonControl registers as keeper); `relayer`
// holds users' proof-carrying calls to allowed engine functions (enqueue_relay) and is
// sent from the relayer key, which has no role. Keeper jobs go first and use their own
// key and float, so user relays can neither starve nor drain them. Every call is
// simulated first; only the tx hash and status are kept in relayer_jobs.
import { type Client, type Db, db, keeperClient, publicClient, serveWorker, walletClient } from "../_shared/env.ts";

/** Reads of one message before its job is given up as failed. */
export const MAX_ATTEMPTS = 5;

/** A pgmq queue (its read / done RPCs) and the key that sends its calls. */
export type Queue = { read: string; done: string; wallet: ReturnType<typeof walletClient> };

/** True once a job that failed on read `readCt` has used all its attempts. */
export const exhausted = (readCt: number) => readCt >= MAX_ATTEMPTS;

/** The keeper queue (keeper key) first, then users' relays (relayer key). */
export const queues = (): Queue[] => [
  { read: "keeper_read", done: "keeper_done", wallet: keeperClient() },
  { read: "relay_read", done: "relay_done", wallet: walletClient() },
];

/** Simulates, sends and confirms up to 5 messages per queue, recording each job's status. */
export async function run(sb: Db = db(), client: Client = publicClient(), qs: Queue[] = queues()) {

  const results = [];
  // Note: one worker at a time sends sequentially per key, so viem's pending nonce
  // is enough; add a nonce table with row locks before running workers in parallel.
  for (const q of qs) {
    const { data: msgs, error } = await sb.rpc(q.read, { qty: 5 });
    if (error) throw error;
    for (const m of msgs ?? []) {
      const { job, to, data } = m.message as { job: number; to: `0x${string}`; data: `0x${string}` };
      try {
        await client.call({ account: q.wallet.account, to, data });
        const hash = await q.wallet.sendTransaction({ to, data });
        await sb.from("relayer_jobs").update({ status: "sent", tx_hash: hash, attempts: m.read_ct, updated_at: new Date().toISOString() }).eq("id", job);
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
        const status = receipt.status === "success" ? "confirmed" : "failed";
        await sb.from("relayer_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", job);
        await sb.rpc(q.done, { msg_id: m.msg_id });
        results.push({ job, status });
      } catch (e) {
        const final = exhausted(m.read_ct);
        await sb.from("relayer_jobs").update({
          status: final ? "failed" : "queued",
          attempts: m.read_ct,
          error: String(e).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", job);
        if (final) await sb.rpc(q.done, { msg_id: m.msg_id });
        results.push({ job, status: final ? "failed" : "retry" });
      }
    }
  }
  return results;
}

serveWorker(() => run());
