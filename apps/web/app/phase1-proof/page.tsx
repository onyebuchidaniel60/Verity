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

  function formatWalletError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    // Wallet API error 118 — NOT_REGISTERED is a prerequisite state, not a code bug.
    // Surface actionable guidance instead of a raw code.
    if (msg.includes("NOT_REGISTERED") || msg.includes("code: 118") || msg.includes("code\":118")) {
      return (
        msg +
        " — Wallet is not registered with the STRK20 privacy pool on this network. " +
        "Open Ready X → enable STRK20 / Privacy, ensure the account is created for Sepolia, " +
        "fund it with Sepolia STRK (you need ~4 STRK fee per private tx), then reload and re-connect. " +
        "This affects Shield/Balances/Transfer/Withdraw equally — they all require registration first (wallet_strk20* spec)."
      );
    }
    return msg;
  }

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(formatWalletError(e)); }
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
    const token = STRK_TOKEN_ADDRESS as Address;
    const amount = toBaseUnits(shieldAmt);
    const actions = [shieldAction(token, amount)];
    console.info("[phase1-proof] shield -> wallet_strk20InvokeTransaction", { actions, token, amount, pool: STRK20[NETWORK].poolAddress });
    const res = await acc.strk20InvokeTransaction(actions);
    if (!res?.transaction_hash) throw new Error("Shield returned no transaction_hash.");
    setStep("shield");
    setEvidence((p) => ({ ...p, shield: { actions, transactionHash: res.transaction_hash } }));
  });

  const balances = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    const token = STRK_TOKEN_ADDRESS as Address;
    console.info("[phase1-proof] balances -> wallet_strk20Balances", { tokens: [token] });
    const list = await acc.strk20Balances([token]);
    setStep("private-balances");
    setEvidence((p) => ({ ...p, balancesAfterShield: list }));
  });

  const transfer = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    if (!/^0x[0-9a-fA-F]+$/.test(recipient.trim())) throw new Error("Enter a valid recipient address (0x…).");
    const token = STRK_TOKEN_ADDRESS as Address;
    const amount = toBaseUnits(transferAmt);
    const to = recipient.trim() as Address;
    const actions = [privateTransferAction(token, amount, to)];
    console.info("[phase1-proof] transfer -> wallet_strk20InvokeTransaction", { actions, token, amount, recipient: to });
    const res = await acc.strk20InvokeTransaction(actions);
    if (!res?.transaction_hash) throw new Error("Transfer returned no transaction_hash.");
    setStep("private-transfer");
    setEvidence((p) => ({ ...p, transfer: { actions, transactionHash: res.transaction_hash } }));
  });

  const withdraw = () => guard(async () => {
    const acc = accountRef.current;
    if (!acc) throw new Error("Connect the wallet first.");
    const token = STRK_TOKEN_ADDRESS as Address;
    const amount = toBaseUnits(withdrawAmt);
    const to = (addressRef.current ?? recipient.trim()) as Address;
    const actions = [withdrawAction(token, amount, to)];
    console.info("[phase1-proof] withdraw -> wallet_strk20InvokeTransaction", { actions, token, amount, recipient: to });
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

      {busy && <p className="mt-3">Waiting for the wallet… approve the prompt. This can take 10–30s for STRK20 proof generation.</p>}
      {error && (
        <div className="mt-3 text-red-600">
          <p>Error: {error}</p>
          {error.includes("NOT_REGISTERED") && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              <li>Which Wallet API call failed: <code>wallet_strk20InvokeTransaction</code> (shield/transfer/withdraw) or <code>wallet_strk20Balances</code> (balances) — check browser console for params.</li>
              <li>Param shape must be: shield <code>&#123;type: &apos;deposit&apos;, token, amount&#125;</code>, transfer <code>&#123;type: &apos;transfer&apos;, token, amount, recipient&#125;</code>, withdraw <code>&#123;type: &apos;withdraw&apos;, token, amount, recipient&#125;</code> — current code matches the 0.10.3 spec.</li>
              <li>Wallet API version exposed by Ready X on this page is shown above (<code>walletApiVersions</code>); need <code>&gt;= 0.10.3</code> for these methods.</li>
              <li>Pool/token addresses for Sepolia are <code>{STRK20[NETWORK].poolAddress}</code> / <code>{STRK_TOKEN_ADDRESS}</code> (verified deployed via on-chain probe).</li>
              <li>Registration is the gate: every STRK20 Wallet API method lists <code>NOT_REGISTERED</code> (code 118) when the account has not yet joined the pool. No code change bypasses it — register in the wallet UI first.</li>
            </ul>
          )}
        </div>
      )}

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