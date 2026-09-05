"use client";

/**
 * VERITY — Phase 1 proof runner (dev-only page, NOT the Phase 6 product UI).
 *
 * Drives apps/web/strk20-proof/strk20-proof.ts against the user's real
 * STRK20-capable browser wallet on Sepolia. Every transaction hash and balance
 * shown comes from a real wallet response; nothing is simulated.
 *
 * Manual gate actions required from the user (agent cannot perform these):
 *   1. Connect wallet (approve in the extension).
 *   2. Sign each STRK20 operation (shield / transfer / unshield).
 */

import { useRef, useState } from "react";
import type { WalletAccountV6 } from "starknet";
import {
  connectWallet,
  createStrk20Account,
  detectStrk20Capability,
  privateTransferAction,
  runPhase1Proof,
  shieldAction,
  withdrawAction,
  WALLET_API_MIN_VERSION,
  type Address,
  type Phase1Evidence,
  type Phase1Step,
} from "@/strk20-proof/strk20-proof";
import { STRK20, STRK_TOKEN_ADDRESS } from "@/lib/strk20";
import { VERITY_NETWORKS } from "@/lib/starknet";

/** Convert a decimal STRK amount to base units (18 decimals) with string math. */
function toBaseUnits(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid amount: ${input}`);
  const [whole, frac = ""] = trimmed.split(".");
  const frac18 = (frac + "0".repeat(18)).slice(0, 18);
  return "0x" + BigInt(whole + frac18).toString(16);
}

const NETWORK = "sepolia" as const;
const EXPLORER = VERITY_NETWORKS.sepolia.explorerUrl;

export default function Phase1ProofPage() {
  const accountRef = useRef<WalletAccountV6 | null>(null);
  const addressRef = useRef<Address | null>(null);
  const [step, setStep] = useState<Phase1Step>("connect");
  const [evidence, setEvidence] = useState<Partial<Phase1Evidence>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shieldAmt, setShieldAmt] = useState("1");
  const [transferAmt, setTransferAmt] = useState("0.1");
  const [withdrawAmt, setWithdrawAmt] = useState("0.5");
  const [recipient, setRecipient] = useState("");

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const connect = () => guard(async () => {
    const { wallet, address, walletId, walletName, chainId } = await connectWallet();
    addressRef.current = address;
    const cap = await detectStrk20Capability(wallet);
    if (!cap.supported) {
      throw new Error(
        `Wallet API ${cap.walletApiVersions.join(", ") || "none"} < ${WALLET_API_MIN_VERSION}. ` +
          "Use Ready (formerly Argent).",
      );
    }
    accountRef.current = await createStrk20Account(wallet, { network: NETWORK, token: STRK_TOKEN_ADDRESS });
    setStep("feature-detect");
    setEvidence((p) => ({
      ...p,
      network: NETWORK,
      poolAddress: STRK20[NETWORK].poolAddress,
      tokenAddress: STRK_TOKEN_ADDRESS,
      walletId,
      walletName,
      walletAddress: address,
      ...(chainId ? { chainId } : {}),
      walletApiVersions: cap.walletApiVersions,
      walletApiSupported: true,
    }));
  });

  const shield = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    const actions = [shieldAction(STRK_TOKEN_ADDRESS, toBaseUnits(shieldAmt))];
    const res = await acc.strk20InvokeTransaction(actions);
    if (!res?.transaction_hash) throw new Error("Shield returned no transaction_hash.");
    setStep("shield");
    setEvidence((p) => ({ ...p, shield: { actions, transactionHash: res.transaction_hash } }));
  });

  const balances = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    const list = await acc.strk20Balances([STRK_TOKEN_ADDRESS]);
    setStep("private-balances");
    setEvidence((p) => ({ ...p, balancesAfterShield: list }));
  });

  const transfer = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    if (!/^0x[0-9a-fA-F]+$/.test(recipient.trim())) throw new Error("Enter a valid recipient address (0x…).");
    const actions = [privateTransferAction(STRK_TOKEN_ADDRESS, toBaseUnits(transferAmt), recipient.trim() as Address)];
    const res = await acc.strk20InvokeTransaction(actions);
    if (!res?.transaction_hash) throw new Error("Transfer returned no transaction_hash.");
    setStep("private-transfer");
    setEvidence((p) => ({ ...p, transfer: { actions, transactionHash: res.transaction_hash } }));
  });

  const withdraw = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    const to = (addressRef.current ?? recipient.trim()) as Address;
    const actions = [withdrawAction(STRK_TOKEN_ADDRESS, toBaseUnits(withdrawAmt), to)];
    const res = await acc.strk20InvokeTransaction(actions);
    if (!res?.transaction_hash) throw new Error("Withdraw returned no transaction_hash.");
    setStep("withdraw");
    setEvidence((p) => ({
      ...p,
      withdraw: { actions, transactionHash: res.transaction_hash },
      completedAt: new Date().toISOString(),
    }));
  });

  const runAll = () => guard(async () => {
    const full = await runPhase1Proof(
      { network: NETWORK, token: STRK_TOKEN_ADDRESS },
      {
        shield: toBaseUnits(shieldAmt),
        transfer: toBaseUnits(transferAmt),
        withdraw: toBaseUnits(withdrawAmt),
      },
      (recipient.trim() || (addressRef.current ?? "")) as Address,
    );
    accountRef.current = null;
    setStep(full.lastCompletedStep);
    setEvidence(full);
  });

  const btn = "rounded border px-3 py-1 text-sm disabled:opacity-40";
  const txLink = (h?: string) =>
    h ? (
      <a className="underline" href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">
        {h}
      </a>
    ) : (
      "—"
    );

  return (
    <main className="mx-auto max-w-3xl p-6 text-sm">
      <h1 className="text-lg font-semibold">VERITY — Phase 1 STRK20 proof (Sepolia)</h1>
      <p className="mt-1 opacity-80">
        Pool <code>{STRK20[NETWORK].poolAddress}</code> · last completed step <b>{step}</b>
      </p>

      <div className="mt-4 grid gap-2">
        <label>
          Shield amount (STRK):{" "}
          <input className="border px-2 py-1" value={shieldAmt} onChange={(e) => setShieldAmt(e.target.value)} />
        </label>
        <label>
          Transfer amount (STRK):{" "}
          <input className="border px-2 py-1" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} />
        </label>
        <label>
          Withdraw amount (STRK):{" "}
          <input className="border px-2 py-1" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} />
        </label>
        <label>
          Recipient (0x…, optional for transfer):{" "}
          <input className="w-full border px-2 py-1" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={connect}>1 · Connect + detect</button>
        <button className={btn} disabled={busy} onClick={shield}>2 · Shield</button>
        <button className={btn} disabled={busy} onClick={balances}>3 · Balances</button>
        <button className={btn} disabled={busy} onClick={transfer}>4 · Transfer</button>
        <button className={btn} disabled={busy} onClick={withdraw}>5 · Withdraw</button>
        <button className={btn} disabled={busy} onClick={runAll}>Run full flow</button>
      </div>

      {busy && <p className="mt-3">Waiting for the wallet… approve the prompt.</p>}
      {error && <p className="mt-3 text-red-600">Error: {error}</p>}

      <h2 className="mt-6 font-semibold">Evidence (real wallet responses only)</h2>
      <pre className="mt-2 overflow-auto border bg-black/5 p-3 text-xs">
        {JSON.stringify(evidence, null, 2)}
      </pre>
      <ul className="mt-2 text-xs opacity-80">
        <li>shield tx: {txLink(evidence.shield?.transactionHash)}</li>
        <li>transfer tx: {txLink(evidence.transfer?.transactionHash)}</li>
        <li>withdraw tx: {txLink(evidence.withdraw?.transactionHash)}</li>
      </ul>
    </main>
  );
}