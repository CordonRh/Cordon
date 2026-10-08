import { arg, callServed, clearSecrets, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData, parseAbi } from "npm:viem@2.56.9";
import { adminWallet, run } from "./index.ts";

const handler = served.at(-1)!;
const d = { timelock: "0x00000000000000000000000000000000000000Ab", navAttestor: "0x00000000000000000000000000000000000000Cd" };
const vid = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const M = "0x000000000000000000000000000000000000000e";
const tl = parseAbi(["function registerVault(bytes32 vaultId, address manager, uint256 vaultPk)"]);
type Write = { functionName: string; args: unknown[] };

/** Timelock double: the operation id is the salt (the vault id); state per vault id. */
const chain = (ops: Record<string, { done?: boolean; ready?: boolean; exists?: boolean }>, receipt = "success") => ({
  readContract: ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    if (functionName === "getMinDelay") return Promise.resolve(86400n);
    if (functionName === "hashOperation") return Promise.resolve(args[4]);
    const op = ops[args[0] as string] ?? {};
    const state: Record<string, boolean | undefined> = { isOperationDone: op.done, isOperationReady: op.ready, isOperation: op.exists };
    return Promise.resolve(state[functionName] ?? false);
  },
  waitForTransactionReceipt: () => Promise.resolve({ status: receipt }),
});
const wallet = (writes: Write[]) => ({
  writeContract: (w: Write) => (writes.push(w), Promise.resolve(`0x${writes.length}`)),
});
const requests = [1, 2, 3, 4].map((n) => ({ vault_id: vid(n), manager: M, vault_pk: String(n) }));

Deno.test("no admin key: skipped (mainnet proposes through the Safe)", async () => {
  clearSecrets();
  eq(adminWallet(), undefined);
  eq(await run(), { skipped: "ADMIN_PRIVATE_KEY not set" });
  Deno.env.set("ADMIN_PRIVATE_KEY", `0x${"33".repeat(32)}`);
  Deno.env.set("RPC_URL_4663", "http://127.0.0.1:9");
  eq(typeof adminWallet()?.writeContract, "function");
  await throws(() => run(), /missing secret CORDON_DEPLOYMENT/); // with a key, the rest is required
  clearSecrets();
});

Deno.test("schedules new requests, executes ready ones, skips done and pending", async () => {
  const writes: Write[] = [];
  const sb = fakeDb((c) => (c.table === "vault_requests" && arg(c, "select") ? { data: requests } : undefined));
  const c = chain({ [vid(1)]: {}, [vid(2)]: { exists: true, ready: true }, [vid(3)]: { exists: true }, [vid(4)]: { done: true } });
  const out = await run(wallet(writes) as never, { d, sb, client: c } as never);
  eq(out, [{ vault: vid(1), status: "scheduled", tx: "0x1" }, { vault: vid(2), status: "registered", tx: "0x2" }]);
  eq(writes.map((w) => w.functionName), ["schedule", "execute"]);
  const s = decodeFunctionData({ abi: tl, data: writes[0].args[2] as `0x${string}` });
  eq([s.functionName, s.args[0], String(s.args[1]).toLowerCase(), s.args[2]], ["registerVault", vid(1), M, 1n]);
  eq([writes[0].args[0], writes[0].args[4], writes[0].args[5]], [d.navAttestor, vid(1), 86400n]);
  eq(sb.on("vault_requests").filter((x) => arg(x, "update")).map((x) => x.ops.at(-1)![1][1]), [vid(1), vid(2)]);
});

Deno.test("a reverted timelock tx and a request read error fail the run", async () => {
  const sb = fakeDb((c) => (c.table === "vault_requests" ? { data: [requests[0]] } : undefined));
  await throws(() => run(wallet([]) as never, { d, sb, client: chain({}, "reverted") } as never), /scheduled tx 0x1 reverted/);
  const bad = fakeDb(() => ({ error: { message: "down" } }));
  await throws(() => run(wallet([]) as never, { d, sb: bad, client: chain({}) } as never), /down/);
});

Deno.test("the served handler skips without the admin key", async () => {
  eq((await callServed(handler)).json, { ok: true, result: { skipped: "ADMIN_PRIVATE_KEY not set" } });
});
