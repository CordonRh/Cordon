import { createFileRoute } from "@tanstack/react-router";

// Server-only: the handler (and supabase/tRPC server code) is loaded on demand
// so none of it reaches the client bundle.
const handle = async ({ request }: { request: Request }) =>
  (await import("@/server/trpc/handler")).handleTrpc(request);

export const Route = createFileRoute("/api/trpc/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
