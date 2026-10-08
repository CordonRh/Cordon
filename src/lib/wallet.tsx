"use client";
import { robinhoodChain } from "@cordon/shared";
import type { ReactNode } from "react";
import { defineChain, type EIP1193Provider } from "viem";
import {
  WagmiProvider,
  createConfig,
  http,
  injected,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  type Connector,
} from "wagmi";
import { signMessage } from "wagmi/actions";

import { chainId, env } from "./env";

export const robinhood = defineChain(robinhoodChain(env.rpcUrl, chainId));

export const wagmiConfig = createConfig({
  chains: [robinhood],
  connectors: [injected()],
  transports: { [robinhood.id]: http(env.rpcUrl) },
});

export function WalletProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

const NO_WALLET = "Open Cordon in a browser with an Ethereum-compatible wallet installed.";

function friendly(error: unknown): string {
  const e = error as { name?: string; shortMessage?: string; message?: string };
  if (e?.name === "ProviderNotFoundError") return NO_WALLET;
  if (e?.name === "UserRejectedRequestError") return "Wallet connection was declined.";
  return e?.shortMessage || e?.message || "Wallet connection was declined.";
}

/** Wallets the browser exposes: EIP-6963 announcements first, generic injected last. */
function choices(connectors: readonly Connector[]) {
  const announced = connectors.filter((c) => c.id !== "injected");
  return announced.length ? announced : connectors;
}

export function useCordonWallet() {
  const { address, connector } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  return {
    address: address ?? "",
    connector,
    choices: choices(connectors),
    busy: connect.isPending,
    async connect(target?: Connector) {
      const chosen = target ?? choices(connectors)[0];
      if (!chosen) throw new Error(NO_WALLET);
      try {
        await connect.mutateAsync({ connector: chosen });
      } catch (error) {
        throw new Error(friendly(error));
      }
    },
    disconnect: () => disconnect.mutate(),
  };
}

export async function walletProvider(connector: Connector): Promise<EIP1193Provider> {
  return (await connector.getProvider()) as EIP1193Provider;
}

export function signWithWallet(message: string) {
  return signMessage(wagmiConfig, { message });
}
