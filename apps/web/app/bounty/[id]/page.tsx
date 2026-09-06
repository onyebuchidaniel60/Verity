"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Contract, validateAndParseAddress } from "starknet";
import { connectWallet, createStrk20Account, type Address } from "@/strk20-proof/strk20-proof";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";
import { STRK20 } from "@/lib/strk20";
import { useWalletStore } from "@/store/wallet";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;

const STATUS_META: Record<string, { label: string; cls: string; desc: string }> = {
  "0": { label: "Created", cls: "badge-created", desc: "Waiting to be funded" },
  "1": { label: "Funded", cls: "badge-funded", desc: "Ready to open" },
  "2": { label: "Open", cls: "badge-open", desc: "Accepting entries" },
  "3": { label: "Voting", cls: "badge-voting", desc: "Under review" },
  "4": { label: "Winner Selected", cls: "badge-winner", desc: "Winner chosen" },
  "5": { label: "Claimable", cls: "badge-claimable", desc: "Ready to release" },
  "6": { label: "Paid", cls: "badge-paid", desc: "Completed" },
  "7": { label: "Refunded", cls: "badge-refunded", desc: "Refunded" },
};

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function normalizeAddr(a: string): string | null {
  try {
    return validateAndParseAddress(a).toLowerCase();
  } catch {
    try {
      return ("0x" + BigInt(a).toString(16).padStart(64, "0")).toLowerCase();
    } catch {
      return a?.toLowerCase() ?? null;
    }
  }
}

function formatReward(v: any): string {
  try {
    const n = BigInt(v ?? 0);
    if (n === 0n) return "0 STRK";
    const weiPerStrk = 1000000000000000000n;
    const whole = n / weiPerStrk;
    const frac = n % weiPerStrk;
    if (frac === 0n) {
      return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} STRK`;
    }
    let fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    // Limit display to 6 decimals for readability, but keep meaningful precision
    if (fracStr.length > 6) {
      // Show up to 6 decimals, trim trailing zeros already done
      fracStr = fracStr.slice(0, 6).replace(/0+$/, "");
    }
    if (whole === 0n) {
      // For <1 STRK, show 0.xxx
      return `0.${fracStr} STRK`;
    }
    const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${wholeFormatted}.${fracStr} STRK`;
  } catch {
    return String(v ?? "—");
  }
}

function weiToStr(wei: string | bigint): string {
  try {
    const n = BigInt(wei);
    const weiPerStrk = 1000000000000000000n;
    const whole = n / weiPerStrk;
    const frac = n % weiPerStrk;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return String(wei);
  }
}

