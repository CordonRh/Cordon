import { createTRPCClient, httpBatchLink } from "@trpc/client";

import type { AppRouter } from "@/server/trpc/router";

import { getAccessToken } from "./supabase";

/** Same-origin API client; attaches the wallet session when there is one. */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      async headers() {
        const token = await getAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
