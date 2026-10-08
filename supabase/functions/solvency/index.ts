// solvency: hourly, enqueue SolvencyVerifier.attest(asset) for every registered asset.
// A deficit makes the call revert, which the relayer records as a failed job.
import { encodeFunctionData, type Address } from "npm:viem@2.56.9";
import { solvencyVerifierAbi } from "../_shared/abis.ts";
import { type Db, db, deployment, lower, serveWorker } from "../_shared/env.ts";

/** Enqueues SolvencyVerifier.attest for every registered asset. */
export async function run(d = deployment(), sb: Db = db()) {
  const { data: assets, error } = await sb.from("assets").select("asset");
  if (error) throw error;
  for (const { asset } of assets ?? []) {
    const calldata = encodeFunctionData({ abi: solvencyVerifierAbi, functionName: "attest", args: [asset as Address] });
    const r = await sb.rpc("enqueue_keeper", { kind: "solvency.attest", target: lower(d.solvencyVerifier), calldata });
    if (r.error) throw r.error;
  }
  return { assets: assets?.length ?? 0 };
}

serveWorker(() => run());
