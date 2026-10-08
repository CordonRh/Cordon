/**
 * nav-prover (spec §4): run by a vault manager every epoch (1h/24h cron). Values the
 * vault's notes at the latest oracle rounds, proves NAV and calls NavAttestor.attest.
 * Holdings never leave the manager's host.
 *
 *   VAULT_NOTES=./vault-notes.json bun services/nav-prover/src/attest.ts
 *
 * vault-notes.json: { vaultId, totalShares, queueUsdg, liabilities27, notes: Note[] }
 * with bigint fields as decimal strings. Env: RPC_URL_4663, MANAGER_PRIVATE_KEY,
 * VAULT_SK, NAV_ATTESTOR, PRICE_ORACLE, SUPABASE_URL, SUPABASE_ANON_KEY, CIRCUITS_DIR.
 */
import { initHasher, navArgs, navInputs, NoteTree, ownerPkOf, Prover, toHex, type Note } from "@cordon/sdk";
import { navAttestorAbi, priceOracleAbi, robinhoodChain } from "@cordon/shared";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

/** vault-notes.json: bigint fields as decimal strings. */
export type VaultFile = {
  vaultId: Hex;
  totalShares: string;
  queueUsdg: string;
  liabilities27: string;
  notes: Record<string, string>[];
};

/** The vault's notes from its file, every field a bigint. */
export const parseNotes = (file: VaultFile): Note[] =>
  file.notes.map((n) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, BigInt(v)])) as Note);

/** Every commitment leaf from the public commitments feed (Merkle paths), 1000 per page. */
export async function fetchLeaves(supabase: string, anon: string) {
  const leaves: bigint[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${supabase}/rest/v1/commitments?select=commit&leaf=gte.${from}&order=leaf&limit=1000`, {
      headers: { apikey: anon },
    });
    const page = (await res.json()) as { commit: string }[];
    leaves.push(...page.map((r) => BigInt(r.commit)));
    if (page.length < 1000) return leaves;
  }
}

/** The manager's chain clients: reads at `rpc`, signs attestations with `key`. */
export const chainClients = (rpc: string, key: Hex) => {
  const chain = robinhoodChain(rpc, Number(process.env.CHAIN_ID ?? 4663));
  return {
    client: createPublicClient({ chain, transport: http(rpc) }),
    wallet: createWalletClient({ chain, account: privateKeyToAccount(key), transport: http(rpc) }),
  };
};

/** Everything one attestation run touches outside memory; tests pass fakes. */
export type Deps = ReturnType<typeof chainClients> & {
  prover: Pick<Prover, "prove">;
  nav: Address;
  oracle: Address;
  vaultSk: bigint;
  file: VaultFile;
  leaves: () => Promise<bigint[]>;
};

// One fresh round per held asset; PriceOracle reverts on stale rounds (fail-closed).
const feedAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] },
] as const;

/** Values the vault's notes at the latest rounds, proves NAV for the next epoch and calls NavAttestor.attest. */
export async function attest({ client, wallet, prover, nav, oracle, vaultSk, file, leaves }: Deps) {
  const notes = parseNotes(file);
  const tree = new NoteTree(await leaves());

  const assets = [...new Set(notes.map((n) => n.asset))];
  const priced: { asset: bigint; price: bigint; roundId: bigint; address: Address }[] = [];
  for (const a of assets) {
    const asset = `0x${a.toString(16).padStart(40, "0")}` as Address;
    const [feed] = await client.readContract({ address: oracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
    const [roundId] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const price = await client.readContract({ address: oracle, abi: priceOracleAbi, functionName: "rawPrice", args: [asset, roundId] });
    priced.push({ asset: a, price, roundId, address: asset });
  }

  const vault = await client.readContract({ address: nav, abi: navAttestorAbi, functionName: "vaults", args: [file.vaultId] });
  const epoch = BigInt(vault[2]) + 1n;
  const totalShares = BigInt(file.totalShares);
  const liabilities27 = BigInt(file.liabilities27);
  const queueUsdg = BigInt(file.queueUsdg);

  const { navPerShare, inputs } = navInputs({
    tree, vaultSk, vaultPk: ownerPkOf(vaultSk), epoch, totalShares, liabilities27, prices: priced, holdings: notes,
  });
  const p = await prover.prove("nav", inputs);

  const prices = Array.from({ length: 16 }, (_, i) => ({
    asset: priced[i]?.address ?? ("0x0000000000000000000000000000000000000000" as Address),
    roundId: priced[i]?.roundId ?? 0n,
  }));
  const a = navArgs(p.publicInputs, { epoch, navPerShare, totalShares, liabilities27, queueUsdg });
  const hash = await wallet.writeContract({
    address: nav,
    abi: navAttestorAbi,
    functionName: "attest",
    args: [file.vaultId, { ...a, epoch: Number(a.epoch) } as never, prices as never, toHex(p.proof)],
  });
  await client.waitForTransactionReceipt({ hash });
  return { epoch, navPerShare, hash };
}

if (import.meta.main) {
  await initHasher();
  const rpc = env("RPC_URL_4663");
  const clients = chainClients(rpc, env("MANAGER_PRIVATE_KEY") as Hex);
  const nav = env("NAV_ATTESTOR") as Address;
  const oracle = env("PRICE_ORACLE") as Address;
  const vaultSk = BigInt(env("VAULT_SK"));
  const file = JSON.parse(await readFile(env("VAULT_NOTES"), "utf8")) as VaultFile;
  const circuitsDir = env("CIRCUITS_DIR");
  const { epoch, navPerShare, hash } = await attest({
    ...clients, nav, oracle, vaultSk, file,
    leaves: () => fetchLeaves(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY")),
    prover: new Prover(async (n) => JSON.parse(await readFile(join(circuitsDir, `${n}.json`), "utf8"))),
  });
  console.log(`epoch ${epoch}: nav/share ${navPerShare} (tx ${hash})`);
}
