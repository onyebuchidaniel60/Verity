/**
 * STRK20 configuration for VERITY (Phase 0 foundation).
 *
 * Pool addresses were verified on 2026-09-03 against official STRK20 resources:
 *  - mainnet: verified live in starkience/strk20-hackathon MAINNET-DAY-0.md
 *  - sepolia: pinned row of starkience/strk20-shadow-account-starter
 *
 * See docs/STRK20_INTEGRATION.md for the full findings.
 */

export type Strk20Network = "mainnet" | "sepolia";

export interface Strk20NetworkConfig {
  network: Strk20Network;
  poolAddress: string;
  strkTokenAddress: string;
  /** Public discovery service URL (Privacy SDK route only; not needed for the Wallet API route). */
  discoveryUrl?: string;
}

export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const STRK20: Record<Strk20Network, Strk20NetworkConfig> = {
  sepolia: {
    network: "sepolia",
    poolAddress:
      "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    strkTokenAddress: STRK_TOKEN_ADDRESS,
    discoveryUrl: "https://discovery-service.alpha-sepolia.sw-dev.io",
  },
  mainnet: {
    network: "mainnet",
    poolAddress:
      "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    strkTokenAddress: STRK_TOKEN_ADDRESS,
  },
};

/**
 * Wallet-route feature detection contract (Phase 0 scaffold).
 *
 * Official rule: never make a UI decision from a private-balance read.
 * Feature-detect the STRK20 Wallet API on the connected wallet instead
 * (`walletV6.supportedSpecs`). STRK20 actions themselves are implemented in
 * Phase 6; this module only records the contract.
 */
export interface Strk20WalletApiReport {
  /** true when the connected wallet advertises STRK20 wallet methods. */
  supported: boolean;
  /** Raw specs returned by walletV6.supportedSpecs, when available. */
  specs?: unknown;
}