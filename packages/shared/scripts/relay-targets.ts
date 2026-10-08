// Prints the SQL that allowlists the deployed engine functions for public relaying:
//   bun packages/shared/scripts/relay-targets.ts packages/shared/deployments/4663.json
import { readFileSync } from "node:fs";
import { toFunctionSelector, type AbiFunction } from "viem";
import { bundleVerifierAbi, cordonPoolAbi, encumbranceRegistryAbi } from "../src/abis";

const d = JSON.parse(readFileSync(process.argv[2] ?? "packages/shared/deployments/4663.json", "utf8"));
const targets: [string, readonly unknown[], string[]][] = [
  [d.pool, cordonPoolAbi, ["transact"]],
  [d.bundleVerifier, bundleVerifierAbi, ["bundle", "unbundle", "term", "claimIncome"]],
  [d.encumbranceRegistry, encumbranceRegistryAbi, ["encumber", "unlock", "enforce", "release"]],
];

const rows: string[] = [];
for (const [address, abi, names] of targets) {
  for (const name of names) {
    const fn = (abi as AbiFunction[]).find((x) => x.type === "function" && x.name === name);
    if (!fn) throw new Error(`no ${name}`);
    const kind = `${name === "transact" ? "pool" : address === d.bundleVerifier ? "bundle" : "encumbrance"}.${name.toLowerCase()}`;
    rows.push(`('${address.toLowerCase()}', '${toFunctionSelector(fn)}', '${kind}')`);
  }
}
console.log(`insert into public.relay_targets (target, selector, kind) values\n  ${rows.join(",\n  ")}\non conflict do nothing;`);
