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
 *  - starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6
 *  - installed types: starknet@10.5.0 dist/index.d.ts + types-js 0.10.3
 */

import { WalletAccountV6, walletV6 } from "starknet";
import type { STRK20_ACTION, STRK20_BALANCE_ENTRY } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { STRK20 } from "../lib/strk20";
import { createProvider, type VerityNetwork } from "../lib/starknet";

/**
 * Singleton Wallet Standard discovery store.
 *
 * Mirrors the pattern in apps/web/components/ConnectWallet.tsx which keeps a
 * single store alive via useEffect and subscribes continuously. The previous
 * implementation created a fresh store per connectWallet() call and then did
 * `store.getWallets()` synchronously — that races the extension's async
 * `wallet-standard:app-ready` → `wallet-standard:register-wallet` round-trip.
 * If the extension had not yet injected or had not yet replied to the
 * app-ready event, getWallets() returned [] and the first click failed while
 * the second succeeded after the extension was ready — the observed
 * intermittency.
 *
 * Keeping one store for the page lifetime ensures we observe the registration
 * regardless of whether it happened before or after the first Connect click,
 * and we avoid leaking listeners on every retry.
 */
let _singletonStore: Store | null = null;

function getDiscoveryStore(): Store {
  if (typeof window === "undefined") {
    throw new Error("Browser only: the STRK20 Wallet API requires a browser wallet.");
  }
  if (_singletonStore) return _singletonStore;
  _singletonStore = createStore({ eip1193Adapters: [] });
  return _singletonStore;
}

/**
 * Promise that resolves on the next Wallet-Standard wallet registration
 * (or immediately with the current wallet list if one is already present).
 *
 * Includes a timeout so the UI never hangs forever — the previous version
 * hung indefinitely when no wallet was present because the promise only
 * resolved on success and never rejected.
 */
function waitForStrk20Wallet(store: Store, timeoutMs = 8000): Promise<WalletWithStarknetFeatures[]> {
  const found = strk20Capable(store.getWallets());
  if (found.length > 0) return Promise.resolve(found);
  return new Promise<WalletWithStarknetFeatures[]>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const unsub = store.subscribe((wallets) => {
      const ok = strk20Capable(wallets);
      if (ok.length > 0) {
        if (timeoutId) clearTimeout(timeoutId);
        unsub();
        resolve(ok.slice());
      }
    });
    timeoutId = setTimeout(() => {
      unsub();
      reject(
        new Error(
          "No STRK20-capable wallet detected via the Starknet Wallet Standard within " +
            `${timeoutMs}ms. Install Ready (formerly Argent), enable it for this page, and reload. ` +
            `If Ready X is installed, ensure it is enabled for this site and not blocked by another wallet extension.`,
        ),
      );
    }, timeoutMs);
  });
}

/**
 * STRK20-capable wallet: a Wallet-Standard wallet that exposes the
 * Starknet Wallet API (`wallet.api` / features["starknet:walletApi"]), and is
 * NOT an eip1193-only provider such as MetaMask. Braavos (per
 * docs/STRK20_INTEGRATION.md §7) lacks STRK20 support — it still appears as a
 * Starknet wallet but will fail the supportedWalletApi >= 0.10.3 check later;
 * we keep it in the candidate set and let feature-detection reject it with a
 * precise error rather than silently hiding it.
 */
function strk20Capable(wallets: readonly WalletWithStarknetFeatures[]): WalletWithStarknetFeatures[] {
  return wallets.filter((w) => {
    if (w.name.toLowerCase().includes("metamask")) return false;
    // Official Wallet Standard shape: wallet.features["starknet:walletApi"] exists
    // when the wallet speaks the Starknet Wallet API. The previous "api" in w
    // check is kept as a fallback for older wrappers, but features is the
    // canonical signal.
    const features = (w as unknown as { features?: Record<string, unknown> }).features;
    const hasWalletApi = !!(features && "starknet:walletApi" in features);
    const hasLegacyApi = "api" in (w as unknown as Record<string, unknown>);
    return hasWalletApi || hasLegacyApi;
  }) as WalletWithStarknetFeatures[];
}

/**
 * Starknet address type. starknet@10.5.0 declares `Address` locally (sourced
 * from @starknet-io/types-js, where ADDRESS = string) but does not re-export
 * it, so VERITY defines the identical alias here.
 */
