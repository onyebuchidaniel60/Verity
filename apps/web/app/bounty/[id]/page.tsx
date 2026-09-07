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
import { loadBounty, formatRewardWei, weiToStr, humanToWei, getStatusName, getRewardWei, validateFundingAmount, canSubmitInvestigation, submitBlockMessage, isCreator as isCreatorAddr, isCreatedStatus, isFundedStatus, isOpenStatus, isWinnerSelectedStatus, isClaimableStatus, isPaidStatus, isRefundedStatus, statusMeta, toHexAddress, getSubmissionStatusName } from "@/lib/bounty";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;

// Bounty lifecycle: Created(0) → Funded(1) → Open(2) → WinnerSelected(3) →
// Claimable(4) → Paid(5) → Refunded(6). The badge is derived STRICTLY from the
// canonical chain status via statusMeta() (@/lib/bounty-pure, unit-tested) —
// never from reward amounts, localStorage, or optimistic UI. Legacy numeric /
// UPPERCASE / VOTING shapes are tolerated by getStatusName.

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function anonId(addr: string): string {
  try {
    const norm = validateAndParseAddress(addr);
    const hex = BigInt(norm).toString(16).padStart(64, "0");
    return `#${hex.slice(-4).toUpperCase()}`;
  } catch {
    try {
      const hex = BigInt(addr).toString(16).padStart(64, "0");
      return `#${hex.slice(-4).toUpperCase()}`;
    } catch {
      return "#????";
    }
  }
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

// Use shared helpers from lib/bounty for exact BigInt handling (imported)
const formatReward = formatRewardWei;

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [bounty, setBounty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [fundAmount, setFundAmount] = useState("");
  const [fundAmountError, setFundAmountError] = useState<string | null>(null);
  const [connectedAddr, setConnectedAddr] = useState<string | null>(null);
  const [stakeInfo, setStakeInfo] = useState<{ hasStake: boolean; stakeAmount: string; reputation: number; minRep: number; isSlashed: boolean } | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState<number | null>(null);
  const [reportsMap, setReportsMap] = useState<Record<number, any>>({});

  const walletStoreAddr = useWalletStore((s) => s.address);
  const walletConnected = useWalletStore((s) => s.connected);
  const setWalletConnection = useWalletStore((s) => s.setConnection);

  const provider = createProvider(NETWORK);
  // Use full ABI for V2 (bounty_manager::types::Bounty) — minimal "Bounty" fails for V2 (returns only id)
  const fallbackBountyAbi = [
    { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ type: "bounty_manager::types::Bounty" }], stateMutability: "view" },
    { name: "get_submission_count", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
    { name: "get_submission", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ type: "bounty_manager::types::Submission" }], stateMutability: "view" },
  ] as const;
  const bountyAbi: any = fallbackBountyAbi;

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
      const vm = await loadBounty(provider, id);
      setBounty(vm as any);
      // TEMP-DIAG: authoritative on-chain values straight from the contract.
      try {
        console.info("[bounty-diag] loaded", {
          bountyId: id,
          contract: CONTRACTS.bountyManager,
          onChainCreator: vm.creator,
          onChainStatus: vm.status,
          onChainRewardWei: vm.rewardWei.toString(),
        });
      } catch {}
      const rewardWei = (vm as any).rewardWei ?? 0;
      if (rewardWei !== undefined && rewardWei !== 0n) {
        const rewardStr = weiToStr(rewardWei);
        if (!fundAmount) setFundAmount(rewardStr);
        else if (fundAmount === "0" || fundAmount === "") setFundAmount(rewardStr);
      }
      // Fetch submissions via full ABI (shared model does not yet include submissions, so fetch here)
      let fullAbi: any = null;
      try {
        const cls: any = await provider.getClassAt(CONTRACTS.bountyManager!);
        fullAbi = cls.abi;
      } catch {}
      const cSub: any = new Contract({ abi: (fullAbi || bountyAbi) as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      // Load submissions
      try {
        const cnt: any = await cSub.call("get_submission_count", [id]);
        const count = Number(cnt?.count ?? cnt ?? 0);
        const list: any[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const s: any = await cSub.call("get_submission", [id, i]);
            const subRaw = s?.submission ?? s;
            const sub = Array.isArray(subRaw)
              ? { id: subRaw[0], bounty_id: subRaw[1], investigator: subRaw[2], evidence_hash: subRaw[3], timestamp: subRaw[4], status: subRaw[5] }
              : subRaw;
            list.push({ id: i, ...sub });
          } catch {}
        }
        setSubmissions(list);
        // Load reports for dispute UI
        try {
          const repAbi2 = [{ name: "get_report", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ type: "bounty_manager::types::Report" }], stateMutability: "view" }] as const;
          const cRep = new Contract({ abi: (fullAbi || repAbi2) as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
          const rMap: Record<number, any> = {};
          for (let i = 1; i <= list.length; i++) {
            try {
              const rr: any = await cRep.call("get_report", [id, i]);
              const repRaw = rr?.report ?? rr;
              const rep = Array.isArray(repRaw)
                ? { bounty_id: repRaw[0], submission_id: repRaw[1], reporter: repRaw[2], reason: repRaw[3], evidence: repRaw[4], timestamp: repRaw[5], challenged: repRaw[6], challenge_deadline: repRaw[7], resolved: repRaw[8], slashed: repRaw[9] }
                : repRaw;
              if (rep && (rep.reporter ?? rep[2])) rMap[i] = rep;
            } catch {}
          }
          setReportsMap(rMap);
        } catch {}
      } catch {}
      // Load stake/reputation if connected
      if (walletStoreAddr) {
        try {
          const repAbi = [
            { name: "get_reputation", type: "function", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ name: "rep", type: "core::integer::u64" }], stateMutability: "view" },
            { name: "has_stake", type: "function", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ name: "has", type: "core::bool" }], stateMutability: "view" },
            { name: "is_slashed", type: "function", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ name: "slashed", type: "core::bool" }], stateMutability: "view" },
            { name: "get_minimum_reputation", type: "function", inputs: [], outputs: [{ name: "min", type: "core::integer::u64" }], stateMutability: "view" },
            { name: "get_stake_amount", type: "function", inputs: [], outputs: [{ name: "amt", type: "core::integer::u128" }], stateMutability: "view" },
          ] as const;
          const c2 = new Contract({ abi: repAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
          const [repRes, stakeRes, slashedRes, minRes, amtRes]: any = await Promise.all([
            c2.call("get_reputation", [walletStoreAddr]),
            c2.call("has_stake", [walletStoreAddr]),
            c2.call("is_slashed", [walletStoreAddr]),
            c2.call("get_minimum_reputation", []),
            c2.call("get_stake_amount", []),
          ]);
          const rep = Number(repRes?.rep ?? repRes ?? 0);
          const hasStake = Boolean(stakeRes?.has ?? stakeRes);
          const isSlashed = Boolean(slashedRes?.slashed ?? slashedRes);
          const minRep = Number(minRes?.min ?? minRes ?? 60);
          const stakeAmt = String(amtRes?.amt ?? amtRes ?? 0);
          setStakeInfo({ hasStake, stakeAmount: stakeAmt, reputation: rep, minRep, isSlashed });
        } catch {
          setStakeInfo(null);
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
  }, [id, walletStoreAddr]);

  useEffect(() => {
    if (walletStoreAddr) setConnectedAddr(walletStoreAddr);
    else setConnectedAddr(null);
  }, [walletStoreAddr]);

  async function ensureConnected(): Promise<string> {
    if (connectedAddr && walletConnected) return connectedAddr;
    const { address, walletName } = await connectWallet();
    setConnectedAddr(address);
    // Sync the shared store: the create page and action handlers connect via
    // discovery directly (never touching the header picker), and the store is
    // in-memory (lost on reload). Without this, the detail page sees a null
    // connected address and misclassifies the creator as a non-creator.
    try {
      setWalletConnection(address, walletName ?? "Wallet", undefined);
    } catch {}
    return address;
  }

  async function handleConnectClick() {
    setBusy("connect");
    setError(null);
    try {
      await ensureConnected();
      await load();
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // TEMP-DIAG (keep until Bug 1/2 manually verified, then remove): log the
  // exact inputs of the creator comparison so a misclassification can be
  // diagnosed from the console without guessing.
  useEffect(() => {
    try {
      const b: any = bounty;
      console.info("[bounty-diag]", {
        bountyId: id,
        contract: CONTRACTS.bountyManager,
        onChainCreator: b?.creator ?? null,
        onChainCreatorHex: toHexAddress(b?.creator != null ? String(b.creator) : null),
        onChainStatus: b?.status ?? null,
        connectedAddr,
        walletStoreAddr,
        isCreator: b ? isCreatorAddr(String(b.creator ?? ""), connectedAddr) : false,
      });
    } catch {}
  }, [bounty, connectedAddr, walletStoreAddr, id]);

  async function guard(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setTxHash(null);
    try {
      const hash = await fn();
      if (hash) {
        setTxHash(hash);
        // FUNDED/OPEN/etc only after actual L2 confirmation — never optimistic.
        // Wait briefly for the tx to be accepted before reloading chain state.
        try {
          await provider.waitForTransaction(hash as string, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
        } catch (waitErr) {
          console.warn(`[bounty ${id}] waitForTransaction warning for ${key}`, waitErr);
          // Fall through to reload anyway — load() reads authoritative chain state.
        }
      }
      await load();
    } catch (e: any) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      const msgLower = rawMsg.toLowerCase();
      console.error(`[bounty ${id}] ${key} failed`, e);
      try {
        console.error(`[bounty ${id}] error details`, {
          code: e?.code,
          message: e?.message,
          data: e?.data,
          cause: e?.cause,
          execution_error: e?.data?.execution_error ?? e?.cause?.data?.execution_error,
          full: (() => { try { return JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 4000); } catch { return String(e); } })()
        });
      } catch {}
      if (rawMsg.includes("USER_REFUSED") || msgLower.includes("user rejected") || msgLower.includes("cancelled")) setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      else if (msgLower.includes("not_registered") || msgLower.includes("118")) setError("Your wallet isn’t registered for private transactions yet. Open your wallet, enable private mode, and try again.");
      else if (msgLower.includes("insufficient") || msgLower.includes("balance") || msgLower.includes("insufficient_private_balance")) setError("Insufficient funds. Make sure you have enough STRK and try again.");
      else if (msgLower.includes("not_staked")) setError("You need to stake before you can submit. Stake the required amount to become eligible.");
      else if (msgLower.includes("is_slashed")) setError("Your investigator profile has been slashed and can’t submit. Contact support if you believe this is an error.");
      else if (msgLower.includes("reputation_too_low")) setError(`Your reputation is too low. Required: ${stakeInfo?.minRep ?? 60}, yours: ${stakeInfo?.reputation ?? 0}. Build reputation to submit.`);
      else if (msgLower.includes("creator_cannot_submit")) setError("This is your bounty. You can't submit an investigation to your own bounty.");
      else if (msgLower.includes("not_creator") && key === "select") setError("Only the bounty creator can select a winner.");
      else if (msgLower.includes("not_creator") && key === "refund") setError("Only the creator can reclaim funds.");
      else if (msgLower.includes("already_reported")) setError("This investigation has already been reported.");
      else if (msgLower.includes("already_slashed")) setError("This investigator has already been slashed for this bounty.");
      else if (msgLower.includes("not_pending")) setError("This investigation is no longer pending and can’t be reported.");
      else if (msgLower.includes("already_has_winner")) setError("A winner has already been selected for this bounty.");
      else if (msgLower.includes("not_open")) setError("This bounty is not open for submissions right now.");
      else if (msgLower.includes("invalid_request_payload")) setError("We couldn’t prepare the private transaction. Please check the amount and try again.");
      else if (msgLower.includes("amount_mismatch")) setError("Funding amount does not match the bounty reward. Please enter the exact reward amount.");
      else if (msgLower.includes("not_created")) setError("This bounty can’t be funded right now — it’s no longer in the created state.");
      else if (msgLower.includes("paymaster") || msgLower.includes("transaction_execution_error") || msgLower.includes("156")) {
        const dataStr = JSON.stringify(e?.data ?? e?.cause ?? "");
        if (dataStr.includes("AMOUNT_MISMATCH")) setError("Funding amount does not match the bounty reward.");
        else if (dataStr.includes("NOT_CREATED")) setError("This bounty is already funded or not in a state that can be funded.");
        else if (dataStr.includes("REPUTATION_TOO_LOW")) setError("Your reputation is too low to submit.");
        else if (dataStr.includes("NOT_STAKED")) setError("You need to stake first.");
        else setError("Transaction failed during execution. See console for details and try again.");
      } else if (msgLower.includes("not_claimable")) setError("This bounty is not ready to be claimed yet.");
      else if (msgLower.includes("not_authorized_claim")) setError("Only the winner can claim this reward.");
      else setError("Something went wrong. Please try again. (See console for details)");
    } finally {
      setBusy(null);
    }
  }

  const fundPrivate = () =>
    guard("fund", async () => {
      if (!bounty) throw new Error("Bounty not loaded");
      // On-chain reward is authoritative — never localStorage, never a fallback constant.
      const rewardWei = getRewardWei(bounty);
      const rewardWeiStr = rewardWei.toString();
      const v = validateFundingAmount(fundAmount, rewardWei);
      if (!fundAmount.trim()) { setFundAmountError("Please enter an amount"); throw new Error("Please enter a funding amount"); }
      if (!v.ok) { setFundAmountError(v.error || "Funding amount must match the bounty reward."); throw new Error(`AMOUNT_MISMATCH: entered ${v.enteredWei} != reward ${rewardWeiStr}`); }
      const enteredWei = v.enteredWei;
      setFundAmountError(null);
      const address = await ensureConnected();
      const { wallet } = await connectWallet();
      const cap = await (await import("@/strk20-proof/strk20-proof")).detectStrk20Capability(wallet);
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      try {
        const balances: any = await account.strk20Balances([STRK20[NETWORK].strkTokenAddress as Address]);
        console.info("[fundPrivate] private balances before", balances);
        const entry = (balances as any[]).find((b: any) => String(b.token).toLowerCase() === STRK20[NETWORK].strkTokenAddress.toLowerCase());
        if (entry && BigInt(entry.balance) < BigInt(enteredWei)) throw new Error(`INSUFFICIENT_PRIVATE_BALANCE: private balance ${entry.balance} < required ${enteredWei}`);
      } catch (e: any) {
        if (String(e.message).includes("NOT_REGISTERED") || String(e.message).includes("INSUFFICIENT")) throw e;
        console.warn("[fundPrivate] private balance check skipped", e?.message);
      }
      const bountyId = Number(id);
      const amountFelt = "0x" + BigInt(enteredWei).toString(16);
      const bountyIdFelt = "0x" + BigInt(String(bountyId)).toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operation = "0x46554e445f424f554e5459";
      const actionArray = [
        { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyIdFelt, amountFelt, nonce, "${openNoteIds[0]}"] } as any,
      ];
      console.info("[fundPrivate] STRK20 action array", JSON.stringify(actionArray, null, 2));
      actionArray.forEach((act: any, idx: number) => {
        if (act.calldata) act.calldata.forEach((c: any, j: number) => console.info(`[fundPrivate] action[${idx}].calldata[${j}]`, { value: c, type: typeof c }));
      });
      console.info("[fundPrivate] pool", POOL, "token", STRK20[NETWORK].strkTokenAddress, "bountyId", bountyId, "bountyIdFelt", bountyIdFelt, "amountFelt", amountFelt);
      console.info("[fundPrivate] wallet API versions", cap.walletApiVersions, "supported", cap.supported);
      try {
        const checkContract = new Contract({ abi: [{ name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const chk: any = await checkContract.call("get_bounty", [bountyId]);
        const chkB = chk?.bounty ?? chk;
        const statusName = getStatusName(chkB?.status ?? chkB?.[3] ?? "");
        console.info("[fundPrivate] bounty status before", chkB, "statusName", statusName);
        if (statusName !== "Created") throw new Error(`NOT_CREATED: bounty status is ${statusName}, expected Created`);
      } catch (e: any) {
        if (String(e.message).includes("NOT_CREATED")) throw e;
        console.warn("[fundPrivate] pre-flight warning", e);
      }
      try {
        console.info("[fundPrivate] calling wallet_strk20InvokeTransaction");
        // Safe diagnostic payload (public tx data only — no keys/secrets):
        // bountyId, creator, connected wallet, reward, amount, token, pool,
        // target contract, action names, network, wallet method, action count.
        try {
          console.info("[fundPrivate] diagnostic payload", {
            walletApiMethod: "wallet_strk20InvokeTransaction",
            network: NETWORK,
            bountyId,
            creatorAddress: String((bounty as any)?.creator ?? ""),
            connectedAddress: address,
            bountyRewardWei: rewardWeiStr,
            fundingAmountWei: enteredWei,
            token: STRK20[NETWORK].strkTokenAddress,
            pool: POOL,
            targetContract: CONTRACTS.verityAnonymizer,
            actions: [
              { type: "transfer", amount: "OPEN", noteIndex: 0 },
              { type: "invoke", operation: "FUND_BOUNTY", calldataLength: 5 },
            ],
            actionCount: actionArray.length,
          });
        } catch {}
        const res: any = await account.strk20InvokeTransaction(actionArray);
        console.info("[fundPrivate] wallet response", res);
        return res.transaction_hash ?? res.hash;
      } catch (e: any) {
        console.error("[fundPrivate] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        try { console.error("[fundPrivate] full error", JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 8000)); } catch {}
        throw e;
      }
    });

  const open = () =>
    guard("open", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "open_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("open_bounty", [id]);
      return res.transaction_hash ?? res.hash;
    });

  const stake = () =>
    guard("stake", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "stake", type: "function", inputs: [], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("stake", []);
      return res.transaction_hash ?? res.hash;
    });

  const submit = () =>
    guard("submit", async () => {
      // Current-stage rule (BEFORE private staking): any connected non-creator
      // can submit to an OPEN bounty. Creator is blocked (UX + on-chain).
      const statusName = getStatusName((bounty as any)?.status ?? "Created");
      const check = canSubmitInvestigation({
        status: statusName,
        creator: (bounty as any)?.creator ?? null,
        connectedAddr,
        evidence,
      });
      if (!check.ok) {
        if (check.reason === "IS_CREATOR") throw new Error("CREATOR_CANNOT_SUBMIT: This is your bounty. You can't submit an investigation to your own bounty.");
        if (check.reason === "NOT_OPEN") throw new Error("NOT_OPEN: This bounty is not open for submissions right now.");
        if (check.reason === "NOT_CONNECTED") { await ensureConnected(); }
        if (!evidence.trim()) throw new Error("Please add investigation details");
        // Re-check after ensuring connection
        const recheck = canSubmitInvestigation({ status: statusName, creator: (bounty as any)?.creator ?? null, connectedAddr: connectedAddr || walletStoreAddr, evidence });
        if (!recheck.ok && recheck.reason === "IS_CREATOR") throw new Error("CREATOR_CANNOT_SUBMIT: This is your bounty. You can't submit an investigation to your own bounty.");
      }
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Convert evidence string to felt (short string, truncate)
      const evidenceFelt = evidence.trim().slice(0, 31) ? "0x" + Buffer.from(evidence.trim().slice(0, 31)).toString("hex") : "0x1";
      const c = new Contract({ abi: [{ name: "submit_investigation", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "evidence_hash", type: "core::felt252" }], outputs: [{ name: "submission_id", type: "core::integer::u64" }], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("submit_investigation", [id, evidenceFelt]);
      return res.transaction_hash ?? res.hash;
    });

  const selectWinner = (submissionId: number) =>
    guard("select", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "select_winner", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("select_winner", [id, submissionId]);
      return res.transaction_hash ?? res.hash;
    });

  const report = (submissionId: number) =>
    guard("report", async () => {
      if (!reportReason.trim()) throw new Error("Please provide a reason for the report");
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const reasonFelt = "0x" + Buffer.from(reportReason.trim().slice(0, 31)).toString("hex");
      const evidenceFelt = "0x" + Buffer.from("report-evidence").toString("hex");
      const c = new Contract({ abi: [{ name: "report_submission", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }, { name: "reason", type: "core::felt252" }, { name: "evidence", type: "core::felt252" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("report_submission", [id, submissionId, reasonFelt, evidenceFelt]);
      return res.transaction_hash ?? res.hash;
    });

  const challenge = (submissionId: number) =>
    guard("challenge", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "challenge_report", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("challenge_report", [id, submissionId]);
      return res.transaction_hash ?? res.hash;
    });

  const resolve = (submissionId: number, shouldSlash: boolean) =>
    guard("resolve", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "resolve_report", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }, { name: "should_slash", type: "core::bool" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("resolve_report", [id, submissionId, shouldSlash]);
      return res.transaction_hash ?? res.hash;
    });

  const withdrawStake = () =>
    guard("withdraw", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "withdraw_stake", type: "function", inputs: [], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("withdraw_stake", []);
      return res.transaction_hash ?? res.hash;
    });

  const refund = () =>
    guard("refund", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "refund_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("refund_bounty", [id]);
      return res.transaction_hash ?? res.hash;
    });

  const claim = () =>
    guard("claim", async () => {
      const winner = (bounty as any)?.winner ?? null;
      const normWinner = winner ? normalizeAddr(String(winner)) : null;
      const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
      if (normWinner && normConnected && normWinner !== normConnected) throw new Error("NOT_AUTHORIZED_CLAIM: Only the winner can claim this reward");
      if (!winner || String(winner) === "0x0" || (winner as any) === 0) throw new Error("No winner selected yet");
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const bountyIdFelt = "0x" + BigInt(bountyId).toString(16);
      // On-chain reward is authoritative — never a hardcoded fallback.
      const amountFelt = "0x" + getRewardWei(bounty).toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operation = "0x52454c45415345";
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
        console.error("[claim] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
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

  // Authoritative chain state: status is canonical PascalCase from loadBounty;
  // getStatusName tolerates numeric/uppercase legacy shapes too. The badge
  // comes strictly from statusMeta(statusName) — CREATED can never show Funded.
  const statusName = getStatusName((bounty as any)?.status ?? "Created");
  const statusKey = statusName;
  const meta = statusMeta(statusName);
  // On-chain reward is authoritative — never localStorage, never a fallback constant.
  const rewardWei = getRewardWei(bounty);
  const rewardStr = formatRewardWei(rewardWei);
  const storedMeta = (() => {
    const m = getStoredMeta(Number(id));
    if (m?.title) return m;
    const feltTitle = feltToTitle((bounty as any)?.metadataHash ?? (bounty as any)?.metadata_hash);
    if (feltTitle) return { title: feltTitle, description: "" };
    return null;
  })();
  const displayTitle = storedMeta?.title || (bounty as any)?.title || `Bounty #${id}`;
  const displayDesc = storedMeta?.description || (bounty as any)?.description || "Investigation bounty — evidence helps verify the claim.";
  const isPaid = isPaidStatus(statusName);
  const isClaimable = isClaimableStatus(statusName);
  const isWinnerSelected = isWinnerSelectedStatus(statusName);
  const isOpen = isOpenStatus(statusName);
  const isFunded = isFundedStatus(statusName);
  const isCreated = isCreatedStatus(statusName);
  const isRefunded = isRefundedStatus(statusName);
  const creatorAddr = String((bounty as any)?.creator ?? "");
  const winnerAddr = String((bounty as any)?.winner ?? "");
  // Canonical hex for display/comparison: on-chain addresses arrive as decimal
  // felt strings, wallet addresses as 0x-hex. toHexAddress unifies both.
  const creatorHex = toHexAddress(creatorAddr) ?? creatorAddr;
  const normCreator = normalizeAddr(creatorAddr);
  const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
  const normWinner = normalizeAddr(winnerAddr);
  const isCreator = isCreatorAddr(creatorAddr, connectedAddr);
  const isWinner = !!(normWinner && normConnected && normWinner === normConnected && normWinner !== "0x0000000000000000000000000000000000000000000000000000000000000000");

  const timeline = [
    { key: "Created", done: true, current: isCreated },
    { key: "Funded", done: !isCreated, current: isFunded },
    { key: "Open", done: isOpen || isWinnerSelected || isClaimable || isPaid || isRefunded, current: isOpen },
    { key: "Winner", done: isWinnerSelected || isClaimable || isPaid, current: isWinnerSelected },
    { key: "Paid", done: isPaid, current: isPaid || isClaimable },
  ];

  const eligibility = stakeInfo
    ? {
        hasStake: stakeInfo.hasStake,
        reputation: stakeInfo.reputation,
        minRep: stakeInfo.minRep,
        isSlashed: stakeInfo.isSlashed,
        eligible: stakeInfo.hasStake && !stakeInfo.isSlashed && stakeInfo.reputation >= stakeInfo.minRep,
        stakeAmountStr: formatReward(stakeInfo.stakeAmount),
      }
    : null;

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
              <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(creatorHex)} {isCreator && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Created</span>
              <span>{(bounty as any)?.createdAt ? new Date(Number((bounty as any).createdAt) * 1000).toLocaleDateString() : "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Submissions</span>
              <span>{submissions.length}</span>
            </div>
            {(bounty as any)?.winner && String((bounty as any).winner) !== "0x0" && String((bounty as any).winner) !== "0" && (
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span style={{ color: "var(--text-muted)" }}>Winner</span>
                <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{anonId(winnerAddr)} {isWinner && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Network</span>
              <span>Sepolia</span>
            </div>
          </div>
        </div>
      )}

      {/* Investigator staking panel (interim V2 on-chain requirement).
          The submission form below is NOT gated by this panel: any connected
          non-creator can submit to an OPEN bounty. If the chain reverts with
          NOT_STAKED, stake here in one click and retry. */}
      {!isCreator && isOpen && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: eligibility?.eligible ? "var(--border)" : "var(--amber-border)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Investigator staking (one-click, interim)</h3>
          {!connectedAddr ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Connect your wallet to check eligibility.</p>
          ) : !eligibility ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Loading eligibility…</p>
          ) : eligibility.isSlashed ? (
            <div className="alert alert-error" style={{ margin: 0 }}>
              <span>⚠</span>
              <div><strong>Profile slashed</strong><div style={{ opacity: 0.85, marginTop: 4 }}>You can’t submit investigations while slashed.</div></div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Reputation</span>
                <span style={{ fontWeight: 600 }}>{eligibility.reputation} / 100 {eligibility.reputation >= eligibility.minRep ? "✓" : "✗"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Required</span>
                <span>{eligibility.minRep}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Stake</span>
                <span>{eligibility.hasStake ? `${eligibility.stakeAmountStr} ✓` : `${eligibility.stakeAmountStr} — not staked ✗`}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: eligibility.eligible ? "var(--text)" : "var(--amber)" }}>
                {eligibility.eligible ? "✓ Eligible to submit" : "✗ Not eligible — stake or build reputation"}
              </div>
              {!eligibility.hasStake && (
                <button disabled={!!busy} onClick={stake} className="btn btn-secondary" style={{ marginTop: 8 }}>
                  {busy === "stake" ? "Staking…" : `Stake ${eligibility.stakeAmountStr} to become eligible`}
                </button>
              )}
              {eligibility.hasStake && !eligibility.isSlashed && (
                <button disabled={!!busy} onClick={withdrawStake} className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw stake"}
                </button>
              )}
            </div>
          )}
          {eligibility && !eligibility.eligible && !eligibility.isSlashed && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.4 }}>
              {eligibility.reputation < eligibility.minRep ? `You need a higher reputation (have ${eligibility.reputation}, need ${eligibility.minRep}). Wins increase reputation; slashes reduce it.` : "Stake the required amount to submit."}
            </p>
          )}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Actions</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
          {isCreated && (isCreator ? "Status: CREATED — waiting for funding. Enter the exact reward amount and fund it privately. The bounty is NOT funded yet." : "Status: CREATED — waiting for the creator to fund this bounty.")}
          {isFunded && (isCreator ? "Status: FUNDED — now open it for investigations. This is a separate step." : "Status: FUNDED — awaiting the creator to open it for investigations.")}
          {isOpen && (isCreator ? "Investigations are coming in. Review them below and select a winner when ready. You can also reclaim funds if no entry deserves the reward." : "Bounty is open. Share your investigation for review below.")}
          {isWinnerSelected && "A winner has been selected. The reward is ready to be released."}
          {isClaimable && (isWinner ? "You won! Claim your reward privately." : isCreator ? "A winner has been selected. The reward will be released to the winner." : "A winner has been selected. Awaiting payout.")}
          {isPaid && "This bounty is complete. The reward has been released."}
          {isRefunded && "This bounty was refunded. Funds have been returned to the creator (a protocol fee may have been charged)."}
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {!connectedAddr && (
            <div style={{ display: "grid", gap: 8, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Connect your wallet to see the actions available to you.</div>
              <button disabled={!!busy} onClick={handleConnectClick} className="btn btn-secondary">
                {busy === "connect" ? "Connecting…" : "Connect wallet"}
              </button>
            </div>
          )}
          {isCreated && isCreator && (
            <div style={{ display: "grid", gap: 10, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Fund this bounty</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Bounty reward: <strong style={{ color: "var(--accent)" }}>{rewardStr}</strong></div>
              <div>
                <label className="label" htmlFor="fund-amount">Amount to fund</label>
                <div style={{ position: "relative" }}>
                  <input
                    id="fund-amount"
                    className="input"
                    inputMode="decimal"
                    placeholder={weiToStr(rewardWei)}
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
                  <span className="help" style={{ margin: 0 }}>Must exactly equal the bounty reward.</span>
                  <button type="button" className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 12, height: 28 }} onClick={() => setFundAmount(weiToStr(rewardWei))}>Use reward amount</button>
                </div>
                {fundAmountError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{fundAmountError}</div>}
              </div>
              <button disabled={!!busy} onClick={fundPrivate} className="btn btn-primary">
                {busy === "fund" ? "Confirm in wallet…" : "Fund privately"}
              </button>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>Your wallet will open only when you click Fund privately. Status becomes FUNDED only after the transaction is confirmed.</p>
            </div>
          )}
          {isCreated && connectedAddr && !isCreator && (
            <div className="alert alert-warn" style={{ margin: 0 }}>
              <span>◈</span>
              <div><strong>Status: CREATED — awaiting creator funding</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Only the creator can fund this bounty. Check back after it is funded and opened.</div></div>
            </div>
          )}
          {isFunded && isCreator && (
            <button disabled={!!busy} onClick={open} className="btn btn-primary">
              {busy === "open" ? "Processing…" : "Open bounty"}
            </button>
          )}
          {isFunded && !isCreator && connectedAddr && (
            <div className="alert alert-warn" style={{ margin: 0 }}>
              <span>◈</span>
              <div><strong>Bounty funded — awaiting creator to open</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Investigations open after the creator opens the bounty.</div></div>
            </div>
          )}
          {isOpen && !isCreator && (
            <div style={{ display: "grid", gap: 8 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Submit an investigation</h4>
              <label className="label" htmlFor="evidence">Your investigation</label>
              <textarea id="evidence" className="textarea" rows={4} placeholder="Describe your findings…" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>I understand that submitting a fraudulent or misleading investigation may result in loss of my stake.</p>
              <button disabled={!!busy} onClick={submit} className="btn btn-primary">
                {busy === "submit" ? "Submitting…" : "Submit investigation"}
              </button>
              {!connectedAddr && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Connect your wallet to submit.</div>}
            </div>
          )}
          {isOpen && isCreator && (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="alert alert-warn" style={{ margin: 0 }}>
                <span>◈</span>
                <div><strong>You created this bounty. You cannot submit an investigation to it.</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Review investigations below and select a winner when ready, or reclaim funds if none deserve the reward.</div></div>
              </div>
              <button disabled={!!busy} onClick={refund} className="btn btn-secondary">
                {busy === "refund" ? "Reclaiming…" : "No winner — reclaim funds (protocol fee applies)"}
              </button>
            </div>
          )}
          {(isWinnerSelected || isClaimable) && (
            <>
              {isWinner ? (
                <button disabled={!!busy} onClick={claim} className="btn btn-primary">
                  {busy === "claim" ? "Claiming privately…" : "Claim reward privately"}
                </button>
              ) : isCreator ? (
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  <span>◈</span>
                  <div><strong>Winner selected: {anonId(winnerAddr)}</strong><div style={{ opacity: 0.85, marginTop: 4 }}>The winner will claim the reward privately.</div></div>
                </div>
              ) : (
                <div className="alert alert-warn" style={{ margin: 0 }}>
                  <span>◈</span>
                  <div><strong>Awaiting winner claim</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Winner {anonId(winnerAddr)} will claim.</div></div>
                </div>
              )}
            </>
          )}
          {isPaid && <div className="alert alert-success">✓ Reward released — winner received funds privately.</div>}
          {isRefunded && <div className="alert alert-warn">This bounty was refunded to the creator.</div>}
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
        {!connectedAddr && (isCreated || isOpen || isClaimable) && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Connect your wallet to see actions available to you.
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Investigations</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{submissions.length} {submissions.length === 1 ? "received" : "received"}</span>
        </div>
        {submissions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>No investigations yet. {isCreator ? "They’ll appear here for your review." : "Be the first to share evidence."}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {submissions.map((s) => {
              const invAddr = String(s.investigator);
              const invHex = toHexAddress(invAddr) ?? invAddr;
              const statusLabel = getSubmissionStatusName(s.status ?? s[5] ?? "Pending");
              const isOwn = connectedAddr && normalizeAddr(invAddr) === normalizeAddr(connectedAddr);
              return (
                <div key={s.id} style={{ padding: 14, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Anonymous Investigator {anonId(invAddr)} {isOwn && <span style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 999, marginLeft: 6 }}>you</span>}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Submitted {s.timestamp ? new Date(Number(s.timestamp) * 1000).toLocaleDateString() : ""} • Status: {statusLabel}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>{shortAddr(invHex)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8, wordBreak: "break-all" }}>
                    {String(s.evidence_hash).slice(0, 64)}…
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {isCreator && isOpen && statusLabel === "Pending" && (
                      <>
                        <button disabled={!!busy} onClick={() => selectWinner(Number(s.id))} className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}>
                          {busy === "select" && selectedSubmission === Number(s.id) ? "Selecting…" : "Select winner"}
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            const reason = prompt("Reason for reporting this investigation (will be recorded on-chain, investigator can challenge within 3 days):");
                            if (reason) {
                              setReportReason(reason);
                              setTimeout(() => report(Number(s.id)), 100);
                            }
                          }}
                          className="btn btn-secondary"
                          style={{ padding: "6px 12px", fontSize: 12 }}
                        >
                          Report
                        </button>
                      </>
                    )}
                    {statusLabel === "Reported" && isOwn && (
                      <button disabled={!!busy} onClick={() => challenge(Number(s.id))} className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12, borderColor: "var(--amber-border)", color: "var(--amber)" }}>
                        {busy === "challenge" ? "Challenging…" : "Challenge report (3-day window)"}
                      </button>
                    )}
                    {statusLabel === "Reported" && (isCreator || connectedAddr === "0x100") && (
                      <>
                        <button disabled={!!busy} onClick={() => resolve(Number(s.id), true)} className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12, background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}>
                          {busy === "resolve" ? "Resolving…" : "Confirm slash"}
                        </button>
                        <button disabled={!!busy} onClick={() => resolve(Number(s.id), false)} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}>
                          Dismiss report
                        </button>
                      </>
                    )}
                    {reportsMap[Number(s.id)] && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                        {(() => {
                          const r = reportsMap[Number(s.id)] as any;
                          const challenged = r?.challenged ?? false;
                          const resolved = r?.resolved ?? false;
                          const slashed = r?.slashed ?? false;
                          if (resolved) return slashed ? "Resolved: slashed" : "Resolved: dismissed";
                          if (challenged) return "Challenged — awaiting owner";
                          return "Reported — awaiting resolution (3-day challenge)";
                        })()}
                      </span>
                    )}
                    <button onClick={() => setSelectedSubmission(selectedSubmission === Number(s.id) ? null : Number(s.id))} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}>
                      {selectedSubmission === Number(s.id) ? "Hide" : "Read investigation"}
                    </button>
                  </div>
                  {selectedSubmission === Number(s.id) && (
                    <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Evidence</div>
                      <div style={{ wordBreak: "break-all", fontFamily: "Fragment Mono", fontSize: 11 }}>{String(s.evidence_hash)}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>Anonymous submission — investigator identity remains private. Reputation and stake were verified at submission time.</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
