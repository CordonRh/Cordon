/** Robinhood Chain — the only network Cordon settles on. */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * viem/wagmi-compatible chain definition. The RPC URL comes from the caller's
 * environment (a Dwellir archive endpoint in production) so no provider key is
 * ever baked into the bundle.
 */
export function robinhoodChain(rpcUrl?: string, id: number = ROBINHOOD_CHAIN_ID) {
  const http = rpcUrl ? [rpcUrl] : [];
  return {
    id,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http } },
  } as const;
}
