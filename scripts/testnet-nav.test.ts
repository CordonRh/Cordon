/**
 * NAV attestation on Robinhood Chain Testnet (46630) through src/lib/cordon.ts, in two phases
 * because vault registration waits out the 24h timelock:
 *
 *   NAV_PHASE=deposit E2E_PRIVATE_KEY=<key> bun test scripts/testnet-nav.test.ts --timeout 3600000
 *     deposits a TSLA note for the wallet's vault and saves it (E2E_STATE, default .scratch/nav-state.json)
 *   (run scripts/register-vaults.ts once the timelock allows)
 *   NAV_PHASE=attest E2E_PRIVATE_KEY=<key> bun test scripts/testnet-nav.test.ts --timeout 3600000
 *     proves NAV over the saved note and attests it from the wallet (the vault manager)
 */
import { cordonPoolAbi, robinhoodChain } from "@cordon/shared";
import { commit, npk, ownerPkOf, randomField, underlying, type Note } from "@cordon/sdk";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { expect, mock, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, type Address } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { createConfig } from "wagmi";

import type { StoredNote } from "../src/lib/cordon";
import type { AppRouter } from "../src/server/trpc/router";

const key = process.env.E2E_PRIVATE_KEY as `0x${string}` | undefined;
const phase = process.env.NAV_PHASE;
const state = process.env.E2E_STATE ?? join(import.meta.dir, "../.scratch/nav-state.json");
const deploymentJson = readFileSync(join(import.meta.dir, "../packages/shared/deployments/46630.json"), "utf8");
const d = JSON.parse(deploymentJson);
const rpc = "https://rpc.testnet.chain.robinhood.com/rpc";
const TSLA = d.testAssets.TSLA as Address;
const RAW = 4n * 10n ** 18n; // 4 TSLA = $1,000 at the mock feed

test.skipIf(!key || !phase)(`NAV on testnet: ${phase}`, async () => {
  const account = privateKeyToAccount(key!, { nonceManager });
  const robinhood = defineChain(robinhoodChain(rpc, 46630));
  const client = createPublicClient({ chain: robinhood, transport: http(rpc) });
  const wallet = createWalletClient({ chain: robinhood, account, transport: http(rpc) });

  mock.module("../src/lib/env", () => ({ env: { deployment: deploymentJson, supabaseUrl: "set", rpcUrl: rpc }, chainId: 46630, backendEnabled: true }));
  mock.module("../src/lib/wallet", () => ({
    robinhood,
    wagmiConfig: createConfig({ chains: [robinhood], transports: { [robinhood.id]: http(rpc) } }),
    signWithWallet: (message: string) => account.signMessage({ message }),
  }));
  mock.module("../src/lib/trpc", () => ({
    trpc: createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${process.env.E2E_API ?? "https://usecordon.tech"}/api/trpc` })] }),
  }));
  // The dashboard signs attest() with the connected wallet; here the key signs it.
  const actions = await import("wagmi/actions");
  mock.module("wagmi/actions", () => ({
    ...actions,
    writeContract: (_: unknown, args: Parameters<typeof wallet.writeContract>[0]) => wallet.writeContract(args),
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    typeof input === "string" && input.startsWith("/circuits/")
      ? Promise.resolve(new Response(readFileSync(join(import.meta.dir, "../public", input))))
      : realFetch(input, init)) as typeof fetch;
  const c = await import("../src/lib/cordon");

  if (phase === "deposit") {
    const n = underlying(TSLA, RAW, ownerPkOf(await c.spendingKey()), randomField());
    const faucet = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const;
    for (const tx of [
      () => wallet.writeContract({ address: TSLA, abi: faucet, functionName: "mint", args: [account.address, RAW] }),
      () => wallet.writeContract({ address: TSLA, abi: erc20Abi, functionName: "approve", args: [d.pool, RAW] }),
      () => wallet.writeContract({ address: d.pool, abi: cordonPoolAbi, functionName: "deposit", args: [TSLA, RAW, npk(n)] }),
    ]) await client.waitForTransactionReceipt({ hash: await tx() });
    writeFileSync(state, JSON.stringify([stored(n)]));
    console.log(`deposited 4 TSLA for the vault; note saved to ${state}`);
    return;
  }

  if (!existsSync(state)) throw new Error(`run NAV_PHASE=deposit first (${state})`);
  const notes = JSON.parse(readFileSync(state, "utf8")) as StoredNote[];
  const before = await c.vaultState(account.address);
  expect(before.registered).toBe(true);
  const r = await c.attestNav({ wallet: account.address, notes, shares: 100n, liabilitiesUsd: 0 }, { step: (s) => console.log(`  ${s}`) });
  const after = await c.vaultState(account.address);
  expect(after.epoch).toBe(before.epoch + 1);
  // 4 TSLA × $250 over 100 shares = $10 per share.
  expect(Number(after.navPerShare18) / 1e18).toBeCloseTo(10, 6);
  console.log(`epoch ${r.epoch}: $${Number(r.navPerShare18) / 1e18} per share (tx ${r.tx})`);
});

function stored(n: Note): StoredNote {
  return {
    ...(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)])) as Record<keyof Note, string>),
    commit: commit(n).toString(),
    status: "live",
  };
}
