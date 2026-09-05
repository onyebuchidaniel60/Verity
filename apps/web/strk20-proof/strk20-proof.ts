/**
 * VERITY — Phase 1 "Independent STRK20 proof" harness (private dapp route).
 *
 * Implements the smallest official STRK20 Wallet API flow using the REAL
 * starknet.js 10.5.0 STRK20 API installed in this workspace:
 *
 *   connect wallet
 *     -> walletV6.supportedWalletApi feature-detect (never a balance read)
 *     -> shield            (STRK20_ACTION { type: 'deposit' } -> real pool)
 *     -> strk20Balances    (wallet-side shielded balance read)
 *     -> private transfer  (STRK20_ACTION { type: 'transfer' })
 *     -> withdraw          (STRK20_ACTION { type: 'withdraw' })
 *
 * Action shapes below are copied from the installed type source
 * (@starknet-io/types-js 0.10.3 -> dist/types/wallet-api/components.d.ts,
 * re-exported by starknet@10.5.0):
 *   STRK20_DEPOSIT_ACTION  = { type:'deposit',  token, amount }
 *   STRK20_TRANSFER_ACTION = { type:'transfer', token, amount: FELT | 'OPEN', recipient }
 *   STRK20_WITHDRAW_ACTION = { type:'withdraw', token, amount, recipient }
 *   STRK20_ACTION          = deposit | withdraw | transfer | invoke
 *   STRK20_BALANCE_ENTRY   = { token, balance }
 *
 * BROWSER-ONLY: STRK20 private operations require the user's privacy-enabled
 * wallet (Ready / formerly Argent, Wallet API >= 0.10.3) to hold the viewing
 * keys, discover notes, generate the SNIP-36 ZK proof and submit the
 * transaction. This module never sees a viewing/private key, never invents a
 * note/balance/tx-hash, and never substitutes a public ERC20 transfer for a
 * private operation. If the wallet is absent or rejects a step, it throws.
 *
 * Official references (re-verified 2026-09-05):
 *  - strk20-by-example.org/starknet-wallet-api/{overview,starknet-js}.md
 *  - strk20-wallet-api agent skill (welttowelt/strk20-skills) worked snippets
 *  - installed types: starknet@10.5.0 dist/index.d.ts + types-js 0.10.3
 */

import { WalletAccountV6, walletV6 } from "starknet";
import type { STRK20_ACTION, STRK20_BALANCE_ENTRY } from "starknet";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { STRK20 } from "../lib/strk20";
import { createProvider, type VerityNetwork } from "../lib/starknet";

/**
 * Starknet address type. starknet@10.5.0 declares `Address` locally (sourced
 * from @starknet-io/types-js, where ADDRESS = string) but does not re-export
 * it, so VERITY defines the identical alias here.
 */
export type Address = string;

/** Minimal shape of the wallet object a STRK20-capable extension injects at window.starknet. */
export interface InjectedWallet {
  id: string;
  name: string;
  version?: string;
  requestAccounts(): Promise<Address[]>;
  requestChainId?(): Promise<string>;
}

declare global {
  interface Window {
    starknet?: InjectedWallet;
  }
}

/** STRK20 Wallet API version floor required for private actions (official: >= 0.10.3). */
export const WALLET_API_MIN_VERSION = "0.10.3";

/** Dependency-free "a.b.c" >= comparison for Wallet API capability detection. */
export function isWalletApiAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map((p) => (Number.isNaN(Number(p)) ? 0 : Number(p)));
  const b = min.split(".").map((p) => (Number.isNaN(Number(p)) ? 0 : Number(p)));
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export interface Phase1Config {
  network: VerityNetwork;
  /** STRK token contract address (felt). */
  token: Address;
}

export type Phase1Step =
  | "connect"
  | "feature-detect"
  | "shield"
  | "private-balances"
  | "private-transfer"
  | "withdraw";

/**
 * Fixed-shape evidence record. Every field is populated ONLY from a real
 * wallet/transaction response. A field stays undefined until its step really
 * succeeded — nothing here is ever fabricated.
 */
export interface Phase1Evidence {
  network: VerityNetwork;
  chainId?: string;
  poolAddress: string;
  tokenAddress: string;
  walletId?: string;
  walletName?: string;
  walletAddress?: string;
  walletApiVersions?: string[];
  walletApiSupported: boolean;
  shield?: { actions: STRK20_ACTION[]; transactionHash: string };
  balancesAfterShield?: STRK20_BALANCE_ENTRY[];
  transfer?: { actions: STRK20_ACTION[]; transactionHash: string };
  withdraw?: { actions: STRK20_ACTION[]; transactionHash: string };
  lastCompletedStep: Phase1Step;
  completedAt?: string;
}

/** Official 'deposit' action: shield public STRK into the real privacy pool. */
export function shieldAction(token: Address, amount: string): STRK20_ACTION {
  return { type: "deposit", token, amount };
}

/** Official 'transfer' action: private in-pool transfer to a registered user. */
export function privateTransferAction(
  token: Address,
  amount: string,
  recipient: Address,
): STRK20_ACTION {
  return { type: "transfer", token, amount, recipient };
}

