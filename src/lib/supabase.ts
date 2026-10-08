import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { backendEnabled, env } from "./env";

let client: SupabaseClient | null | undefined;

/** Browser Supabase client, or `null` when the backend is not configured. */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    client = backendEnabled
      ? createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
          auth: { persistSession: true, storageKey: "cordon-auth" },
        })
      : null;
  }
  return client;
}

export async function getAccessToken(): Promise<string | undefined> {
  const { data } = (await getSupabase()?.auth.getSession()) ?? { data: null };
  return data?.session?.access_token;
}
