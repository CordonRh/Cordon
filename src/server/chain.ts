/// <reference types="node" />
import { robinhoodChain } from "@cordon/shared";
import { createPublicClient, http, type Address } from "viem";

/** Deployed addresses (packages/shared/deployments/<chainId>.json) from CORDON_DEPLOYMENT. */
export type Deployment = {
  pool: Address;
  bundleVerifier: Address;
  actionEngine: Address;
  priceOracle: Address;
  dvpSettler: Address;
  encumbranceRegistry: Address;
  navAttestor: Address;
};

/** RPC URL and deployment from the server environment, or null when the on-chain path is off. */
export function chainEnv() {
  const e = process.env;
  const rpc = e.RPC_URL_4663 ?? e.VITE_RPC_URL_4663;
  const raw = e.CORDON_DEPLOYMENT;
  if (!rpc || !raw) return null;
  const deployment = JSON.parse(raw) as Deployment & { chainId?: number };
  return {
    deployment,
    client: createPublicClient({ chain: robinhoodChain(rpc, Number(deployment.chainId ?? 4663)), transport: http(rpc) }),
    sequencerUrl: e.SEQUENCER_URL,
  };
}
