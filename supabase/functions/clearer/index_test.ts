import { arg, callServed, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData } from "npm:viem@2.56.9";
import { cordonPoolAbi } from "../_shared/abis.ts";
import { BATCH, run } from "./index.ts";

const handler = served.at(-1)!;
const d = () => ({ pool: "0x00000000000000000000000000000000000000AA" }) as never;

Deno.test("clears deposits past standby that were neither flagged nor returned", async () => {
  const sb = fakeDb((c) => (c.table === "deposits" ? { data: [{ deposit_id: 3 }, { deposit_id: 4 }] } : undefined));
  eq(await run(sb as never, d), { cleared: 2 });
  const q = sb.on("deposits")[0];
  eq(q.ops.filter(([k]) => k === "eq").map(([, a]) => a), [["settled", false], ["returned", false], ["flagged", false]]);
  eq(arg(q, "limit"), BATCH);
  const job = arg(sb.on("rpc:enqueue_keeper")[0], "args");
  eq([job.kind, job.target], ["pool.clear", "0x00000000000000000000000000000000000000aa"]);
  eq(decodeFunctionData({ abi: cordonPoolAbi, data: job.calldata }).args, [[3n, 4n]]);
});

Deno.test("nothing due: no job, and the deployment is not read", async () => {
  const sb = fakeDb(() => ({ data: [] }));
  eq(await run(sb as never, () => { throw new Error("read"); }), { cleared: 0 });
  eq(sb.on("rpc:enqueue_keeper").length, 0);
});

Deno.test("database errors fail the run", async () => {
  await throws(() => run(fakeDb(() => ({ error: { message: "down" } })) as never, d), /down/);
  const sb = fakeDb((c) => (c.table === "deposits" ? { data: [{ deposit_id: 1 }] } : { error: { message: "queue" } }));
  await throws(() => run(sb as never, d), /queue/);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
