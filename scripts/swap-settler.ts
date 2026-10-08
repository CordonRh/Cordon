/**
 * Governance step (testnet): makes NEW_SETTLER the DvP engine and retires the one in
 * deployments/46630.json, as one timelock batch. Run once to schedule; run again after
 * the 24h delay to execute. Then point deployments/46630.json (and the CORDON_DEPLOYMENT
 * secrets) at the new settler.
 *
 *   ADMIN_PRIVATE_KEY=<timelock proposer/executor> NEW_SETTLER=<address> bun scripts/swap-settler.ts
 */
import { cordonControlAbi, robinhoodChain } from "@cordon/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const d = JSON.parse(readFileSync(join(import.meta.dir, "../packages/shared/deployments/46630.json"), "utf8"));
const rpc = "https://rpc.testnet.chain.robinhood.com/rpc";
const chain = robinhoodChain(rpc, 46630);
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, account: privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY as Hex), transport: http(rpc) });
const next = process.env.NEW_SETTLER as Address;
if (!next) throw new Error("set NEW_SETTLER");

const tl = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) payable",
]);
const setEngine = (engine: Address, on: boolean) =>
  encodeFunctionData({ abi: cordonControlAbi, functionName: "setEngine", args: [engine, on] });
const args = [
  [d.control, d.control] as Address[],
  [0n, 0n],
  [setEngine(next, true), setEngine(d.dvpSettler, false)],
  zeroHash,
  zeroHash,
] as const;

const read = async (fn: "isOperation" | "isOperationReady" | "isOperationDone") =>
  client.readContract({ address: d.timelock, abi: tl, functionName: fn, args: [await client.readContract({ address: d.timelock, abi: tl, functionName: "hashOperationBatch", args })] });

if (await read("isOperationDone")) console.log("already done");
else if (await read("isOperationReady")) {
  const hash = await wallet.writeContract({ address: d.timelock, abi: tl, functionName: "executeBatch", args });
  await client.waitForTransactionReceipt({ hash });
  console.log(`executed: ${next} is the DvP engine (tx ${hash})`);
} else if (await read("isOperation")) console.log("scheduled, waiting for the timelock");
else {
  const delay = await client.readContract({ address: d.timelock, abi: tl, functionName: "getMinDelay" });
  const hash = await wallet.writeContract({ address: d.timelock, abi: tl, functionName: "scheduleBatch", args: [...args, delay] });
  await client.waitForTransactionReceipt({ hash });
  const block = await client.getBlock();
  console.log(`scheduled (tx ${hash}); executable after ${new Date(Number(block.timestamp + delay) * 1000).toISOString()}`);
}
