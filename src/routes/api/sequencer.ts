import { createFileRoute } from "@tanstack/react-router";

// pg_cron calls this once a minute (public.invoke_app); the secret keeps anyone else out.
const handle = async ({ request }: { request: Request }) => {
  const secret = process.env.SEQUENCER_CRON_SECRET;
  if (!secret || !sameSecret(request.headers.get("x-cron-secret") ?? "", secret)) return new Response("forbidden", { status: 403 });
  const { runBatch } = await import("@/server/sequencer");
  return Response.json(await runBatch(new URL(request.url).origin));
};

export const Route = createFileRoute("/api/sequencer")({
  server: { handlers: { POST: handle } },
});

/** Constant-time comparison of the cron secret. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
