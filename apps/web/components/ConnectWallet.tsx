"use client";

import { useCallback, useEffect, useState } from "react";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { validateAndParseAddress, WalletAccountV6, walletV6 } from "starknet";
import { createProvider, DEFAULT_NETWORK } from "@/lib/starknet";
import { useWalletStore } from "@/store/wallet";

/**
 * Wallet connection foundation (Phase 0).
 *
 * Mirrors the official STRK20 starter kit pattern:
 *   - discover wallets with @starknet-io/get-starknet-discovery (eip1193Adapters
 *     empty so MetaMask snap probing never fires),
 *   - connect through starknet.js WalletAccountV6,
 *   - record the wallet's STRK20 capability via walletV6.supportedSpecs
 *     (feature detection, never a balance read).
 *
 * STRK20 actions (shield/transfer/invoke) are intentionally NOT implemented
 * until Phase 6, after the private funding and payout gates pass.
 */
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ConnectWallet() {
  const { address, connected, walletName, setConnection, disconnect } = useWalletStore();
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    const unsubscribe = store.subscribe((next) => setWallets(next.slice()));
    return () => unsubscribe();
  }, []);

  const pickable = wallets.filter((w) => !normalizeId(w.name).includes("metamask"));

  const selectWallet = useCallback(
    async (w: WalletWithStarknetFeatures) => {
      setError("");
      setConnecting(true);
      try {
        const provider = createProvider(DEFAULT_NETWORK);
        await WalletAccountV6.connect(provider, w);
        const accounts = await walletV6.requestAccounts(w);
        if (typeof accounts === "string") {
          throw new Error("This wallet is not compatible with WalletAccountV6.");
        }
        if (!Array.isArray(accounts) || accounts.length === 0) {
          throw new Error("No account returned by the wallet.");
        }
        const addr = validateAndParseAddress(accounts[0]);
        const specs = await walletV6.supportedSpecs(w);
        setConnection(addr, w.name, specs);
        setPickerOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Wallet connection failed.");
      } finally {
        setConnecting(false);
      }
    },
    [setConnection],
  );

  return (
    <div className="verity-wallet">
      {connected && address ? (
        <div className="verity-wallet-connected">
          <span className="verity-wallet-dot" aria-hidden="true" />
          <span title={address}>
            {walletName ?? "Wallet"} · {shortAddress(address)}
          </span>
          <button type="button" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="verity-wallet-connect"
          onClick={() => setPickerOpen(true)}
        >
          Connect a Wallet
        </button>
      )}

      {pickerOpen && (
        <div
          className="verity-picker-overlay"
          onClick={() => !connecting && setPickerOpen(false)}
        >
          <div className="verity-picker" onClick={(e) => e.stopPropagation()}>
            <div className="verity-picker-head">
              <strong>Connect a wallet</strong>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
                disabled={connecting}
              >
                ×
              </button>
            </div>

            {pickable.length > 0 ? (
              <ul className="verity-picker-list">
                {pickable.map((w) => (
                  <li key={w.name}>
                    <button
                      type="button"
                      className="verity-wallet-row"
                      disabled={connecting}
                      onClick={() => void selectWallet(w)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="verity-wallet-icon" src={w.icon} alt="" width={22} height={22} />
                      <span>{w.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="verity-picker-empty">
                No Starknet wallet detected. Install Ready or Xverse.
              </p>
            )}

            {error ? <p className="verity-error">{error}</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}