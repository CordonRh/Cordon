/**
 * Two-wallet testnet run of the dashboard's protocol calls (src/lib/cordon.ts) on Robinhood
 * Chain Testnet (46630), through the live API, relayer, keeper, indexer and hosted sequencer:
 *
 *   A deposits 2 TSLA + 1 USDG notes -> A sends the USDG note to B (inbox)
 *   -> PLEDGE to B's pledge code, B releases, A unlocks -> LIEN to a new pledge code of B,
 *   B requests default, B enforces -> DvP: A gives 4 TSLA for B's 1,000 USDG, both rebuild
 *   their results from the chain -> A signs in and requests a NAV vault
 *
 *   E2E_PRIVATE_KEY=<funded testnet key> E2E_SUPABASE_URL=<project URL> E2E_SUPABASE_ANON_KEY=<publishable key>  *     bun test scripts/testnet-parties.test.ts --timeout 3600000
 *
 * B is a fresh key: everything it does is relayed or sequenced, so it needs no gas.
 */
import { cordonPoolAbi, robinhoodChain } from "@cordon/shared";
import { commit, npk, ownerPkOf, randomField, underlying, type Note } from "@cordon/sdk";
import { createClient } from "@supabase/supabase-js";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, type Address } from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { createConfig } from "wagmi";

import type { Change, Held, StoredNote } from "../src/lib/cordon";
import type { AppRouter } from "../src/server/trpc/router";