function humanToWei(s: string): string {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Please enter a valid amount");
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) throw new Error("Too many decimal places (max 18)");
  const frac18 = (frac + "0".repeat(18)).slice(0, 18);
  const weiStr = (whole === "0" || whole === "" ? "0" : whole) + frac18;
  // Remove leading zeros but keep at least one digit
  const normalized = weiStr.replace(/^0+/, "") || "0";
  return BigInt(normalized).toString();
}

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [bounty, setBounty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [evidenceHash, setEvidenceHash] = useState("");
  const [voteSubmission, setVoteSubmission] = useState("1");
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [fundAmount, setFundAmount] = useState("");
  const [fundAmountError, setFundAmountError] = useState<string | null>(null);
  const [connectedAddr, setConnectedAddr] = useState<string | null>(null);
  const [isVerifier, setIsVerifier] = useState<boolean | null>(null);

  const walletStoreAddr = useWalletStore((s) => s.address);
  const walletConnected = useWalletStore((s) => s.connected);

  const provider = createProvider(NETWORK);
  const bountyAbi = [
    { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" },
    { name: "get_submission_count", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
    { name: "get_submission", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ name: "submission", type: "Submission" }], stateMutability: "view" },
  ] as const;

  function getStoredMeta(bountyId: number) {
    try {
      const raw = localStorage.getItem(`verity_bounty_${bountyId}`);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  function feltToTitle(felt: any): string | null {
    try {
      const hex = BigInt(felt).toString(16);
      const padded = hex.padStart(62, "0");
      const buf = Buffer.from(padded, "hex");
      const str = buf.toString("utf-8").replace(/\0/g, "").trim();
      if (str && /^[\x20-\x7E ]+$/.test(str)) return str;
    } catch {}
    return null;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const c = new Contract({ abi: bountyAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const r: any = await c.call("get_bounty", [id]);
      const b = r?.bounty ?? r;
      setBounty(b);
      // Prefill funding amount with reward in STRK if empty
      const rewardWei = b?.reward_amount ?? b?.[2] ?? 0;
      const rewardStr = weiToStr(rewardWei);
      if (!fundAmount) {
        // Only prefill once, keep user edits afterwards
        setFundAmount(rewardStr === "0" ? "" : rewardStr);
      }
      // Load submissions
      try {
        const cnt: any = await c.call("get_submission_count", [id]);
        const count = Number(cnt?.count ?? cnt ?? 0);
        const list: any[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const s: any = await c.call("get_submission", [id, i]);
            const sub = s?.submission ?? s;
            const vAbi = [{ name: "get_vote_count", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ name: "count", type: "core::integer::u32" }], stateMutability: "view" }] as const;
            const c2 = new Contract({ abi: vAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
            const vc: any = await c2.call("get_vote_count", [id, i]);
            const votes = Number(vc?.count ?? vc ?? 0);
            list.push({ id: i, ...sub, votes });
          } catch {}
        }
        setSubmissions(list);
      } catch {}
      // Check verifier status if connected
      if (walletStoreAddr) {
        try {
          const vAbi = [{ name: "is_verifier", type: "function", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ name: "is_ver", type: "core::bool" }], stateMutability: "view" }] as const;
          const c3 = new Contract({ abi: vAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
          const res: any = await c3.call("is_verifier", [walletStoreAddr]);
          const isV = res?.is_ver ?? res?.[0] ?? res;
          setIsVerifier(Boolean(isV));
        } catch {
          setIsVerifier(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    // Keep connectedAddr in sync with wallet store and also try to read from connectWallet if needed
    if (walletStoreAddr) setConnectedAddr(walletStoreAddr);
    else setConnectedAddr(null);
  }, [walletStoreAddr]);

  // Also on mount, try to get address from wallet if store empty but wallet is connected via discovery
  useEffect(() => {
    async function syncAddr() {
      if (!walletStoreAddr && typeof window !== "undefined") {
        try {
          // Don't auto-connect, just try to read if already connected via previous page
        } catch {}
      }
    }
    syncAddr();
  }, []);

  async function ensureConnected(): Promise<string> {
    if (connectedAddr && walletConnected) return connectedAddr;
    const { address } = await connectWallet();
    setConnectedAddr(address);
    return address;
  }

  async function guard(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setTxHash(null);
    try {
      const hash = await fn();
      if (hash) setTxHash(hash);
      await load();
    } catch (e: any) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      const msgLower = rawMsg.toLowerCase();
      console.error(`[bounty ${id}] ${key} failed`, e);
      // Deep inspection for paymaster/contract revert
      try {
        console.error(`[bounty ${id}] error details`, {
          code: e?.code,
          message: e?.message,
          data: e?.data,
          cause: e?.cause,
          execution_error: e?.data?.execution_error ?? e?.cause?.data?.execution_error,
          revert_error: e?.data?.revert_error,
          full: (() => {
            try { return JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 4000); } catch { return String(e); }
          })()
        });
      } catch {}
      if (rawMsg.includes("USER_REFUSED") || rawMsg.includes("UserRejected") || msgLower.includes("user rejected") || msgLower.includes("cancelled")) {
        setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      } else if (msgLower.includes("not_registered") || msgLower.includes("118")) {
        setError("Your wallet isn’t registered for private transactions yet. Open your wallet, enable private mode, and try again.");
      } else if (msgLower.includes("insufficient") || msgLower.includes("balance") || msgLower.includes("insufficient_private_balance")) {
        setError("Insufficient funds. Make sure you have enough STRK (and private balance if required) and try again.");
      } else if (msgLower.includes("not_verifier")) {
        setError("Only verified reviewers can vote on this bounty.");
      } else if (msgLower.includes("already_voted")) {
        setError("You’ve already voted on this bounty.");
      } else if (msgLower.includes("invalid_request_payload")) {
        setError("We couldn’t prepare the private transaction. Please check the amount and try again.");
      } else if (msgLower.includes("not_pool") || msgLower.includes("not_anonymizer")) {
        setError("This action must go through the secure private flow. Please use the provided button.");
      } else if (msgLower.includes("amount_mismatch")) {
        setError("Funding amount does not match the bounty reward. Please enter the exact reward amount.");
      } else if (msgLower.includes("not_created")) {
        setError("This bounty can’t be funded right now — it’s no longer in the created state. Please refresh.");
      } else if (msgLower.includes("paymaster") || msgLower.includes("transaction_execution_error") || msgLower.includes("156")) {
        // Check underlying data for more specific revert reason
        const dataStr = JSON.stringify(e?.data ?? e?.cause ?? "");
        if (dataStr.includes("AMOUNT_MISMATCH")) setError("Funding amount does not match the bounty reward. Please enter the exact reward shown.");
        else if (dataStr.includes("NOT_CREATED")) setError("This bounty is already funded or not in a state that can be funded.");
        else if (dataStr.includes("BOUNTY_NOT_FOUND")) setError("Bounty not found on-chain. It may not exist or the network is unavailable.");
        else if (dataStr.includes("REPLAY")) setError("This transaction was already processed. Please refresh and try again.");
        else if (dataStr.includes("INSUFFICIENT")) setError("Insufficient balance for this transaction. Add funds and try again.");
        else if (dataStr.includes("NOT_REGISTERED")) setError("Your wallet isn’t registered for private transactions yet. Enable private mode in your wallet.");
        else setError("Transaction failed during execution. This can be due to amount, bounty status, or funds. See console for details and try again.");
      } else if (msgLower.includes("validate unhandled")) {
        setError("We couldn’t prepare the transaction. Please try a different amount.");
      } else if (msgLower.includes("not_claimable") || msgLower.includes("claimable")) {
        setError("This bounty is not ready to be claimed yet.");
      } else if (msgLower.includes("not_authorized_claim") || msgLower.includes("not_authorized")) {
        setError("Only the winning entry can claim this reward.");
      } else {
        // Generic but retain hint that details are in console
        setError("Something went wrong. Please try again. (See console for technical details)");
      }
    } finally {
      setBusy(null);
    }
  }

  const fundPrivate = () =>
    guard("fund", async () => {
      if (!bounty) throw new Error("Bounty not loaded");
      const rewardWei = bounty.reward_amount ?? bounty.rewardAmount ?? bounty[2] ?? 0;
      const rewardWeiStr = BigInt(String(rewardWei)).toString();
      // Validate user-entered amount
      if (!fundAmount.trim()) {
        setFundAmountError("Please enter an amount");
        throw new Error("Please enter a funding amount");
      }
      let enteredWei: string;
      try {
        enteredWei = humanToWei(fundAmount);
      } catch (e: any) {
        setFundAmountError(e.message);
        throw e;
      }
      if (BigInt(enteredWei) <= 0n) {
        setFundAmountError("Amount must be greater than 0");
        throw new Error("Amount must be greater than 0");
      }
      // Enforce exact match with bounty reward (contract requires equality)
      if (BigInt(enteredWei) !== BigInt(rewardWeiStr)) {
        const rewardStr = formatReward(rewardWeiStr);
        setFundAmountError(`Amount must equal the bounty reward: ${rewardStr}`);
        throw new Error(`AMOUNT_MISMATCH: entered ${enteredWei} != reward ${rewardWeiStr}`);
      }
      setFundAmountError(null);
      const address = await ensureConnected();
      const { wallet } = await connectWallet();
      // Re-use address from ensureConnected, but also ensure wallet matches
      const cap = await (await import("@/strk20-proof/strk20-proof")).detectStrk20Capability(wallet);
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      // Pre-check private balance to avoid paymaster failure due to insufficient private funds
      try {
        const balances: any = await account.strk20Balances([STRK20[NETWORK].strkTokenAddress as Address]);
        console.info("[fundPrivate] private balances before", balances);
        const entry = (balances as any[]).find((b: any) => String(b.token).toLowerCase() === STRK20[NETWORK].strkTokenAddress.toLowerCase());
        if (entry) {
          const bal = BigInt(entry.balance);
          if (bal < BigInt(enteredWei)) {
            throw new Error(`INSUFFICIENT_PRIVATE_BALANCE: private balance ${entry.balance} (${formatReward(entry.balance)}) < required ${enteredWei} (${formatReward(enteredWei)}) — shield more STRK first`);
          }
        } else {
          console.warn("[fundPrivate] no private balance entry for STRK — wallet may be not registered or zero");
        }
      } catch (e: any) {
        if (String(e.message).includes("NOT_REGISTERED") || String(e.message).includes("118")) throw e;
        if (String(e.message).includes("INSUFFICIENT")) throw e;
        console.warn("[fundPrivate] private balance check skipped (non-fatal)", e?.message);
      }
      const bountyId = Number(id);
      const amountFelt = "0x" + BigInt(enteredWei).toString(16);
      const bountyIdFelt = "0x" + BigInt(String(bountyId)).toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operation = "0x46554e445f424f554e5459"; // 'FUND_BOUNTY' as felt
      const actionArray = [
        { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyIdFelt, amountFelt, nonce, "${openNoteIds[0]}"] } as any,
      ];
      console.info("[fundPrivate] STRK20 action array", JSON.stringify(actionArray, null, 2));
      actionArray.forEach((act: any, idx: number) => {
        console.info(`[fundPrivate] action[${idx}]`, act);
        if (act.calldata) {
          act.calldata.forEach((c: any, j: number) => {
            console.info(`[fundPrivate] action[${idx}].calldata[${j}]`, { value: c, type: typeof c, stringValue: String(c) });
          });
        }
      });
      console.info("[fundPrivate] pool", POOL, "token", STRK20[NETWORK].strkTokenAddress, "bountyId", bountyId, "bountyIdFelt", bountyIdFelt, "reward FRI", amountFelt, "enteredWei", enteredWei, "nonce", nonce);
      console.info("[fundPrivate] wallet API versions", cap.walletApiVersions, "supported", cap.supported);
      console.info("[fundPrivate] VerityAnonymizer", CONTRACTS.verityAnonymizer, "BountyManager", CONTRACTS.bountyManager);
      // Pre-flight: verify bounty is still Created
      try {
        const checkContract = new Contract({ abi: [{ name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const chk: any = await checkContract.call("get_bounty", [bountyId]);
        const chkB = chk?.bounty ?? chk;
        const status = String(chkB?.status ?? chkB?.[3] ?? "");
        console.info("[fundPrivate] bounty status before", chkB, "statusKey", status);
        if (status !== "0" && status !== "CREATED" && status !== "Created") {
          throw new Error(`NOT_CREATED: bounty status is ${status}, expected Created (0)`);
        }
        // Also verify pool and anonymizer wiring
        const anonCheck = new Contract({ abi: [{ name: "get_pool", type: "function", inputs: [], outputs: [{ name: "pool", type: "core::starknet::contract_address::ContractAddress" }], stateMutability: "view" }] as any, address: CONTRACTS.verityAnonymizer!, providerOrAccount: provider });
        const poolOnChain: any = await anonCheck.call("get_pool", []);
        const poolAddr = poolOnChain?.pool ?? poolOnChain;
        console.info("[fundPrivate] on-chain VerityAnonymizer.get_pool()", poolAddr, "expected", POOL);
      } catch (e: any) {
        console.warn("[fundPrivate] pre-flight check warning", e);
        // Don't block if check fails due to network, but surface NOT_CREATED explicitly
        if (String(e.message).includes("NOT_CREATED")) throw e;
      }
      try {
        console.info("[fundPrivate] calling wallet_strk20InvokeTransaction with", JSON.stringify(actionArray, null, 2));
        const res: any = await account.strk20InvokeTransaction(actionArray);
        console.info("[fundPrivate] wallet response", res);
        return res.transaction_hash ?? res.hash;
      } catch (e: any) {
        console.error("[fundPrivate] wallet_strk20InvokeTransaction error", e);
        console.error("[fundPrivate] error code", e?.code, "message", e?.message, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        try {
          console.error("[fundPrivate] full error", JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 8000));
        } catch {}
        // Try to surface inner Starknet revert
        const inner = e?.data?.execution_error ?? e?.cause?.data?.execution_error ?? e?.data?.revert_error ?? "";
        if (inner) console.error("[fundPrivate] inner execution_error", inner);
        throw e;
      }
    });

  const open = () =>
    guard("open", async () => {
      const { wallet } = await connectWallet();
      const addr = await ensureConnected();
      // Only creator or owner can open. Let contract enforce, but pre-check for nicer message.
      const creator = bounty?.creator ?? bounty?.[1];
      if (creator && connectedAddr) {
        const normCreator = normalizeAddr(String(creator));
        const normConnected = normalizeAddr(connectedAddr);
        if (normCreator && normConnected && normCreator !== normConnected) {
          // Check if connected is owner? For now, allow only creator; otherwise warn
          // But contract allows creator or owner. We don't know owner address off-chain easily, so allow attempt and let contract revert with NOT_CREATOR.
          console.info("[open] non-creator trying to open", { creator, connectedAddr });
        }
      }
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "open_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("open_bounty", [id]);
      return res.transaction_hash ?? res.hash;
    });

  const submit = () =>
    guard("submit", async () => {
      if (!evidenceHash.trim()) throw new Error("Please add an entry reference");
      const creator = bounty?.creator ?? bounty?.[1];
      const normCreator = creator ? normalizeAddr(String(creator)) : null;
      const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
      if (normCreator && normConnected && normCreator === normConnected) {
        throw new Error("This is your bounty. You can't submit an entry to your own bounty.");
      }
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "submit_evidence", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "evidence_hash", type: "core::felt252" }], outputs: [{ name: "submission_id", type: "core::integer::u64" }], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("submit_evidence", [id, evidenceHash]);
      return res.transaction_hash ?? res.hash;
    });

  const vote = () =>
    guard("vote", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      // Pre-check verifier
      if (isVerifier === false) throw new Error("NOT_VERIFIER: Only verified reviewers can vote");
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "vote", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("vote", [id, Number(voteSubmission)]);
      return res.transaction_hash ?? res.hash;
    });

  const claim = () =>
    guard("claim", async () => {
      const winner = bounty?.winner ?? bounty?.[7];
      const normWinner = winner ? normalizeAddr(String(winner)) : null;
      const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
      if (normWinner && normConnected && normWinner !== normConnected) {
        throw new Error("NOT_AUTHORIZED_CLAIM: Only the winner can claim this reward");
      }
      if (!winner || String(winner) === "0x0" || winner === 0) {
        throw new Error("No winner selected yet");
      }
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const bountyIdFelt = "0x" + BigInt(bountyId).toString(16);
      const amountFelt = "0x" + BigInt(String(bounty?.reward_amount ?? bounty?.rewardAmount ?? 1000)).toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operation = "0x52454c45415345"; // 'RELEASE' as felt
      const actionArray = [
        { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyIdFelt, amountFelt, nonce, "${openNoteIds[0]}"] } as any,
      ];
      console.info("[claim] STRK20 action array", JSON.stringify(actionArray, null, 2));
      try {
        const res: any = await account.strk20InvokeTransaction(actionArray);
        console.info("[claim] wallet response", res);
        return res.transaction_hash ?? res.hash;
      } catch (e: any) {
        console.error("[claim] wallet_strk20InvokeTransaction error", e);
        console.error("[claim] error code", e?.code, "message", e?.message, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        try {
          console.error("[claim] full error", JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 8000));
        } catch {}
        throw e;
      }
    });

  if (loading) {
    return (
      <main>
        <div className="skeleton skeleton-line medium" style={{ width: 120, height: 24, marginBottom: 16 }} />
        <div className="card card-pad">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      </main>
    );
  }

  if (error && !bounty) {
    return (
      <main>
        <div className="alert alert-error">
          <span>⚠</span>
          <div>
            <strong>Bounty not found</strong>
            <div style={{ opacity: 0.8, marginTop: 4 }}>It may not exist or the network is unavailable. Try again.</div>
          </div>
        </div>
        <Link href="/bounties" className="btn btn-secondary" style={{ marginTop: 16 }}>
          Back to bounties
        </Link>
      </main>
    );
  }

  const statusKey = String(bounty?.status ?? bounty?.[3] ?? "0");
  const meta = STATUS_META[statusKey] ?? { label: statusKey, cls: "badge-created", desc: "" };
  const reward = bounty?.reward_amount ?? bounty?.[2] ?? 0;
  const rewardStr = formatReward(reward);
  const storedMeta = (() => {
    const m = getStoredMeta(Number(id));
    if (m?.title) return m;
    const feltTitle = feltToTitle(bounty?.metadata_hash ?? bounty?.[4]);
    if (feltTitle) return { title: feltTitle, description: "" };
    return null;
  })();
  const displayTitle = storedMeta?.title || `Bounty #${id}`;
  const displayDesc = storedMeta?.description || "Investigation bounty — evidence helps verify the claim.";
  const isPaid = statusKey === "6" || statusKey === "PAID";
  const isClaimable = statusKey === "5" || statusKey === "CLAIMABLE";
  const isVoting = statusKey === "3" || statusKey === "VOTING";
  const isOpen = statusKey === "2" || statusKey === "OPEN";
  const isFunded = statusKey === "1" || statusKey === "FUNDED";
  const isCreated = statusKey === "0" || statusKey === "CREATED";
  const creatorAddr = String(bounty?.creator ?? bounty?.[1] ?? "");
  const winnerAddr = String(bounty?.winner ?? bounty?.[7] ?? "");
  const normCreator = normalizeAddr(creatorAddr);
  const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
  const normWinner = normalizeAddr(winnerAddr);
  const isCreator = !!(normCreator && normConnected && normCreator === normConnected);
  const isWinner = !!(normWinner && normConnected && normWinner === normConnected && normWinner !== "0x0000000000000000000000000000000000000000000000000000000000000000");

  const timeline = [
    { key: "Created", done: true, current: isCreated },
    { key: "Funded", done: !isCreated, current: isFunded },
    { key: "Open", done: isOpen || isVoting || isClaimable || isPaid, current: isOpen },
    { key: "Voting", done: isVoting || isClaimable || isPaid, current: isVoting },
    { key: "Winner", done: isClaimable || isPaid, current: isClaimable },
    { key: "Paid", done: isPaid, current: isPaid },
  ];

  return (
    <main>
      <Link href="/bounties" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        ← Back to bounties
      </Link>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", lineHeight: 1.2 }}>{displayTitle}</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.5 }}>{displayDesc}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge ${meta.cls}`}>{meta.label}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{meta.desc}</span>
            {isCreator && <span style={{ fontSize: 11, color: "var(--text-muted)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 999 }}>You created this</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 140 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Reward</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>{rewardStr}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Bounty #{id}</div>
        </div>
      </div>

      <div className="timeline" style={{ marginTop: 16, marginBottom: 24 }}>
        {timeline.map((s) => (
          <div key={s.key} className={`timeline-step ${s.done ? "done" : ""} ${s.current ? "current" : ""} ${!s.done && !s.current ? "upcoming" : ""}`}>
            {s.done ? "✓" : "○"} {s.key}
          </div>
        ))}
      </div>

      {bounty && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Details</h3>
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: "var(--text-muted)" }}>Creator</span>
              <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(creatorAddr)} {isCreator && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Created</span>
              <span>{bounty.created_at ? new Date(Number(bounty.created_at) * 1000).toLocaleDateString() : "—"}</span>
            </div>
            {bounty.winner && String(bounty.winner) !== "0x0" && String(bounty.winner) !== "0" && (
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span style={{ color: "var(--text-muted)" }}>Winner</span>
                <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(winnerAddr)} {isWinner && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Network</span>
              <span>Sepolia</span>
            </div>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Actions</h3>
        {/* Contextual guidance */}
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
          {isCreated && (isCreator ? "This bounty is waiting for funding. Enter the reward amount and fund it privately." : "This bounty is waiting for funding. The creator will fund it to make it active.")}
          {isFunded && "Bounty funded. The creator can now open it for entries."}
          {isOpen && (isCreator ? "This is your bounty. You can't submit an entry to your own bounty." : "Bounty is open. Share your entry for review.")}
          {isVoting && "Voting is active. Verified reviewers select the best entry."}
          {isClaimable && (isWinner ? "You won! Claim your reward privately." : isCreator ? "A winner has been selected. You can release the reward." : "A winner has been selected. Awaiting payout.")}
          {isPaid && "This bounty is complete. The reward has been released."}
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {isCreated && (
            <div style={{ display: "grid", gap: 10, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
              <div>
                <label className="label" htmlFor="fund-amount">Funding amount</label>
                <div style={{ position: "relative" }}>
                  <input
                    id="fund-amount"
                    className="input"
                    inputMode="decimal"
                    placeholder={weiToStr(reward)}
                    value={fundAmount}
                    onChange={(e) => {
                      setFundAmount(e.target.value);
                      if (fundAmountError) setFundAmountError(null);
                    }}
                    style={{ paddingRight: 60 }}
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>STRK</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, gap: 8, flexWrap: "wrap" }}>
                  <span className="help" style={{ margin: 0 }}>Required: {formatReward(reward)} — must match exactly</span>
                  <button type="button" className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 12, height: 28 }} onClick={() => setFundAmount(weiToStr(reward))}>Use required amount</button>
                </div>
                {fundAmountError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{fundAmountError}</div>}
              </div>
              <button disabled={!!busy} onClick={fundPrivate} className="btn btn-primary">
                {busy === "fund" ? "Confirm in wallet…" : "Fund privately"}
              </button>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>Your wallet will open to approve the private funding. This uses a secure in-pool transfer.</p>
            </div>
          )}
          {isFunded && (
            <button disabled={!!busy} onClick={open} className="btn btn-primary">
              {busy === "open" ? "Processing…" : isCreator ? "Open for entries" : "Bounty funded — awaiting opening"}
            </button>
          )}
          {isOpen && !isCreator && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="input" placeholder="Entry reference (hash)" value={evidenceHash} onChange={(e) => setEvidenceHash(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <button disabled={!!busy} onClick={submit} className="btn btn-primary">
                {busy === "submit" ? "Submitting…" : "Submit entry"}
              </button>
            </div>
          )}
          {isOpen && isCreator && (
            <div className="alert alert-warn" style={{ margin: 0 }}>
              <span>⚠</span>
              <div><strong>This is your bounty</strong><div style={{ opacity: 0.85, marginTop: 4 }}>You can't submit an entry to your own bounty.</div></div>
            </div>
          )}
          {isVoting && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input className="input" style={{ maxWidth: 120 }} value={voteSubmission} onChange={(e) => setVoteSubmission(e.target.value)} placeholder="Entry ID" />
                <button disabled={!!busy} onClick={vote} className="btn btn-primary">
                  {busy === "vote" ? "Voting…" : "Vote for entry"}
                </button>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>7 of 13 reviewers needed</span>
              </div>
              {isVerifier === false && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Only verified reviewers can vote. Your wallet is not in the reviewer set.</div>}
              {isVerifier === true && <div style={{ fontSize: 12, color: "var(--accent)" }}>You are a verified reviewer.</div>}
            </div>
          )}
          {isClaimable && (
            <>
              {isWinner ? (
                <button disabled={!!busy} onClick={claim} className="btn btn-primary">
                  {busy === "claim" ? "Claiming privately…" : "Claim reward privately"}
                </button>
              ) : isCreator ? (
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  <span>⚠</span>
                  <div><strong>Winner selected</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Only the winning address can claim this reward privately.</div></div>
                </div>
              ) : (
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  <span>⚠</span>
                  <div><strong>Awaiting winner claim</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Only the selected winner can claim this reward.</div></div>
                </div>
              )}
            </>
          )}
          {isPaid && <div className="alert alert-success">✓ Reward released — check your private balance in your wallet.</div>}
        </div>
        {busy && <div style={{ marginTop: 12, fontSize: 12, color: "var(--amber)" }}>Waiting for wallet… {busy === "fund" || busy === "claim" ? "This uses a private proof and may take up to 30 seconds." : "Confirm in your wallet."}</div>}
        {txHash && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            Transaction:{" "}
            <a href={`${VERITY_NETWORKS[NETWORK].explorerUrl}/tx/${txHash}`} target="_blank" className="underline" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
              View on explorer
            </a>
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            <span>⚠</span>
            <div>
              <strong>Something went wrong</strong>
              <div style={{ opacity: 0.85, marginTop: 4 }}>{error}</div>
            </div>
          </div>
        )}
        {!connectedAddr && (isCreated || isOpen || isVoting || isClaimable) && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Connect your wallet to see actions available to you.
          </div>
        )}
      </div>

      <div className="card card-pad">
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Entries</h3>
        {submissions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>No entries yet. Be the first to share evidence.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {submissions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>#{s.id} — {shortAddr(String(s.investigator))} {connectedAddr && normalizeAddr(String(s.investigator)) === normalizeAddr(connectedAddr) && <span style={{ color: "var(--accent)", fontSize: 11 }}>(you)</span>}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "Fragment Mono" }}>{String(s.evidence_hash).slice(0, 24)}…</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.votes ?? 0} votes</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.timestamp ? new Date(Number(s.timestamp) * 1000).toLocaleDateString() : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
