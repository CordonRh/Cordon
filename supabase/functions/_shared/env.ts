// Shared setup for the Cordon workers (Supabase Edge Functions, Deno).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "npm:viem@2.56.9";
import { nonceManager, privateKeyToAccount } from "npm:viem@2.56.9/accounts";

/** Contract addresses of one deployment (packages/shared/deployments/<chainId>.json). */
export type Deployment = {
  chainId: number;
  pool: Address;
  bundleVerifier: Address;
  actionEngine: Address;
  assetGate: Address;
  control: Address;
  dvpSettler: Address;
  priceOracle: Address;
  encumbranceRegistry: Address;
  navAttestor: Address;
  solvencyVerifier: Address;
  crdnStaking: Address;
  screeningGate: Address;
  deployBlock?: number;
};

/** The env var `k`, or a thrown "missing secret" error when it is unset. */
export const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

/** CORDON_DEPLOYMENT holds packages/shared/deployments/<chainId>.json. */
export const deployment = (): Deployment => JSON.parse(need("CORDON_DEPLOYMENT"));

/** The configured chain (id from CORDON_DEPLOYMENT, default 4663). */
export const chain = defineChain({
  id: Number(JSON.parse(Deno.env.get("CORDON_DEPLOYMENT") ?? "{}").chainId ?? 4663),
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

/** Read-only client for the configured chain. */
export const publicClient = () => createPublicClient({ chain, transport: http(need("RPC_URL_4663")) });

const signer = (key: string) =>
  createWalletClient({
    chain,
    account: privateKeyToAccount(key as `0x${string}`, { nonceManager }),
    transport: http(need("RPC_URL_4663")),
  });

/** Relayer signer for users' relayed calls: pays gas, holds no role. */
export const walletClient = () => signer(need("RELAYER_PRIVATE_KEY"));

/** Keeper signer (the address CordonControl registers as keeper). Never the relayer key:
 *  user relays must not be able to drain the keeper's gas. */
export const keeperClient = () => signer(need("KEEPER_PRIVATE_KEY"));

/** Service-role Supabase client (workers only). */
export const db = () =>
  createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The service-role Supabase client the workers take. */
export type Db = ReturnType<typeof db>;
/** The read-only chain client the workers take. */
export type Client = ReturnType<typeof publicClient>;

/** A uint256 as 0x-prefixed 32-byte hex. */
export const hex32 = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;
/** Lower-cases an address. */
export const lower = (a: string) => a.toLowerCase();

/** Runs a worker body and answers the cron call with its summary or error. */
export const serveWorker = (run: () => Promise<unknown>) =>
  Deno.serve(async () => {
    try {
      return Response.json({ ok: true, result: await run() });
    } catch (e) {
      console.error(e);
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  });
