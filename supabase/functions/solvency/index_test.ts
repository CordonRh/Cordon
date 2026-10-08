import { arg, callServed, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData } from "npm:viem@2.56.9";
import { solvencyVerifierAbi } from "../_shared/abis.ts";
import { run } from "./index.ts";

const handler = served.at(-1)!;
const d = { solvencyVerifier: "0x00000000000000000000000000000000000000Cc" } as never;
const A = "0x000000000000000000000000000000000000000a";

Deno.test("enqueues one attest per registered asset", async () => {
  const sb = fakeDb((c) => (c.table === "assets" ? { data: [{ asset: A }] } : undefined));
  eq(await run(d, sb as never), { assets: 1 });
  const job = arg(sb.on("rpc:enqueue_keeper")[0], "args");
  eq([job.kind, job.target], ["solvency.attest", "0x00000000000000000000000000000000000000cc"]);
  eq(decodeFunctionData({ abi: solvencyVerifierAbi, data: job.calldata }).args.map((x) => x.toLowerCase()), [A]);
  eq(await run(d, fakeDb() as never), { assets: 0 });
});

Deno.test("database errors fail the run", async () => {
  await throws(() => run(d, fakeDb(() => ({ error: { message: "down" } })) as never), /down/);
  const sb = fakeDb((c) => (c.table === "assets" ? { data: [{ asset: A }] } : { error: { message: "queue" } }));
  await throws(() => run(d, sb as never), /queue/);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