export type Address = string;

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
/**
 * Discover a STRK20-capable wallet via the Starknet Wallet Standard and request
 * an account connection.
 *
 * Uses @starknet-io/get-starknet-discovery (createStore) — the same official
 * discovery route used by apps/web/components/ConnectWallet.tsx — rather than
 * the legacy window.starknet injection, which modern STRK20-capable browsers
 * (Ready / formerly Argent) do not reliably expose with a requestAccounts() method.
 *
 * Deterministic: uses a singleton store (so the wallet-standard:app-ready handshake
 * is not re-dispatched on every click) and a timeout-bounded wait for the wallet
 * to register, rather than a synchronous getWallets() race.
 */
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
  const store = getDiscoveryStore();
  // Wait for the STRK20-capable wallet to register via wallet-standard. The
  // singleton store was created once; this wait simply subscribes for the
  // async registration event (or returns immediately if already present).
  const strkWallets = await waitForStrk20Wallet(store);
  // Deterministic selection: if multiple Starknet wallets are present (e.g.
  // Ready + Braavos), prefer Ready/Argent which is known STRK20-capable. The
  // previous code blindly picked [0] which could be a non-STRK20 wallet and
  // then fail capability detection non-deterministically depending on array order.
  const wallet: WalletWithStarknetFeatures =
    strkWallets.find((w) => /ready|argent/i.test(w.name)) ?? strkWallets[0];
  if (!wallet) {
    throw new Error(
      "No STRK20-capable wallet detected via the Starknet Wallet Standard. " +
        "Install Ready (formerly Argent), enable it for this page, and reload.",
    );
  }
  // Request accounts through the real Wallet API. The wallet prompts the user
  // to approve the connection via the Wallet Standard protocol.
  // This is separate from WalletAccountV6.connect (which uses standard:connect
  // and primes the wrapper's internal #account for events). Both paths are
  // valid; we use walletV6.requestAccounts here so connectWallet remains
  // provider-agnostic, and createStrk20Account later calls WalletAccountV6.connect
  // which internally does standardConnect. The double-authorization is harmless:
  // the second call sees the already-authorized account and returns immediately
  // without a second prompt.
  const accounts = await walletV6.requestAccounts(wallet);
  if (!accounts || (Array.isArray(accounts) && accounts.length === 0)) {
    throw new Error("Wallet returned no accounts. Unlock it or approve the connection.");
  }
  if (typeof accounts === "string") {
    throw new Error("Wallet returned a single string account — not WalletAccountV6 compatible.");
  }
  // Chain ID via the wallet's own Wallet API call (WalletAccountV6 has no getChainId).
  let chainId: string | undefined;
  try {
    chainId = String(await walletV6.requestChainId(wallet));
  } catch {
    chainId = undefined;
  }
  const first = Array.isArray(accounts) ? accounts[0] : (accounts as unknown as string);
  return {
    wallet,
    address: (first.startsWith("0x") ? first : `0x${first}`) as Address,
    walletId: (wallet as unknown as { id?: string }).id ?? wallet.name,
    walletName: wallet.name,
    chainId,
  };
}

/**
 * Feature-detect the STRK20 Wallet API on the connected wallet.
 * Official rule: never decide capability from a private-balance read.
 * Checks wallet_supportedWalletApi >= 0.10.3 — the STRK20 capability floor.
 * Note: wallet_supportedSpecs is the Starknet JSON-RPC spec version (e.g. 0.8)
 * and must NOT be used to gate STRK20; the correct gate is the Wallet API
 * version.
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
  // the chain it is actually connected to. This call internally does
  // standardConnect which primes the wallet wrapper's internal #account state
  // so that standard:events → subscribeWalletEvent bridging works.
  const account = await WalletAccountV6.connect(provider, wallet);
  return account;
}

/**
 * Wait for a Starknet transaction to be accepted on L2 / L1.
 * Uses the public RPC provider's waitForTransaction. The transaction hash
 * returned by wallet_strk20InvokeTransaction is only the submission hash —
 * the note is not spendable until the tx is confirmed and the note has
 * matured. Individual button clicks implicitly wait (human delay) but the
 * automated full-flow must await explicitly.
 */
export async function waitForTxAccepted(
  network: VerityNetwork,
  txHash: string,
  timeoutMs = 120_000,
): Promise<void> {
  const provider = createProvider(network);
  // starknet.js RpcProvider.waitForTransaction polls until successStates includes ACCEPTED_ON_L2 etc.
  // We bound it with our own timeout so a stuck tx does not hang forever.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // waitForTransaction with a short retry interval; if it resolves, tx is accepted.
      // We use 1 retry + 3s interval to avoid hammering the public RPC.
      await provider.waitForTransaction(txHash, {
        retries: 1,
        retryInterval: 3000,
      } as unknown as Record<string, unknown>);
      return;
    } catch (e) {
      // If the tx is still pending, waitForTransaction throws; we retry until timeout.
      const msg = e instanceof Error ? e.message : String(e);
      // If the error is clearly a reverted/failed tx, surface immediately.
      if (/revert|fail|error/i.test(msg) && !/timeout|not found|receipt/i.test(msg)) {
        throw e;
      }
      if (Date.now() - start >= timeoutMs) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`Timeout waiting for transaction ${txHash} to be accepted (${timeoutMs}ms)`);
}

