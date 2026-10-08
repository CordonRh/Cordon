// vault-registrar (testnet): schedules NavAttestor.registerVault for every requested
// vault through the 24h timelock, and executes the ones whose delay has passed, so
// users don't wait for ops. Same logic as scripts/register-vaults.ts.
// Note: signs with the timelock admin key (ADMIN_PRIVATE_KEY); on mainnet the
// 2-of-3 Safe proposes instead, so leave that secret unset there and this is a no-op.
import { createWalletClient, encodeFunctionData, http, parseAbi, zeroHash, type Address, type Hex } from "npm:viem@2.56.9";
import { nonceManager, privateKeyToAccount } from "npm:viem@2.56.9/accounts";
import { chain, need, type Client, type Db, db, deployment, publicClient, serveWorker } from "../_shared/env.ts";

const tl = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
  "function registerVault(bytes32 vaultId, address manager, uint256 vaultPk)",
]);

/** The timelock admin signer, or undefined when ADMIN_PRIVATE_KEY is unset (mainnet). */
export function adminWallet() {
  const key = Deno.env.get("ADMIN_PRIVATE_KEY");
  if (!key) return undefined;
  return createWalletClient({
    chain,
    account: privateKeyToAccount(key as Hex, { nonceManager }),
    transport: http(need("RPC_URL_4663")),
  });
}

/** Schedules or executes NavAttestor.registerVault through the timelock for every vault request. */
export async function run(
  wallet = adminWallet(),
  io = wallet && {
    d: deployment() as ReturnType<typeof deployment> & { timelock: Address },
    sb: db() as Db,
    client: publicClient() as Client,
  },
) {
  if (!wallet || !io) return { skipped: "ADMIN_PRIVATE_KEY not set" };
  const { d, sb, client } = io;
  const { data: requests, error } = await sb.from("vault_requests").select("vault_id,manager,vault_pk");
  if (error) throw error;
  const delay = await client.readContract({ address: d.timelock, abi: tl, functionName: "getMinDelay" });

  const results = [];
  for (const r of requests ?? []) {
    const data = encodeFunctionData({
      abi: tl, functionName: "registerVault", args: [r.vault_id, r.manager, BigInt(r.vault_pk)],
    });
    const args = [d.navAttestor, 0n, data, zeroHash, r.vault_id as Hex] as const;
    const id = await client.readContract({ address: d.timelock, abi: tl, functionName: "hashOperation", args });
    const read = (functionName: "isOperation" | "isOperationReady" | "isOperationDone") =>
      client.readContract({ address: d.timelock, abi: tl, functionName, args: [id] });
    if (await read("isOperationDone")) continue;
    let hash: Hex;
    let status: string;
    if (await read("isOperationReady")) {
      hash = await wallet.writeContract({ address: d.timelock, abi: tl, functionName: "execute", args });
      status = "registered";
    } else if (!(await read("isOperation"))) {
      hash = await wallet.writeContract({ address: d.timelock, abi: tl, functionName: "schedule", args: [...args, delay] });
      status = "scheduled";
    } else continue;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${r.vault_id}: ${status} tx ${hash} reverted`);
    const u = await sb.from("vault_requests").update({ scheduled: true }).eq("vault_id", r.vault_id);
    if (u.error) throw u.error;
    results.push({ vault: r.vault_id, status, tx: hash });
  }
  return results;
}

serveWorker(() => run());