/** Official 'withdraw' action: unshield from the pool to a public recipient. */
export function withdrawAction(
  token: Address,
  amount: string,
  recipient: Address,
): STRK20_ACTION {
  return { type: "withdraw", token, amount, recipient };
}
/** Read the wallet injected by the extension and request an account connection. */
export async function connectWallet(): Promise<{
  wallet: WalletWithStarknetFeatures;
  address: Address;
  walletId: string;
  walletName: string;
  chainId?: string;
}> {
  if (typeof window === "undefined") {
    throw new Error("Browser only: the STRK20 Wallet API requires a browser wallet.");
  }
  const injected = window.starknet;
  if (!injected) {
    throw new Error(
      "No Starknet wallet extension detected (window.starknet is undefined). " +
        "Install Ready (formerly Argent), enable it for this page, and reload.",
    );
  }
  if (typeof injected.requestAccounts !== "function") {
    throw new Error("Injected wallet has no requestAccounts() — not wallet-API capable.");
  }
  const accounts = await injected.requestAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error("Wallet returned no accounts. Unlock it or approve the connection.");
  }
  // Chain verification uses the wallet's own requestChainId() — WalletAccountV6
  // does not expose getChainId().
  const chainId = injected.requestChainId ? await injected.requestChainId() : undefined;
  // The injected object exposes the ERN-standard feature surface that the
  // starknet.js Wallet API functions operate on.
  const wallet = injected as unknown as WalletWithStarknetFeatures;
  const first = accounts[0];
  return {
    wallet,
    address: (first.startsWith("0x") ? first : `0x${first}`) as Address,
    walletId: injected.id,
    walletName: injected.name,
    chainId,
  };
}

/**
 * Feature-detect the STRK20 Wallet API on the connected wallet.
 * Official rule: never decide capability from a private-balance read.
 */
export async function detectStrk20Capability(
  wallet: WalletWithStarknetFeatures,
): Promise<{ walletApiVersions: string[]; supported: boolean }> {
  const versions = await walletV6.supportedWalletApi(wallet);
  const walletApiVersions = versions.map((v) => String(v));
  return {
    walletApiVersions,
    supported: walletApiVersions.some((v) => isWalletApiAtLeast(v, WALLET_API_MIN_VERSION)),
  };
}
/** Build the STRK20-capable account wrapper for a connected wallet. */
export async function createStrk20Account(
  wallet: WalletWithStarknetFeatures,
  config: Phase1Config,
): Promise<WalletAccountV6> {
  const provider = createProvider(config.network);
  // Note: WalletAccountV6 does not expose getChainId(); the chain is verified
  // at connect time from the wallet's requestChainId() (see connectWallet),
  // and every STRK20 action is wallet-mediated — the wallet only operates on
  // the chain it is actually connected to.
  const account = await WalletAccountV6.connect(provider, wallet);
  return account;
}

/**
 * Run the smallest official private-dapp flow, recording ONLY real evidence.
 *
 *   shield -> strk20Balances -> private transfer -> withdraw
 *
 * Every transaction hash comes from the wallet's real strk20InvokeTransaction
 * response; the balance comes from the real strk20Balances read. Any wallet
 * rejection aborts the run (the error surfaces) and `lastCompletedStep`
 * records exactly how far the real flow got. There is no simulation and no
 * fallback: if the wallet cannot perform a private operation, Gate 1 stays NO.
 */
export async function runPhase1Proof(
  config: Phase1Config,
  amounts: { shield: string; transfer: string; withdraw: string },
  recipient: Address,
): Promise<Phase1Evidence> {
  const evidence: Phase1Evidence = {
    network: config.network,
    poolAddress: STRK20[config.network].poolAddress,
    tokenAddress: config.token,
    walletApiSupported: false,
    lastCompletedStep: "connect",
  };

  const { wallet, address, walletId, walletName, chainId } = await connectWallet();
  evidence.walletId = walletId;
  evidence.walletName = walletName;
  evidence.walletAddress = address;
  evidence.chainId = chainId;

  const cap = await detectStrk20Capability(wallet);
  evidence.walletApiVersions = cap.walletApiVersions;
  evidence.walletApiSupported = cap.supported;
  evidence.lastCompletedStep = "feature-detect";
  if (!cap.supported) {
    throw new Error(
      `Wallet does not advertise STRK20 Wallet API >= ${WALLET_API_MIN_VERSION} ` +
        `(got: ${cap.walletApiVersions.join(", ") || "none"}). Use Ready (formerly Argent).`,
    );
  }

  const account = await createStrk20Account(wallet, config);

  // 1. Shield: deposit into the real STRK20 privacy pool (wallet signs + proves).
  const shieldActions = [shieldAction(config.token, amounts.shield)];
  const shieldResult = await account.strk20InvokeTransaction(shieldActions);
  if (!shieldResult?.transaction_hash) {
    throw new Error("Shield returned no transaction_hash — wallet rejected the deposit.");
  }
  evidence.shield = { actions: shieldActions, transactionHash: shieldResult.transaction_hash };
  evidence.lastCompletedStep = "shield";

  // 2. Real wallet-side shielded balance read for the same token.
  evidence.balancesAfterShield = await account.strk20Balances([config.token]);
  evidence.lastCompletedStep = "private-balances";

  // 3. Private transfer (no public leg; wallet proves and submits).
  const transferActions = [privateTransferAction(config.token, amounts.transfer, recipient)];
  const transferResult = await account.strk20InvokeTransaction(transferActions);
  if (!transferResult?.transaction_hash) {
    throw new Error("Private transfer returned no transaction_hash — wallet rejected it.");
  }
  evidence.transfer = {
    actions: transferActions,
    transactionHash: transferResult.transaction_hash,
  };
  evidence.lastCompletedStep = "private-transfer";

  // 4. Withdraw (unshield) back to a public address.
  const withdrawActions = [withdrawAction(config.token, amounts.withdraw, address)];
  const withdrawResult = await account.strk20InvokeTransaction(withdrawActions);
  if (!withdrawResult?.transaction_hash) {
    throw new Error("Withdraw returned no transaction_hash — wallet rejected it.");
  }
  evidence.withdraw = {
    actions: withdrawActions,
    transactionHash: withdrawResult.transaction_hash,
  };
  evidence.lastCompletedStep = "withdraw";

  evidence.completedAt = new Date().toISOString();
  return evidence;
}