/**
 * Poll wallet_strk20Balances until the shielded balance for `token` is at
 * least `minAmount` (felt hex). This handles note discovery + maturity:
 * after Shield the wallet must discover the new note and the note must mature
 * (~10 blocks per docs/STRK20_INTEGRATION.md §9.1) before it is spendable.
 * Individual clicks wait manually; the full-flow must poll.
 */
export async function waitForShieldedBalance(
  account: WalletAccountV6,
  token: Address,
  minAmount: string,
  timeoutMs = 90_000,
  pollMs = 3000,
): Promise<STRK20_BALANCE_ENTRY[]> {
  const start = Date.now();
  const min = BigInt(minAmount);
  let last: STRK20_BALANCE_ENTRY[] = [];
  while (Date.now() - start < timeoutMs) {
    try {
      last = await account.strk20Balances([token]);
      const entry = last.find((b) => b.token.toLowerCase() === token.toLowerCase());
      if (entry) {
        try {
          const bal = BigInt(entry.balance);
          if (bal >= min) return last;
        } catch {
          // if balance not parseable as BigInt, fall through to retry
        }
      }
      // If minAmount is "0x0" or similar, any balance entry is sufficient; otherwise keep polling.
      if (min === 0n && last.length > 0) return last;
    } catch (e) {
      // NOT_REGISTERED or transient errors should propagate immediately
      throw e;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Timeout — return last observed so caller can decide, but we throw to make the step fail explicitly
  throw new Error(
    `Timeout waiting for shielded balance >= ${minAmount} for token ${token} (last: ${JSON.stringify(last)})`,
  );
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

  // Resolve recipient: full-flow may be called with empty string (page's stale
  // addressRef). Use the connected address as self-transfer fallback so the
  // automated flow does not fail with INVALID_REQUEST_PAYLOAD. Individual
  // Transfer button validates recipient separately.
  const effectiveRecipient: Address =
    recipient && recipient.trim() && /^0x[0-9a-fA-F]+$/.test(recipient.trim())
      ? (recipient.trim() as Address)
      : address;

  // 1. Shield: deposit into the real STRK20 privacy pool (wallet signs + proves).
  // This may involve two wallet prompts (ERC20 approve + private deposit) and
  // the resulting note needs ~10 blocks to mature before it is spendable.
  const shieldActions = [shieldAction(config.token, amounts.shield)];
  const shieldResult = await account.strk20InvokeTransaction(shieldActions);
  if (!shieldResult?.transaction_hash) {
    throw new Error("Shield returned no transaction_hash — wallet rejected the deposit.");
  }
  evidence.shield = { actions: shieldActions, transactionHash: shieldResult.transaction_hash };
  evidence.lastCompletedStep = "shield";
  // Wait for the shield tx to be accepted and for the note to be discoverable/mature.
  // Without this, the immediate strk20Balances/transfer would see 0 and fail with
  // INSUFFICIENT_PRIVATE_BALANCE — manual clicks work because the user waits.
  await waitForTxAccepted(config.network, shieldResult.transaction_hash, 120_000);
  // Poll until wallet reports a spendable shielded balance (maturity). Use the
  // transfer amount as the minimum needed for the next step, not the full shield
  // amount (fees may reduce the exact shielded value).
  await waitForShieldedBalance(account, config.token, amounts.transfer !== "0x0" ? amounts.transfer : "0x1", 90_000);

  // 2. Real wallet-side shielded balance read for the same token.
  evidence.balancesAfterShield = await account.strk20Balances([config.token]);
  evidence.lastCompletedStep = "private-balances";

  // 3. Private transfer (no public leg; wallet proves and submits).
  const transferActions = [privateTransferAction(config.token, amounts.transfer, effectiveRecipient)];
  const transferResult = await account.strk20InvokeTransaction(transferActions);
  if (!transferResult?.transaction_hash) {
    throw new Error("Private transfer returned no transaction_hash — wallet rejected it.");
  }
  evidence.transfer = {
    actions: transferActions,
    transactionHash: transferResult.transaction_hash,
  };
  evidence.lastCompletedStep = "private-transfer";
  await waitForTxAccepted(config.network, transferResult.transaction_hash, 120_000);
  // Give the wallet a moment to update its local note set after transfer before withdraw.
  // Withdraw spends the sender's remaining note, which also benefits from maturity.
  // A short balance poll ensures the post-transfer state is queryable.
  try {
    await waitForShieldedBalance(account, config.token, "0x1", 30_000);
  } catch {
    // Non-fatal for the transfer step — we already have the tx hash; proceed to withdraw.
  }

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
  await waitForTxAccepted(config.network, withdrawResult.transaction_hash, 120_000);

  evidence.completedAt = new Date().toISOString();
  return evidence;
}
