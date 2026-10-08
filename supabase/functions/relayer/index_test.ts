import { arg, callServed, clearSecrets, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { privateKeyToAccount } from "npm:viem@2.56.9/accounts";
import { exhausted, MAX_ATTEMPTS, queues, run } from "./index.ts";

const handler = served.at(-1)!;
const KEEPER = `0x${"22".repeat(32)}` as const;
const RELAYER = `0x${"11".repeat(32)}` as const;
const msg = (msg_id: number, job: number, to: string, read_ct = 1) => ({ msg_id, read_ct, message: { job, to, data: "0x01" } });

const wallet = (name: string, sent: string[]) => ({
  account: { address: name },
  sendTransaction: ({ to }: { to: string }) => (sent.push(`${name}->${to}`), Promise.resolve(`0xtx-${to}`)),
});

Deno.test("exhausted after MAX_ATTEMPTS reads", () => {
  eq([exhausted(MAX_ATTEMPTS - 1), exhausted(MAX_ATTEMPTS)], [false, true]);
});

Deno.test("queues: keeper key for keeper jobs, relayer key for user relays", () => {
  clearSecrets();
  Deno.env.set("RPC_URL_4663", "http://127.0.0.1:9");
  Deno.env.set("KEEPER_PRIVATE_KEY", KEEPER);
  Deno.env.set("RELAYER_PRIVATE_KEY", RELAYER);
  const [k, r] = queues();
  eq([k.read, k.done, k.wallet.account.address], ["keeper_read", "keeper_done", privateKeyToAccount(KEEPER).address]);
  eq([r.read, r.done, r.wallet.account.address], ["relay_read", "relay_done", privateKeyToAccount(RELAYER).address]);
  clearSecrets();
});

Deno.test("keeper queue first; simulate, send, confirm; failures retry until exhausted", async () => {
  const sent: string[] = [];
  const simulated: string[] = [];
  const client = {
    call: ({ account, to }: { account: { address: string }; to: string }) => (
      simulated.push(`${account.address}->${to}`),
        to.startsWith("0xbad") ? Promise.reject(new Error("reverted: nope")) : Promise.resolve({})
    ),
    waitForTransactionReceipt: ({ hash }: { hash: string }) =>
      Promise.resolve({ status: hash.endsWith("0xrevert") ? "reverted" : "success" }),
  };
  const sb = fakeDb((c) => {
    if (c.table === "rpc:keeper_read") return { data: [msg(1, 10, "0xok"), msg(2, 11, "0xrevert")] };
    if (c.table === "rpc:relay_read") return { data: [msg(3, 12, "0xbad1", 1), msg(4, 13, "0xbad2", MAX_ATTEMPTS)] };
  });
  const qs = [
    { read: "keeper_read", done: "keeper_done", wallet: wallet("keeper", sent) },
    { read: "relay_read", done: "relay_done", wallet: wallet("relayer", sent) },
  ];
  const out = await run(sb as never, client as never, qs as never);
  eq(out, [
    { job: 10, status: "confirmed" },
    { job: 11, status: "failed" },
    { job: 12, status: "retry" },
    { job: 13, status: "failed" },
  ]);
  eq(sent, ["keeper->0xok", "keeper->0xrevert"]); // a failed simulation never sends
  eq(simulated, ["keeper->0xok", "keeper->0xrevert", "relayer->0xbad1", "relayer->0xbad2"]);
  eq(sb.on("rpc:keeper_read").map((c) => arg(c, "args")), [{ qty: 5 }]);
  // done: both keeper messages (confirmed and reverted) and only the exhausted relay
  eq([...sb.on("rpc:keeper_done"), ...sb.on("rpc:relay_done")].map((c) => arg(c, "args").msg_id), [1, 2, 4]);
  const updates = sb.on("relayer_jobs").map((c) => [c.ops.at(-1)![1][1], arg(c, "update").status]);
  eq(updates, [[10, "sent"], [10, "confirmed"], [11, "sent"], [11, "failed"], [12, "queued"], [13, "failed"]]);
  const err = arg(sb.on("relayer_jobs").find((c) => arg(c, "update").status === "queued")!, "update");
  eq([err.attempts, err.error], [1, "Error: reverted: nope"]);
});

Deno.test("a queue read error fails the run", async () => {
  const sb = fakeDb(() => ({ error: { message: "pgmq down" } }));
  await throws(() => run(sb as never, {} as never, [{ read: "keeper_read" }] as never), /pgmq down/);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
