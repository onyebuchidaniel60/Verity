import { constants, RpcProvider } from "starknet";

export type VerityNetwork = "mainnet" | "sepolia";

export interface VerityNetworkConfig {
  id: VerityNetwork;
  name: string;
  chainId: string;
  rpcUrl: string;
  explorerUrl: string;
}

/**
 * RPC endpoints used by the VERITY frontend (Phase 0 foundation).
 *
 * Mainnet RPC follows the official STRK20 Day-0 guide
 * (starkience/strk20-hackathon); Sepolia follows the official
 * shadow-account starter. Deployers may override via
 * NEXT_PUBLIC_STARKNET_RPC_URL.
 */
export const VERITY_NETWORKS: Record<VerityNetwork, VerityNetworkConfig> = {
  sepolia: {
    id: "sepolia",
    name: "Sepolia",
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    rpcUrl: "https://starknet-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.voyager.online",
  },
  mainnet: {
    id: "mainnet",
    name: "Mainnet",
    chainId: constants.StarknetChainId.SN_MAIN,
    rpcUrl: "https://rpc.starknet.lava.build",
    explorerUrl: "https://voyager.online",
  },
};

export const DEFAULT_NETWORK: VerityNetwork = "sepolia";

/** Build a public RPC provider for the given network. */
export function createProvider(network: VerityNetwork = DEFAULT_NETWORK): RpcProvider {
  const config = VERITY_NETWORKS[network];
  const override = process.env.NEXT_PUBLIC_STARKNET_RPC_URL;
  return new RpcProvider({ nodeUrl: override || config.rpcUrl });
}