"use client";

import { create } from "zustand";

/**
 * Wallet connection store (Phase 0 foundation).
 *
 * Holds the lightest possible connected-wallet state. The actual
 * WalletAccountV6 / STRK20 action handling is added in Phase 6; this store
 * establishes the shape without faking any STRK20 behavior.
 */
export interface WalletState {
  address: string | null;
  walletName: string | null;
  connected: boolean;
  /** Raw Starknet Wallet API spec report, used to feature-gate STRK20 actions later. */
  walletApi: unknown;
  setConnection(address: string, walletName: string, walletApi: unknown): void;
  disconnect(): void;
}

export const useWalletStore = create<WalletState>()((set) => ({
  address: null,
  walletName: null,
  connected: false,
  walletApi: undefined,
  setConnection: (address, walletName, walletApi) =>
    set({ address, walletName, walletApi, connected: true }),
  disconnect: () =>
    set({ address: null, walletName: null, walletApi: undefined, connected: false }),
}));