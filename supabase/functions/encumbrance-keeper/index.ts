// encumbrance-keeper: LOCKUPs release by time on-chain (no transaction needed).
// PLEDGE / LIEN defaults approved by ops in default_requests are declared on-chain
// here; the holder then enforces with its own proof.
// Note: approval is manual; automate PLEDGE LTV triggers once holders register
// oracle trigger terms with the keeper.
import { encodeFunctionData } from "npm:viem@2.56.9";
import { encumbranceRegistryAbi } from "../_shared/abis.ts";
import { type Db, db, deployment, lower, serveWorker } from "../_shared/env.ts";

/** Declares every ops-approved, not yet submitted default on-chain (via the keeper queue). */
export async function run(d = deployment(), sb: Db = db()) {
  const { data: rows, error } = await sb.from("default_requests").select("enc_commit").eq("approved", true).eq("submitted", false);
  if (error) throw error;
  for (const { enc_commit } of rows ?? []) {
    const calldata = encodeFunctionData({
      abi: encumbranceRegistryAbi, functionName: "declareDefault", args: [BigInt(enc_commit)],
    });
    const r = await sb.rpc("enqueue_keeper", { kind: "encumbrance.default", target: lower(d.encumbranceRegistry), calldata });
    if (r.error) throw r.error;
    const u = await sb.from("default_requests").update({ submitted: true }).eq("enc_commit", enc_commit);
    if (u.error) throw u.error;
  }
  return { declared: rows?.length ?? 0 };
}

serveWorker(() => run());
