// clearer: every minute, moves deposits whose 15-minute standby has passed (and
// that were not flagged or returned) into the note tree via CordonPool.clear.
import { encodeFunctionData } from "npm:viem@2.56.9";
import { cordonPoolAbi } from "../_shared/abis.ts";
import { type Db, db, deployment, lower, serveWorker } from "../_shared/env.ts";

/** Max deposits cleared per run (one CordonPool.clear call). */
export const BATCH = 20;

/** Enqueues one pool.clear for up to BATCH deposits past standby; `d` is read only if any. */
export async function run(sb: Db = db(), d = deployment) {
  const { data, error } = await sb.from("deposits").select("deposit_id")
    .eq("settled", false).eq("returned", false).eq("flagged", false)
    .lt("standby_until", new Date().toISOString()).order("deposit_id").limit(BATCH);
  if (error) throw error;
  if (!data?.length) return { cleared: 0 };
  const ids = data.map((r) => BigInt(r.deposit_id));
  const calldata = encodeFunctionData({ abi: cordonPoolAbi, functionName: "clear", args: [ids] });
  const r = await sb.rpc("enqueue_keeper", { kind: "pool.clear", target: lower(d().pool), calldata });
  if (r.error) throw r.error;
  return { cleared: ids.length };
}

serveWorker(() => run());
