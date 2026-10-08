import { arg, callServed, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData } from "npm:viem@2.56.9";
import { encumbranceRegistryAbi } from "../_shared/abis.ts";
import { run } from "./index.ts";

const handler = served.at(-1)!;
const d = { encumbranceRegistry: "0x00000000000000000000000000000000000000EE" } as never;

Deno.test("declares each approved default once and marks it submitted", async () => {
  const sb = fakeDb((c) => (c.table === "default_requests" && arg(c, "select") ? { data: [{ enc_commit: "0x05" }] } : undefined));
  eq(await run(d, sb as never), { declared: 1 });
  const job = arg(sb.on("rpc:enqueue_keeper")[0], "args");
  eq([job.kind, job.target], ["encumbrance.default", "0x00000000000000000000000000000000000000ee"]);
  eq(decodeFunctionData({ abi: encumbranceRegistryAbi, data: job.calldata }).args, [5n]);
  const mark = sb.on("default_requests").find((c) => arg(c, "update"))!;
  eq([arg(mark, "update"), mark.ops.at(-1)], [{ submitted: true }, ["eq", ["enc_commit", "0x05"]]]);
});

Deno.test("no approved defaults: nothing declared", async () => {
  eq(await run(d, fakeDb() as never), { declared: 0 });
});

Deno.test("database errors fail the run before marking", async () => {
  await throws(() => run(d, fakeDb(() => ({ error: { message: "down" } })) as never), /down/);
  const sb = fakeDb((c) => (c.table === "default_requests" ? { data: [{ enc_commit: "0x05" }] } : { error: { message: "queue" } }));
  await throws(() => run(d, sb as never), /queue/);
  eq(sb.on("default_requests").filter((c) => arg(c, "update")).length, 0);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