const key = process.env.E2E_PRIVATE_KEY as `0x${string}` | undefined;
const api = process.env.E2E_API ?? "https://usecordon.tech";
const deploymentJson = readFileSync(join(import.meta.dir, "../packages/shared/deployments/46630.json"), "utf8");
const d = JSON.parse(deploymentJson);
const rpc = "https://rpc.testnet.chain.robinhood.com/rpc";
const TSLA = d.testAssets.TSLA as Address;
const USDG = d.testAssets.USDG as Address;
const RAW = 10n * 10n ** 18n; // 10 TSLA = $2,500
const USD = 1000n * 10n ** 6n; // 1,000 USDG (the faucet cap per mint)
const SOLD = 4n * 10n ** 18n; // 4 TSLA = $1,000, from a 10 TSLA note (6 come back as change)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.skipIf(!key)("two wallets on testnet: send, pledge, lien, DvP, vault", async () => {
  const A = privateKeyToAccount(key!, { nonceManager });
  const B = privateKeyToAccount(generatePrivateKey());
  let who: PrivateKeyAccount = A;
  const robinhood = defineChain(robinhoodChain(rpc, 46630));
  const client = createPublicClient({ chain: robinhood, transport: http(rpc) });
  const wallet = createWalletClient({ chain: robinhood, account: A, transport: http(rpc) });

  mock.module("../src/lib/env", () => ({ env: { deployment: deploymentJson, supabaseUrl: "set", rpcUrl: rpc }, chainId: 46630, backendEnabled: true }));
  mock.module("../src/lib/wallet", () => ({
    robinhood,
    wagmiConfig: createConfig({ chains: [robinhood], transports: { [robinhood.id]: http(rpc) } }),
    signWithWallet: (message: string) => who.signMessage({ message }),
  }));
  // The wallet session (Supabase web3 sign-in), as the dashboard's Sync attaches it.
  let token: string | undefined;
  mock.module("../src/lib/trpc", () => ({
    trpc: createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${api}/api/trpc`, headers: () => (token ? { authorization: `Bearer ${token}` } : {}) })],
    }),
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    typeof input === "string" && input.startsWith("/circuits/")
      ? Promise.resolve(new Response(readFileSync(join(import.meta.dir, "../public", input))))
      : realFetch(input, init)) as typeof fetch;
  const c = await import("../src/lib/cordon");

  // One workspace per wallet, merged the way the dashboard merges a Change.
  const ws = new Map<PrivateKeyAccount, { notes: StoredNote[]; inbox: number; held: Held[] }>([
    [A, { notes: [], inbox: 0, held: [] }],
    [B, { notes: [], inbox: 0, held: [] }],
  ]);
  const as = async (acct: PrivateKeyAccount) => {
    if (who !== acct) c.forgetKey();
    who = acct;
    return ws.get(acct)!;
  };
  const keep = (w: { notes: StoredNote[] }) => (ch: Change) => {
    const add = new Set(ch.add.map((n) => n.commit));
    w.notes = [...w.notes.filter((n) => !add.has(n.commit)).map((n) => (ch.spent.includes(n.commit) ? { ...n, status: "spent" as const } : n)), ...ch.add];
  };
  const hooks = (w: { notes: StoredNote[] }) => ({ keep: keep(w), drop: (x: string[]) => (w.notes = w.notes.filter((n) => !x.includes(n.commit))) });
  const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
  const live = (w: { notes: StoredNote[] }) => w.notes.filter((n) => n.status === "live");
  const settle = async (w: { notes: StoredNote[] }) => {
    for (let i = 0; w.notes.some((n) => n.status === "pending"); i++) {
      if (i > 720) throw new Error("notes never reached the tree"); // 2 h: covers an indexer catching up
      const ids = await c.indexed(w.notes).catch(() => [] as string[]); // a dropped request is retried next round
      w.notes = w.notes.map((n) => (ids.includes(n.commit) ? { ...n, status: "live" as const } : n));
      if (w.notes.some((n) => n.status === "pending")) await sleep(10_000);
    }
  };
  const inbox = async (acct: PrivateKeyAccount) => {
    const w = await as(acct);
    const { cursor, items } = await c.readInbox(w.inbox);
    w.inbox = cursor;
    return items;
  };

  // ---- A deposits TSLA ×2 and USDG ×1
  const a = ws.get(A)!;
  const b = ws.get(B)!;
  const pkA = ownerPkOf(await c.spendingKey());
  const deposits = [underlying(TSLA, RAW, pkA, randomField()), underlying(TSLA, RAW, pkA, randomField()), underlying(USDG, USD, pkA, randomField())];
  const faucet = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const;
  const send = async (hash: Promise<`0x${string}`>) => client.waitForTransactionReceipt({ hash: await hash });
  await send(wallet.writeContract({ address: TSLA, abi: faucet, functionName: "mint", args: [A.address, 2n * RAW] }));
  await send(wallet.writeContract({ address: USDG, abi: faucet, functionName: "mint", args: [A.address, USD] }));
  await send(wallet.writeContract({ address: TSLA, abi: erc20Abi, functionName: "approve", args: [d.pool, 2n * RAW] }));
  await send(wallet.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [d.pool, USD] }));
  for (const n of deposits) {
    await send(wallet.writeContract({ address: d.pool, abi: cordonPoolAbi, functionName: "deposit", args: [addr(n.asset), n.raw, npk(n)] }));
  }
  a.notes = deposits.map((n) => ({ ...stored(n), status: "pending" as const }));
  log("A deposited 2 TSLA notes + 1 USDG note; waiting for standby");
  await settle(a);
  const [t1, t2, u] = a.notes;

  // ---- send: A -> B
  await as(B);
  const keyB = await c.cordonKey();
  await as(A);
  keep(a)(await c.send(u, USD, keyB, hooks(a)));
  log("A sent the USDG note to B");
  const got = (await inbox(B)).filter((x) => x.t === "notes").flatMap((x) => (x.t === "notes" ? x.add : []));
  expect(got.length).toBe(1);
  b.notes.push(...got);
  await settle(b);
  expect(live(b)[0].raw).toBe(USD.toString());
  log("B received it");

  // ---- PLEDGE to B's pledge code -> B releases -> A unlocks
  const day = BigInt(Math.floor(Date.now() / 1000)) + 86_400n;
  await as(B);
  const codeP = await c.pledgeCode();
  await as(A);
  keep(a)(await c.encumber(t2, { kind: "PLEDGE", until: day, holder: codeP, obligation: "test loan" }, hooks(a)));
  const pledge = (await inbox(B)).find((x) => x.t === "held") as Held;
  expect(pledge).toBeDefined();
  await as(B);
  await c.release(pledge, {});
  expect(await c.heldState(pledge)).toBe("released");
  await as(A);
  const lockedP = live(a).find((n) => n.lock !== "0")!;
  keep(a)(await c.unlock(lockedP, hooks(a)));
  log("pledge: released by B, unlocked by A");

  // ---- LIEN to a new pledge code of B (codes are single-use) -> default -> B enforces
  await as(B);
  const codeL = await c.pledgeCode();
  await as(A);
  const freed = live(a).find((n) => n.asset === BigInt(TSLA).toString() && n.lock === "0" && n.commit !== t1.commit)!;
  keep(a)(await c.encumber(freed, { kind: "LIEN", until: day, holder: codeL, obligation: "test lien" }, hooks(a)));
  const lien = (await inbox(B)).find((x) => x.t === "held") as Held;
  await as(B);
  for (let i = 0; ; i++) {
    try {
      await c.requestDefault(lien);
      break;
    } catch (e) {
      if (i > 12) throw e;
      await sleep(10_000); // the Encumbered event is not indexed yet
    }
  }
  for (let i = 0; (await c.heldState(lien)) !== "defaulted"; i++) {
    if (i > 30) throw new Error("the keeper never declared the default");
    await sleep(10_000);
  }
  keep(b)(await c.enforce(lien, hooks(b)));
  expect(await c.heldState(lien)).toBe("enforced");
  await as(A);
  const lockedL = live(a).find((n) => n.lock !== "0")!;
  const res = await c.unlock(lockedL, hooks(a));
  expect(res.message).toContain("enforced");
  keep(a)(res);
  log("lien: default declared, enforced by B");

  // ---- DvP: A gives 4 TSLA (of a 10 TSLA note), B gives 1,000 USDG
  await as(A);
  const orders = new Map<PrivateKeyAccount, string>();
  orders.set(A, await c.placeOrder({ notes: a.notes, give: TSLA, raw: SOLD, want: USDG, ref: "order-a" }));
  await as(B);
  await settle(b);
  orders.set(B, await c.placeOrder({ notes: b.notes, give: USDG, raw: USD, want: TSLA, ref: "order-b" }));
  log("DvP orders placed; waiting for a batch");
  // Results come from the chain (TradeSettled memos), not from the sequencer.
  const results = new Map<PrivateKeyAccount, Change>();
  for (let i = 0; results.size < 2; i++) {
    if (i > 40) throw new Error("no DvP batch settled the orders");
    await sleep(15_000);
    for (const [acct, order] of orders) {
      if (results.has(acct)) continue;
      const r = await c.recoverOrder(order);
      if (r?.expired) throw new Error("a DvP order expired unsettled");
      if (r) results.set(acct, r);
    }
  }
  keep(a)(results.get(A)!);
  keep(b)(results.get(B)!);
  await settle(a);
  await settle(b);
  expect(live(a).some((n) => n.asset === BigInt(USDG).toString() && n.raw === USD.toString())).toBe(true);
  expect(live(b).some((n) => n.asset === BigInt(TSLA).toString() && n.raw === SOLD.toString())).toBe(true);
  expect(live(a).some((n) => n.asset === BigInt(TSLA).toString() && n.raw === (RAW - SOLD).toString())).toBe(true);
  log(`DvP settled (tx ${results.get(A)!.tx})`);

  // ---- NAV vault request: needs A signed in (the server binds the vault to that wallet);
  // the vault-registrar worker schedules it in the 24h timelock and executes it after.
  await as(A);
  token = await signIn(A);
  await c.requestVault(A.address);
  expect((await c.vaultState(A.address)).requested).toBe(true);
  log("vault requested");
});

/** Supabase web3 sign-in with a SIWE message signed by the key (the dashboard's Sync does the same with the wallet). */
async function signIn(acct: PrivateKeyAccount) {
  const anon = process.env.E2E_SUPABASE_ANON_KEY;
  const sbUrl = process.env.E2E_SUPABASE_URL;
  if (!anon || !sbUrl) throw new Error("set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY (the project's publishable key) to sign in");
  const sb = createClient(sbUrl, anon, { auth: { persistSession: false } });
  const url = new URL(api);
  const message = createSiweMessage({
    address: acct.address,
    chainId: 46630,
    domain: url.host,
    uri: url.origin,
    nonce: generateSiweNonce(),
    issuedAt: new Date(),
    version: "1",
    statement: "Sign in to Cordon (testnet E2E).",
  });
  const { data, error } = await sb.auth.signInWithWeb3({ chain: "ethereum", message, signature: await acct.signMessage({ message }) });
  if (error) throw error;
  return data.session!.access_token;
}

const addr = (f: bigint) => `0x${f.toString(16).padStart(40, "0")}` as Address;
function stored(n: Note): StoredNote {
  return {
    ...(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)])) as Record<keyof Note, string>),
    commit: commit(n).toString(),
    status: "live",
  };
}
