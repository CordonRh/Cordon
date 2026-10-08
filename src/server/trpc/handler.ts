import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "./router";
import { createContext } from "./trpc";

/** Serves /api/trpc requests. */
export function handleTrpc(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: ({ req }) => createContext(req),
  });
}
