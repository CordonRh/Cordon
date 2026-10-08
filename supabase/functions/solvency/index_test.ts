import { arg, callServed, eq, fakeDb, served, throws } from "../_shared/fakes.ts";
import { decodeFunctionData } from "npm:viem@2.56.9";
import { solvencyVerifierAbi } from "../_shared/abis.ts";
import { run } from "./index.ts";

const handler = served.at(-1)!;
const d = { solvencyVerifier: "0x00000000000000000000000000000000000000Cc" } as never;
const A = "0x000000000000000000000000000000000000000a";
const B = "0x000000000000000000000000000000000000000b";
const NOW = 100_000n;
/** A chain where each asset was last attested at `last[asset]` (0 = never). */
const chain = (last: Record<string, bigint>) =>
  ({ readContract: async ({ args }: { args: [string] }) => [1n, last[args[0]] ?? 0n, 0n, 0n] }) as never;

Deno.test("enqueues one attest per registered asset that is due", async () => {
  const sb = fakeDb((c) => (c.table === "assets" ? { data: [{ asset: A }] } : undefined));
  eq(await run(d, sb as never, chain({}), NOW), { assets: 1, queued: 1 });
  const job = arg(sb.on("rpc:enqueue_keeper")[0], "args");
  eq([job.kind, job.target], ["solvency.attest", "0x00000000000000000000000000000000000000cc"]);
  eq(decodeFunctionData({ abi: solvencyVerifierAbi, data: job.calldata }).args.map((x) => x.toLowerCase()), [A]);
  eq(await run(d, fakeDb() as never, chain({}), NOW), { assets: 0, queued: 0 });
});

Deno.test("skips an asset attested less than an epoch ago (it would revert TooEarly)", async () => {
  const sb = fakeDb((c) => (c.table === "assets" ? { data: [{ asset: A }, { asset: B }] } : undefined));
  eq(await run(d, sb as never, chain({ [A]: NOW - 3599n, [B]: NOW - 3600n }), NOW), { assets: 2, queued: 1 });
  const job = arg(sb.on("rpc:enqueue_keeper")[0], "args");
  eq(decodeFunctionData({ abi: solvencyVerifierAbi, data: job.calldata }).args.map((x) => x.toLowerCase()), [B]);
});

Deno.test("database errors fail the run", async () => {
  await throws(() => run(d, fakeDb(() => ({ error: { message: "down" } })) as never, chain({}), NOW), /down/);
  const sb = fakeDb((c) => (c.table === "assets" ? { data: [{ asset: A }] } : { error: { message: "queue" } }));
  await throws(() => run(d, sb as never, chain({}), NOW), /queue/);
});

Deno.test("the served handler fails closed without secrets", async () => {
  eq((await callServed(handler)).status, 500);
});
