/**
 * Testnet run of the dashboard's protocol calls (src/lib/cordon.ts) on Robinhood Chain Testnet
 * (46630), through the live API, relayer and indexer:
 *
 *   deposit 2 TSLA notes -> 15-min standby -> bundle both -> claim income -> set an income term
 *   -> recombine -> lock up 2 min -> unlock -> withdraw
 *
 *   E2E_PRIVATE_KEY=<funded testnet key> bun test scripts/testnet-flow.test.ts --timeout 3600000
 *
 * Only the wallet signature, the API origin and circuit loading are stubbed. Skipped without a key.
 * Note: E2E_API defaults to production (usecordon.tech), which must run the same deployment.
 */
import { cordonPoolAbi, robinhoodChain } from "@cordon/shared";
import { commit, npk, ownerPkOf, randomField, underlying, type Note } from "@cordon/sdk";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, type Address } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { createConfig } from "wagmi";

import type { AppRouter } from "../src/server/trpc/router";
import type { Change, StoredNote } from "../src/lib/cordon";

const key = process.env.E2E_PRIVATE_KEY as `0x${string}` | undefined;
const deploymentJson = readFileSync(join(import.meta.dir, "../packages/shared/deployments/46630.json"), "utf8");
const d = JSON.parse(deploymentJson);
const rpc = "https://rpc.testnet.chain.robinhood.com/rpc";
const TSLA = d.testAssets.TSLA as Address;
const RAW = 10n * 10n ** 18n;

test.skipIf(!key)("dashboard protocol calls on testnet", async () => {
  const account = privateKeyToAccount(key!, { nonceManager });
  const robinhood = defineChain(robinhoodChain(rpc, 46630));
  const client = createPublicClient({ chain: robinhood, transport: http(rpc) });
  const wallet = createWalletClient({ chain: robinhood, account, transport: http(rpc) });

  mock.module("../src/lib/env", () => ({
    env: { deployment: deploymentJson, supabaseUrl: "set", rpcUrl: rpc },
    chainId: 46630,
    backendEnabled: true,
  }));
  mock.module("../src/lib/wallet", () => ({
    robinhood,
    wagmiConfig: createConfig({ chains: [robinhood], transports: { [robinhood.id]: http(rpc) } }),
    signWithWallet: (message: string) => account.signMessage({ message }),
  }));
  mock.module("../src/lib/trpc", () => ({
    trpc: createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${process.env.E2E_API ?? "https://usecordon.tech"}/api/trpc` })],
    }),
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    typeof input === "string" && input.startsWith("/circuits/")
      ? Promise.resolve(new Response(readFileSync(join(import.meta.dir, "../public", input))))
      : realFetch(input, init)) as typeof fetch;

  const c = await import("../src/lib/cordon");
  let notes: StoredNote[] = [];
  const keep = (ch: Change) => {
    const add = new Set(ch.add.map((n) => n.commit));
    notes = [
      ...notes.filter((n) => !add.has(n.commit)).map((n) => (ch.spent.includes(n.commit) ? { ...n, status: "spent" as const } : n)),
      ...ch.add,
    ];
  };
  const h = {
    keep,
    drop: (commits: string[]) => (notes = notes.filter((n) => !commits.includes(n.commit))),
    step: (s: string) => console.log(`  ${s}`),
  };
  const live = () => notes.filter((n) => n.status === "live");
  const run = async (label: string, f: () => Promise<Change>) => {
    const started = Date.now();
    const ch = await f();
    keep(ch);
    console.log(`${label}: tx ${ch.tx} (${Math.round((Date.now() - started) / 1000)} s)`);
    return ch;
  };

  // Deposit two notes (the browser path is the same approve + deposit, signed by the wallet).
  const pk = ownerPkOf(await c.spendingKey());
  const fresh = [underlying(TSLA, RAW, pk, randomField()), underlying(TSLA, RAW, pk, randomField())];
  const faucet = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const;
  const send = async (hash: Promise<`0x${string}`>) => client.waitForTransactionReceipt({ hash: await hash });
  await send(wallet.writeContract({ address: TSLA, abi: faucet, functionName: "mint", args: [account.address, 2n * RAW] }));
  await send(wallet.writeContract({ address: TSLA, abi: erc20Abi, functionName: "approve", args: [d.pool, 2n * RAW] }));
  for (const n of fresh) {
    await send(wallet.writeContract({ address: d.pool, abi: cordonPoolAbi, functionName: "deposit", args: [TSLA, RAW, npk(n)] }));
  }
  notes = fresh.map((n) => ({ ...stored(n), status: "pending" as const }));
  console.log("deposited 2 × 10 TSLA; waiting for standby + clearer");

  for (let i = 0; notes.some((n) => n.status === "pending"); i++) {
    if (i > 150) throw new Error("deposits never reached the tree");
    await new Promise((r) => setTimeout(r, 10_000));
    const ids = await c.indexed(notes);
    notes = notes.map((n) => (ids.includes(n.commit) ? { ...n, status: "live" as const } : n));
  }

  const [a, b] = notes;
  await run("bundle A", () => c.bundle(a, h));
  await run("bundle B", () => c.bundle(b, h));
  const bundleIds = [...new Set(live().filter((n) => n.kind === "1").map((n) => n.bundleId))];
  expect(bundleIds.length).toBe(2);

  const incomeOf = (id: string) => live().find((n) => n.bundleId === id && n.kind === "2")!;
  await run("claim income A", () => c.claimIncome(incomeOf(bundleIds[0]), h, { force: true }));
  const until = BigInt(Math.floor(Date.now() / 1000)) + 86_400n;
  await run("income term B", () => c.setIncomeTerm(incomeOf(bundleIds[1]), until, h));
  expect(live().filter((n) => n.bundleId === bundleIds[1] && n.kind === "2").length).toBe(2);

  await run("recombine A", () => c.unbundle(notes, bundleIds[0], h));
  const out = live().find((n) => n.kind === "0")!;
  expect(BigInt(out.raw)).toBeGreaterThan(0n);

  await run("lock up", () => c.encumber(out, { kind: "LOCKUP", until: BigInt(Math.floor(Date.now() / 1000)) + 120n }, h));
  const locked = live().find((n) => n.lock !== "0")!;
  for (let i = 0; ; i++) {
    try {
      await run("unlock", () => c.unlock(locked, h));
      break;
    } catch (e) {
      if (!String(e).includes("Locked until") || i > 30) throw e;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  const free = live().find((n) => n.kind === "0" && n.lock === "0")!;
  const before = await client.readContract({ address: TSLA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  await run("withdraw", () => c.withdraw(free, account.address, h, "whole"));
  const after = await client.readContract({ address: TSLA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  expect(after - before).toBe(BigInt(free.raw));
});

function stored(n: Note): StoredNote {
  return {
    ...(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)])) as Record<keyof Note, string>),
    commit: commit(n).toString(),
    status: "live",
  };
}
