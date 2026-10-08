/**
 * Governance step for NAV vaults (testnet): schedules NavAttestor.registerVault for every
 * requested vault through the 24h timelock, and executes the ones whose delay has passed.
 * Run it again after 24h; it is idempotent (the timelock itself says what is scheduled).
 *
 *   ADMIN_PRIVATE_KEY=<timelock proposer/executor> bun scripts/register-vaults.ts
 *
 * Env: ADMIN_PRIVATE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (vault_requests is public).
 */
import { navAttestorAbi, robinhoodChain } from "@cordon/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const d = JSON.parse(readFileSync(join(import.meta.dir, "../packages/shared/deployments/46630.json"), "utf8"));
const rpc = "https://rpc.testnet.chain.robinhood.com/rpc";
const chain = robinhoodChain(rpc, 46630);
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, account: privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY as Hex), transport: http(rpc) });
const supabase = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
if (!supabase || !anon) throw new Error("set SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key)");

const timelock = d.timelock as Address;
const tl = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
]);

const requests = (await (
  await fetch(`${supabase}/rest/v1/vault_requests?select=vault_id,manager,vault_pk`, { headers: { apikey: anon } })
).json()) as { vault_id: Hex; manager: Address; vault_pk: Hex }[];
const delay = await client.readContract({ address: timelock, abi: tl, functionName: "getMinDelay" });

for (const r of requests) {
  const data = encodeFunctionData({ abi: navAttestorAbi, functionName: "registerVault", args: [r.vault_id, r.manager, BigInt(r.vault_pk)] });
  const args = [d.navAttestor, 0n, data, zeroHash, r.vault_id] as const;
  const id = await client.readContract({ address: timelock, abi: tl, functionName: "hashOperation", args });
  const read = (functionName: "isOperation" | "isOperationReady" | "isOperationDone") =>
    client.readContract({ address: timelock, abi: tl, functionName, args: [id] });
  if (await read("isOperationDone")) continue;
  let hash: Hex;
  if (await read("isOperationReady")) hash = await wallet.writeContract({ address: timelock, abi: tl, functionName: "execute", args });
  else if (!(await read("isOperation"))) hash = await wallet.writeContract({ address: timelock, abi: tl, functionName: "schedule", args: [...args, delay] });
  else {
    console.log(`${r.vault_id}: scheduled, waiting for the timelock`);
    continue;
  }
  await client.waitForTransactionReceipt({ hash });
  console.log(`${r.vault_id}: ${(await read("isOperationDone")) ? "registered" : `scheduled (executable in ${delay / 3600n}h)`} (tx ${hash})`);
}
console.log(`${requests.length} request(s) checked`);
