/**
 * Public, build-time configuration. Every backend feature is optional: with no
 * Supabase env the dashboard keeps working exactly as before, device-local.
 */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY ??
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined,
  rpcUrl: import.meta.env.VITE_RPC_URL_4663 as string | undefined,
  /** packages/shared/deployments/<chainId>.json; unset until the contracts are live. */
  deployment: import.meta.env.VITE_CORDON_DEPLOYMENT as string | undefined,
};

/** The deployment's network (testnet 46630 or mainnet 4663); mainnet when none is set. */
export const chainId: number = (() => {
  try {
    return env.deployment ? Number(JSON.parse(env.deployment).chainId) || 4663 : 4663;
  } catch {
    return 4663;
  }
})();

export const backendEnabled = Boolean(env.supabaseUrl && env.supabaseAnonKey);
