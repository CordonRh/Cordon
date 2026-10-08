// solvency: every 10 minutes, enqueue SolvencyVerifier.attest(asset) for every registered
// asset whose last attestation is at least an epoch old. A deficit makes the call revert,
// which the relayer records as a failed job.
import { encodeFunctionData, type Address } from "npm:viem@2.56.9";
import { solvencyVerifierAbi } from "../_shared/abis.ts";
import { type Client, type Db, db, deployment, lower, publicClient, serveWorker } from "../_shared/env.ts";

/** SolvencyVerifier.EPOCH: an attestation sooner than this after the last one reverts. */
const EPOCH = 3600n;

/**
 * Enqueues SolvencyVerifier.attest for every registered asset that is due. Running more often
 * than the epoch and skipping assets that are not due keeps attestations about an hour apart;
 * an hourly run at a fixed minute drifted behind the last attestation and reverted TooEarly.
 */
export async function run(
  d = deployment(),
  sb: Db = db(),
  client: Pick<Client, "readContract"> = publicClient(),
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  const { data: assets, error } = await sb.from("assets").select("asset");
  if (error) throw error;
  let queued = 0;
  for (const { asset } of assets ?? []) {
    const [, ts] = await client.readContract({
      address: d.solvencyVerifier as Address,
      abi: solvencyVerifierAbi,
      functionName: "latest",
      args: [asset as Address],
    });
    if (ts !== 0n && now < ts + EPOCH) continue;
    const calldata = encodeFunctionData({ abi: solvencyVerifierAbi, functionName: "attest", args: [asset as Address] });
    const r = await sb.rpc("enqueue_keeper", { kind: "solvency.attest", target: lower(d.solvencyVerifier), calldata });
    if (r.error) throw r.error;
    queued++;
  }
  return { assets: assets?.length ?? 0, queued };
}

serveWorker(() => run());
