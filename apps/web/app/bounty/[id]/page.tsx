"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Contract, validateAndParseAddress } from "starknet";
import { connectWallet, createStrk20Account, strk20InvokeBareActions, type Address } from "@/strk20-proof/strk20-proof";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";
import { STRK20 } from "@/lib/strk20";
import { useWalletStore } from "@/store/wallet";
import { loadBounty, formatRewardWei, weiToStr, humanToWei, getStatusName, getRewardWei, validateFundingAmount, canSubmitInvestigation, submitBlockMessage, isCreator as isCreatorAddr, isCreatedStatus, isFundedStatus, isOpenStatus, isWinnerSelectedStatus, isClaimableStatus, isPaidStatus, isRefundedStatus, statusMeta, toHexAddress, getSubmissionStatusName, generateSecret, computeLock, saveBountySecrets, getBountySecrets, savePayoutSecret, getPayoutSecret, normalizeContractAddress, buildInvokeCall, toWalletInvokeParams } from "@/lib/bounty";
import {
  OP_STAKE, OP_SUBMIT, OP_REG_PAYOUT, OP_UNSTAKE,
  genesisTip, peekPreimage, consumePreimage, identityShortId, normFelt,
  chainAt, poseidon1, deriveNextKFromTip,
  generateIdentitySeed, saveIdentity, loadIdentity, clearIdentity, markIdentityConfirmed,
  evidenceToFelt, buildStakeActions, buildSubmitActions, buildRegPayoutActions,
  buildUnstakeActions, buildDustAnchorAction, submitGate, fetchInvestigatorState,
  stateDigest,
  peekCreatorPreimage, consumeCreatorPreimage, loadCreator, saveCreator,
  loadPendingCreator, clearPendingCreator,
  splitTextToFelts, joinFeltsToText,
  saveEvidenceDraft, loadEvidenceDraft, clearEvidenceDraft,
  type StoredIdentity, type StoredCreator,
} from "@/lib/identity-pure";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;

// Phase 3 secret-bound funding: operation felts + helper lock/escrow views.
const OP_FUND = "0x46554e445f424f554e5459"; // 'FUND_BOUNTY'
const OP_REFUND = "0x524546554e445f424f554e5459"; // 'REFUND_BOUNTY'
const OP_RELEASE = "0x52454c45415345"; // 'RELEASE'
// Private investigator identity ops live in @/lib/identity-pure (OP_STAKE,
// OP_SUBMIT, OP_REG_PAYOUT, OP_UNSTAKE) so unit tests pin them to the
// contract short-strings.
const IDENTITY_ABI = [
  { name: "get_identity_reputation", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "rep", type: "core::integer::u64" }], stateMutability: "view" },
  { name: "is_identity_registered", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "registered", type: "core::bool" }], stateMutability: "view" },
  { name: "is_identity_slashed", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "slashed", type: "core::bool" }], stateMutability: "view" },
  { name: "is_identity_eligible", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "eligible", type: "core::bool" }], stateMutability: "view" },
  { name: "get_identity_stake", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "amount", type: "core::integer::u128" }], stateMutability: "view" },
  { name: "get_minimum_reputation", type: "function", inputs: [], outputs: [{ name: "min", type: "core::integer::u64" }], stateMutability: "view" },
  { name: "get_stake_amount", type: "function", inputs: [], outputs: [{ name: "amt", type: "core::integer::u128" }], stateMutability: "view" },
  { name: "challenge_private_report", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }, { name: "preimage", type: "core::felt252" }], outputs: [], stateMutability: "external" },
] as const;

// Public writes go through publicInvoke() (hex calldata via account.execute);
// the invoke entries below were removed with that migration. Reads keep
// their ABIs (Contract.call is unaffected).
const LOCKS_ABI = [
  { name: "set_locks", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "fund_lock", type: "core::felt252" }, { name: "refund_lock", type: "core::felt252" }, { name: "creator_preimage", type: "core::felt252" }], outputs: [], stateMutability: "external" },
  { name: "register_payout_lock", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "payout_lock", type: "core::felt252" }], outputs: [], stateMutability: "external" },
  { name: "has_fund_lock", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "has", type: "core::bool" }], stateMutability: "view" },
  { name: "has_refund_lock", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "has", type: "core::bool" }], stateMutability: "view" },
  { name: "has_payout_lock", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "has", type: "core::bool" }], stateMutability: "view" },
  { name: "get_escrow", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "amount", type: "core::integer::u128" }], stateMutability: "view" },
] as const;

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
  const [fundSecretPaste, setFundSecretPaste] = useState("");
  const [refundSecretPaste, setRefundSecretPaste] = useState("");
  const [payoutSecretPaste, setPayoutSecretPaste] = useState("");
  const [locksInfo, setLocksInfo] = useState<{ hasFundLock: boolean; hasRefundLock: boolean; hasPayoutLock: boolean; escrowWei: bigint } | null>(null);
  const [connectedAddr, setConnectedAddr] = useState<string | null>(null);
  const [stakeInfo, setStakeInfo] = useState<{ hasStake: boolean; stakeAmount: string; reputation: number; minRep: number; isSlashed: boolean } | null>(null);
  // Private investigator identity (device-held seed; chain state is the source
  // of truth for eligibility — localStorage only holds the secret seed).
  const [storedIdentity, setStoredIdentity] = useState<StoredIdentity | null>(null);
  const [eligibilityLoaded, setEligibilityLoaded] = useState(false);
  // Private creator identity for THIS bounty (device-held seed; null for
  // legacy bounties or when this device is not the creator).
  const [storedCreator, setStoredCreator] = useState<StoredCreator | null>(null);
  const [identityInfo, setIdentityInfo] = useState<{ identity: string; registered: boolean; reputation: number; minRep: number; escrowWei: bigint; eligible: boolean; slashed: boolean; stakeAmountWei: bigint } | null>(null);
  // Non-null when the investigator-state refresh itself failed (reads
  // incomplete) — distinct from "not staked", with a retry action.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [payoutAddrInput, setPayoutAddrInput] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState<number | null>(null);
  const [reportsMap, setReportsMap] = useState<Record<number, any>>({});

  const walletStoreAddr = useWalletStore((s) => s.address);
  const walletConnected = useWalletStore((s) => s.connected);
  const setWalletConnection = useWalletStore((s) => s.setConnection);

  const provider = createProvider(NETWORK);
  // Public writes (wallet_addInvokeTransaction) MUST use pre-built 0x-hex
  // calldata via account.execute: starknet.js Contract.invoke compiles to
  // DECIMAL strings, which Ready X rejects with INVALID_REQUEST_PAYLOAD
  // (code 114). Reads keep using Contract.call (unaffected). The trailing
  // preimage arg of creator-authorized entries is redacted in logs.
  async function publicInvoke(
    account: any,
    contractAddress: string | undefined,
    entrypoint: string,
    args: Array<bigint | string | number | boolean>,
    logTag: string,
    redactLastArg = false,
  ): Promise<string> {
    const to = normalizeContractAddress(contractAddress, `${logTag} target`);
    const call = buildInvokeCall(to, entrypoint, args);
    const logged = redactLastArg && call.calldata.length > 0
      ? { ...call, calldata: call.calldata.map((c, i) => (i === call.calldata.length - 1 ? "<preimage-redacted>" : c)) }
      : call;
    console.info(`[${logTag}] wallet_addInvokeTransaction params`, JSON.parse(JSON.stringify(toWalletInvokeParams(logged))));
    const res: any = await account.execute([call]);
    return res.transaction_hash ?? res.hash;
  }
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

  // Last readable-state digest (guard re-poll, §47.9) + unmount guard for
  // delayed reloads.
  const digestRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Silent tip resync (§47.11): heals accepted-then-reverted preimage
  // desyncs. Applies ONLY when the on-chain tip is found in the local
  // chain and differs; never overwrites on !found (wrong-record safety).
  // Idempotent when in sync. Never throws.
  async function resyncIdentityFromTip(): Promise<void> {
    try {
      const rec = loadIdentity();
      if (!rec || rec.confirmed === false) return;
      const cRs: any = new Contract({ abi: IDENTITY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const tipR: any = await cRs.call("get_identity_tip", [rec.identity]);
      const tipStr = String(tipR?.tip ?? tipR?.[0] ?? tipR ?? "0x0");
      const d = deriveNextKFromTip(rec.seed, tipStr);
      if (!d.found || d.nextK === null || d.nextK === rec.nextK) return;
      const fixed = { ...rec, nextK: d.nextK };
      saveIdentity(fixed);
      setStoredIdentity(fixed);
      console.info("[identity-resync] nextK corrected from chain tip", { identity: identityShortId(rec.identity), from: rec.nextK, to: d.nextK });
    } catch {}
  }

  async function load(quiet = false): Promise<string | null> {
    if (!quiet) setLoading(true);
    setEligibilityLoaded(false);
    setError(null);
    const digestParts: Record<string, unknown> = {};
    try {
      const vm = await loadBounty(provider, id);
      setBounty(vm as any);
      digestParts.bounty = { status: (vm as any)?.status ?? null, rewardWei: (vm as any)?.rewardWei ?? null, funded: (vm as any)?.fundedAmountWei ?? null, winner: (vm as any)?.winner ?? null, winningSub: (vm as any)?.winningSubmission ?? null };
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
            // New Submission shape appends `identity` (index 6; 0 = legacy
            // wallet submission). Old deployments return 6 members → undefined.
            const sub = Array.isArray(subRaw)
              ? { id: subRaw[0], bounty_id: subRaw[1], investigator: subRaw[2], evidence_hash: subRaw[3], timestamp: subRaw[4], status: subRaw[5], identity: subRaw[6] }
              : subRaw;
            list.push({ id: i, ...sub });
          } catch {}
        }
        // Option A evidence text (on-chain chunks; null = hash-only legacy
        // or unpublished — also null pre-redeploy while the view is absent).
        for (const item of list) {
          try {
            const ev: any = await cSub.call("get_submission_evidence", [id, (item as any).id]);
            const arr: any[] = Array.isArray(ev) ? ev : [];
            (item as any).evidenceText = arr.length ? joinFeltsToText(arr) : null;
          } catch {
            (item as any).evidenceText = null;
          }
        }
        setSubmissions(list);
        digestParts.subCount = list.length;
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
          digestParts.reportsCount = Object.keys(rMap).length;
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
  { name: "get_identity_tip", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "tip", type: "core::felt252" }], stateMutability: "view" },
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
      // Load private investigator identity state (device seed + chain views).
      // The seed never leaves this device; eligibility comes from chain views
      // keyed by the identity commitment (no wallet linkage on-chain).
      // Single authoritative refresh: each read is isolated and raw values
      // are logged, so a read failure can never silently masquerade as
      // "not staked" (commitments only in logs — never seeds/preimages).
      try {
        const local = loadIdentity();
        setStoredIdentity(local);
        setRefreshError(null);
        if (local) {
          const cId = new Contract({ abi: IDENTITY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
          console.info("[investigator-state] refresh start", { identity: identityShortId(local.identity), contract: CONTRACTS.bountyManager, confirmed: local.confirmed !== false });
          let r = await fetchInvestigatorState((fn, args) => cId.call(fn, args), local.identity);
          // Recovery: a pending identity whose stake has since landed is
          // confirmed here (never orphaned, never force-restaked).
          if (r.ok && r.state && r.state.registered && local.confirmed === false) {
            const confirmedRec = markIdentityConfirmed(local);
            setStoredIdentity(confirmedRec);
            console.info("[investigator-state] pending identity recovered from chain", { identity: identityShortId(local.identity) });
          }
          // Slow-confirmation poll: right after staking, L2 indexing can lag
          // guard()'s wait. Only for pending + still-unregistered identities,
          // bounded (4 x 4s) so a genuinely failed stake still settles.
          if (r.ok && r.state && !r.state.registered && local.confirmed === false) {
            for (let attempt = 1; attempt <= 4; attempt++) {
              await new Promise((res) => setTimeout(res, 4000));
              try {
                const rp = await fetchInvestigatorState((fn, args) => cId.call(fn, args), local.identity);
                if (rp.ok && rp.state) {
                  r = rp;
                  if (rp.state.registered) {
                    const confirmedRec = markIdentityConfirmed(local);
                    setStoredIdentity(confirmedRec);
                    console.info("[investigator-state] pending identity confirmed on poll", { identity: identityShortId(local.identity), attempt });
                    break;
                  }
                }
              } catch (e) {
                console.warn("[investigator-state] confirmation poll warning", attempt, e instanceof Error ? e.message : String(e));
                break;
              }
            }
          }
          let rawSafe: unknown = null;
          try {
            rawSafe = JSON.parse(JSON.stringify(r.raw, (_k, v) => typeof v === "bigint" ? `${v}n` : v));
          } catch { rawSafe = "(unserializable)"; }
          console.info("[investigator-state] refresh result", {
            ok: r.ok,
            errors: r.errors,
            raw: rawSafe,
            derived: r.state ? { ...r.state, escrowWei: r.state.escrowWei.toString(), stakeAmountWei: r.state.stakeAmountWei.toString() } : null,
          });
          if (r.ok && r.state) {
            setIdentityInfo({ identity: local.identity, ...r.state });
          } else {
            setIdentityInfo(null);
            const failed = Object.keys(r.errors);
            setRefreshError(failed.length > 0 ? `Couldn't verify stake state (${failed.join(", ")}). The chain may be fine — retry the read.` : "Couldn't derive stake state. Retry the read.");
          }
        } else {
          console.info("[investigator-state] no local identity on this device");
          setIdentityInfo(null);
        }
      } catch {
        setIdentityInfo(null);
        setRefreshError("Couldn't verify stake state (unexpected error). Retry the read.");
      }
      // Eligibility reads (legacy + private) attempted above — chain is the
      // only source of staked-ness. Submit stays disabled until this is set.
      setEligibilityLoaded(true);
      // Silent tip resync on every load (§47.11): heals desyncs from
      // accepted-then-reverted txs or replaced records.
      await resyncIdentityFromTip();
      // Private creator seed for this bounty (device-only; alias match
      // against chain decides creator control — never the wallet).
      // Pending-creator adoption (§47.9): a create whose read-back lagged
      // left a pending seed; adopt it now that the chain alias matches.
      try {
        if (!loadCreator(Number(id))) {
          const pend = loadPendingCreator();
          const chainAlias = (vm as any)?.creatorAlias ?? null;
          if (pend && chainAlias && normFelt(pend.alias)?.toLowerCase() === normFelt(String(chainAlias))?.toLowerCase()) {
            saveCreator(Number(id), { seed: pend.seed, alias: pend.alias, nextK: 63 });
            clearPendingCreator();
            console.info("[bounty-diag] adopted pending creator seed for bounty", id);
          }
        }
        setStoredCreator(loadCreator(Number(id)));
      } catch {
        setStoredCreator(null);
      }
      try {
        const cLocks: any = new Contract({ abi: LOCKS_ABI as any, address: CONTRACTS.verityAnonymizer!, providerOrAccount: provider });
        const [hasFund, hasRefund, hasPayout, escrow]: any = await Promise.all([
          cLocks.call("has_fund_lock", [id]),
          cLocks.call("has_refund_lock", [id]),
          cLocks.call("has_payout_lock", [id]),
          cLocks.call("get_escrow", [id]),
        ]);
        const toBool = (r: any) => {
          const v = r?.has ?? r;
          return v === true || v === 1 || v === 1n || String(v).toLowerCase() === "true";
        };
        setLocksInfo({
          hasFundLock: toBool(hasFund),
          hasRefundLock: toBool(hasRefund),
          hasPayoutLock: toBool(hasPayout),
          escrowWei: BigInt(escrow?.amount ?? escrow ?? 0),
        });
        digestParts.locks = { fund: String(hasFund), refund: String(hasRefund), payout: String(hasPayout), escrow: String(BigInt(escrow?.amount ?? escrow ?? 0)) };
      } catch {
        setLocksInfo(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
    const digest = stateDigest(digestParts);
    digestRef.current = digest;
    return digest;
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

  // Submit-gate state log: proves which booleans drive the Submit button
  // (identity present? chain state present? eligible? why blocked?).
  useEffect(() => {
    try {
      const legacyOk = stakeInfo ? (stakeInfo.hasStake && !stakeInfo.isSlashed && stakeInfo.reputation >= stakeInfo.minRep) : false;
      const g = submitGate({ loaded: eligibilityLoaded, privateEligible: identityInfo?.eligible ?? false, legacyEligible: legacyOk });
      console.info("[submit-gate]", {
        identityAvailable: !!storedIdentity,
        identity: storedIdentity ? identityShortId(storedIdentity.identity) : null,
        identityConfirmed: storedIdentity ? storedIdentity.confirmed !== false : null,
        stateAvailable: !!identityInfo,
        eligible: identityInfo?.eligible ?? false,
        loading: !eligibilityLoaded,
        error: refreshError,
        gate: g,
        reason: !eligibilityLoaded ? "reads-pending" : g === "eligible" ? null : refreshError ? "read-failed" : !storedIdentity ? "no-identity" : "not-eligible",
      });
    } catch {}
  }, [eligibilityLoaded, identityInfo, storedIdentity, stakeInfo, refreshError, id]);

  async function guard(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setTxHash(null);
    try {
      const hash = await fn();
      // Inclusion confirmation drives the post-tx resync below: only a
      // CONFIRMED tx proves the chain tip moved. Unknown (wait-warning)
      // skips resync to avoid stale-read clobber.
      let confirmed = false;
      if (hash) {
        setTxHash(hash);
        // FUNDED/OPEN/etc only after actual L2 confirmation — never optimistic.
        // Wait briefly for the tx to be accepted before reloading chain state.
        try {
          await provider.waitForTransaction(hash as string, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
          confirmed = true;
        } catch (waitErr) {
          console.warn(`[bounty ${id}] waitForTransaction warning for ${key}`, waitErr);
          // Fall through to reload anyway — load() reads authoritative chain state.
        }
      }
      const guardBefore = digestRef.current;
      await load();
      // Relayer-delayed private txs / RPC read lag: the first post-tx read
      // can still be pre-inclusion state. Re-poll quietly (bounded) until
      // the readable digest moves (§47.9). Never optimistic — only reads.
      if (hash) {
        for (let i = 0; i < 3; i++) {
          const cur = digestRef.current;
          if (cur !== null && guardBefore !== null && cur !== guardBefore) break;
          if (cur !== null && guardBefore === null) break;
          await new Promise((res) => setTimeout(res, 5000));
          if (!mountedRef.current) break;
          try {
            await load(true);
          } catch {}
        }
      }
      // Post-confirmation tip re-derive (§47.11): re-derive nextK from the
      // on-chain tip instead of trusting the acceptance-time decrement.
      if (confirmed) {
        try {
          await resyncIdentityFromTip();
        } catch {}
      }
    } catch (e: any) {
      // Best-effort heal on failure too: pre-acceptance failures are no-ops
      // here, accepted-then-reverted ones get corrected back.
      try {
        await resyncIdentityFromTip();
      } catch {}
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
      else if (msgLower.includes("not_registered") || msgLower.includes("118")) setError("Your wallet isn’t registered for private transactions yet. In Ready: enable privacy/STRK20, finish private setup, and shield some STRK first — then retry. (Private staking also needs the new Verity contracts, which are still being deployed.)");
      else if (msgLower.includes("insufficient") || msgLower.includes("balance") || msgLower.includes("insufficient_private_balance")) setError("Insufficient funds. Make sure you have enough STRK and try again.");
      else if (msgLower.includes("not_staked")) setError("You need to stake before you can submit. Stake privately to create your investigator identity, then submit.");
      else if (msgLower.includes("not_registered_identity") || msgLower.includes("unknown_preimage")) setError("Investigator identity not recognized. Stake privately first on this device.");
      else if (msgLower.includes("bad_preimage") || msgLower.includes("preimage_zero")) setError("Identity authorization failed. Reload and try again — if it persists, your local identity may be out of sync.");
      else if (msgLower.includes("stake_not_backed")) setError("Stake was not backed by shielded funds. Make sure your private balance covers the stake and try again.");
      else if (msgLower.includes("stake_active")) setError("This investigator identity already has an active stake.");
      else if (msgLower.includes("no_stake")) setError("No active private stake found for this identity.");
      else if (msgLower.includes("is_slashed_cannot_withdraw") || msgLower.includes("is_slashed_cannot_stake")) setError("Slashed identities can’t withdraw or re-stake. The stake was forfeited to the protocol.");
      else if (msgLower.includes("not_private_submission")) setError("This challenge path is only for private submissions.");
      else if (msgLower.includes("already_challenged")) setError("This report has already been challenged.");
      else if (msgLower.includes("challenge_expired")) setError("The 3-day challenge window has closed.");
      else if (msgLower.includes("identity_zero")) setError("Invalid investigator identity. Reload and try again.");
      else if (msgLower.includes("not_alias_bounty")) setError("This action is only for anonymous-creator bounties.");
      else if (msgLower.includes("alias_zero") || msgLower.includes("metadata_zero")) setError("Invalid creation details. Reload and try again.");
      else if (msgLower.includes("use_private_submit")) setError("This bounty accepts only private submissions from staked investigator identities.");
      else if (msgLower.includes("payout_zero")) setError("Please enter a valid refund address.");
      else if (msgLower.includes("preimage_not_needed")) setError("Unexpected authorization payload. Reload and try again.");
      else if (msgLower.includes("not_registered_creator")) setError("Creator identity not recognized on-chain.");
      else if (msgLower.includes("not_authorized") && !msgLower.includes("not_authorized_claim")) setError("You are not authorized for this action.");
      else if (msgLower.includes("invalid_op")) setError("Private staking isn’t live on this deployment yet — the new contracts are still being deployed. Basic staking below still works.");
      else if (msgLower.includes("bounty_must_be_zero") || msgLower.includes("amount_must_be_zero")) setError("Invalid private-transaction payload. Please reload and try again.");
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
      else if (msgLower.includes("no_fund_lock")) setError("Funding locks are not set for this bounty. The creator must set them first (one transaction from the bounty page).");
      else if (msgLower.includes("no_refund_lock")) setError("Refund lock not found. Set the funding locks first.");
      else if (msgLower.includes("no_payout_lock")) setError("No payout claim registered yet. The winner must register their payout claim first.");
      else if (msgLower.includes("bad_secret") || msgLower.includes("secret_zero")) setError("Invalid funding secret. Use the secret backed up at creation, or set new locks (creator, before funding). The bounty remains unchanged.");
      else if (msgLower.includes("no_fund_secret") || msgLower.includes("no_refund_secret") || msgLower.includes("no_payout_secret")) setError(rawMsg.includes(":") ? rawMsg.slice(rawMsg.indexOf(":") + 1).trim() : "Secret not found on this device. Paste your backup secret to continue.");
      else if (msgLower.includes("not_winner")) setError("Only the recorded winner can register a payout claim.");
      else if (msgLower.includes("no_winner")) setError("No winner selected yet.");
      else if (msgLower.includes("no_escrow")) setError("No escrowed funds for this bounty.");
      else if (msgLower.includes("not_refundable")) setError("This bounty can no longer be refunded (winner selected, paid, or already refunded).");
      else if (msgLower.includes("note_must_be_zero")) setError("Invalid funding payload. Please reload and try again.");
      else if (msgLower.includes("lock_zero") || msgLower.includes("escrow_nonzero")) setError("Funding locks are in an unexpected state. Please reload and try again.");
      else if (msgLower.includes("transfer_failed")) setError("Refund transfer failed on-chain. Nothing changed — please try again.");
      else if (msgLower.includes("approve_failed")) setError("Payout approval failed on-chain. Nothing changed — please try again.");
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

  const setLocks = () =>
    guard("locks", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Reuse stored secrets when present (rotation otherwise); persist only
      // after the lock transaction confirms. Secrets never logged.
      let secrets = getBountySecrets(Number(id));
      if (!secrets) secrets = { fund_secret: generateSecret(), refund_secret: generateSecret() };
      const fundLock = computeLock(secrets.fund_secret);
      const refundLock = computeLock(secrets.refund_secret);
      // Alias bounties authorize locks with a creator preimage (non-consuming
      // setup auth — the chain does not advance); legacy passes 0.
      let creatorPreimage = "0x0";
      if (isPrivateBounty) {
        const cc = loadCreator(Number(id));
        if (!cc) throw new Error("Creator identity not found on this device — set locks from the device that created this bounty.");
        creatorPreimage = peekCreatorPreimage(cc);
      }
      const locksHash = await publicInvoke(account, CONTRACTS.verityAnonymizer, "set_locks", [id, fundLock, refundLock, creatorPreimage], "locks", isPrivateBounty);
      saveBountySecrets(Number(id), secrets);
      return locksHash;
    });

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
      // Fund secret: stored at creation (or when locks were set), else pasted backup.
      // The secret itself is NEVER logged — only its presence.
      const secret = (fundSecretPaste.trim() || getBountySecrets(Number(id))?.fund_secret || "").trim();
      if (!secret) throw new Error("NO_FUND_SECRET: funding secret not found on this device. Paste your backup funding secret to continue.");
      if (!locksInfo?.hasFundLock) throw new Error("NO_FUND_LOCK: funding locks are not set for this bounty yet.");
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
      const secretFelt = "0x" + BigInt(secret).toString(16);
      // Phase 3 secret-bound funding (ONE atomic private transaction):
      // 1. withdraw exact reward from shielded balance INTO the helper
      // 2. invoke FUND (no open note, no deposit returned — helper escrows).
      const actionArray = [
        { type: "withdraw", token: STRK20[NETWORK].strkTokenAddress as Address, amount: amountFelt, recipient: CONTRACTS.verityAnonymizer! } as any,
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [OP_FUND, bountyIdFelt, amountFelt, nonce, "0x0", secretFelt] } as any,
      ];
      console.info("[fundPrivate] STRK20 action array", JSON.stringify([
        { type: "withdraw", token: STRK20[NETWORK].strkTokenAddress, amount: amountFelt, recipient: CONTRACTS.verityAnonymizer },
        { type: "invoke", contract: CONTRACTS.verityAnonymizer, calldata: [OP_FUND, bountyIdFelt, amountFelt, nonce, "0x0", "<secret-redacted>"] },
      ], null, 2));
      console.info("[fundPrivate] pool", POOL, "token", STRK20[NETWORK].strkTokenAddress, "helper", CONTRACTS.verityAnonymizer, "bountyId", bountyId, "bountyIdFelt", bountyIdFelt, "amountFelt", amountFelt, "hasSecret", true);
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
              { type: "withdraw", amount: enteredWei },
              { type: "invoke", operation: "FUND_BOUNTY", calldataLength: 6, hasSecret: true },
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
      return publicInvoke(account, CONTRACTS.bountyManager, "open_bounty", [id], "open");
    });

  const stake = () =>
    guard("stake", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      return publicInvoke(account, CONTRACTS.bountyManager, "stake", [], "stake");
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
      saveEvidenceDraft(Number(id), evidence);
      return publicInvoke(account, CONTRACTS.bountyManager, "submit_investigation", [id, evidenceFelt], "submit");
    });

  const selectWinner = (submissionId: number) =>
    guard("select", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      return publicInvoke(account, CONTRACTS.bountyManager, "select_winner", [id, submissionId], "select");
    });

  const report = (submissionId: number) =>
    guard("report", async () => {
      if (!reportReason.trim()) throw new Error("Please provide a reason for the report");
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const reasonFelt = "0x" + Buffer.from(reportReason.trim().slice(0, 31)).toString("hex");
      const evidenceFelt = "0x" + Buffer.from("report-evidence").toString("hex");
      return publicInvoke(account, CONTRACTS.bountyManager, "report_submission", [id, submissionId, reasonFelt, evidenceFelt], "report");
    });

  const challenge = (submissionId: number) =>
    guard("challenge", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      return publicInvoke(account, CONTRACTS.bountyManager, "challenge_report", [id, submissionId], "challenge");
    });

  const resolve = (submissionId: number, shouldSlash: boolean) =>
    guard("resolve", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      return publicInvoke(account, CONTRACTS.bountyManager, "resolve_report", [id, submissionId, shouldSlash], "resolve");
    });

  // ---- Private creator control (alias bounties only) ----
  // Each op consumes one creator-chain preimage AFTER L2 confirmation (the
  // local chain advances only then, so a reverted tx never desyncs this
  // device). Direct calls from any account: preimage knowledge is the auth.

  function requireCreatorSeed(): StoredCreator {
    const cc = loadCreator(Number(id));
    if (!cc) throw new Error("Creator identity not found on this device — control this bounty from the device that created it.");
    return cc;
  }

  async function invokeCreatorPrivate(entry: string, args: (string | number | boolean)[], busyKey: string): Promise<string> {
    const cc = requireCreatorSeed();
    const { wallet } = await connectWallet();
    await ensureConnected();
    const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
    const preimage = peekCreatorPreimage(cc);
    const h = await publicInvoke(account, CONTRACTS.bountyManager, entry, [...args, preimage], `bounty ${id} ${busyKey}`, true);
    if (h) {
      try {
        await provider.waitForTransaction(h as string, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
      } catch (w: any) {
        console.warn(`[bounty ${id}] ${busyKey} waitForTransaction warning`, w?.message);
        throw w;
      }
      const { next } = consumeCreatorPreimage(cc);
      saveCreator(Number(id), next);
      setStoredCreator(next);
    }
    return h;
  }

  const openPrivate = () => guard("open", () => invokeCreatorPrivate("open_bounty_private", [id], "open"));

  const selectWinnerPrivate = (submissionId: number) =>
    guard("select", () => invokeCreatorPrivate("select_winner_private", [id, submissionId], "select"));

  const reportPrivate = (submissionId: number) =>
    guard("report", async () => {
      if (!reportReason.trim()) throw new Error("Please provide a reason for the report");
      const cc = requireCreatorSeed();
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const reasonFelt = "0x" + Buffer.from(reportReason.trim().slice(0, 31)).toString("hex");
      const evidenceFelt = "0x" + Buffer.from("report-evidence").toString("hex");
      const preimage = peekCreatorPreimage(cc);
      const h = await publicInvoke(account, CONTRACTS.bountyManager, "report_private", [id, submissionId, reasonFelt, evidenceFelt, preimage], `bounty ${id} report`, true);
      if (h) {
        try {
          await provider.waitForTransaction(h as string, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
        } catch (w: any) {
          console.warn(`[bounty ${id}] report waitForTransaction warning`, w?.message);
          throw w;
        }
        const { next } = consumeCreatorPreimage(cc);
        saveCreator(Number(id), next);
        setStoredCreator(next);
      }
      return h;
    });

  const resolvePrivate = (submissionId: number, shouldSlash: boolean) =>
    guard("resolve", async () => {
      const cc = requireCreatorSeed();
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Unchallenged alias reports: creator resolves after the window with a
      // preimage; challenged ones go through owner arbitration (legacy
      // resolve entry demoed via owner wallet). Peek only — consume only when
      // this device actually authorizes.
      const r = reportsMap[Number(submissionId)] as any;
      const challenged = !!(r?.challenged ?? r?.[6]);
      if (challenged) throw new Error("Challenged reports resolve through owner arbitration.");
      const preimage = peekCreatorPreimage(cc);
      const h = await publicInvoke(account, CONTRACTS.bountyManager, "resolve_report_private", [id, submissionId, shouldSlash, preimage], `bounty ${id} resolve`, true);
      if (h) {
        try {
          await provider.waitForTransaction(h as string, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
        } catch (w: any) {
          console.warn(`[bounty ${id}] resolve waitForTransaction warning`, w?.message);
          throw w;
        }
        const { next } = consumeCreatorPreimage(cc);
        saveCreator(Number(id), next);
        setStoredCreator(next);
      }
      return h;
    });

  const setPayoutAddress = (payout: string) =>
    guard("payout", async () => {
      if (!payout.trim()) throw new Error("Please enter a refund address");
      const cc = requireCreatorSeed();
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Non-consuming setup auth: the chain does not advance.
      const preimage = peekCreatorPreimage(cc);
      return publicInvoke(account, CONTRACTS.bountyManager, "set_payout_address", [id, payout.trim(), preimage], "payout", true);
    });

  const withdrawStake = () =>
    guard("withdraw", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      return publicInvoke(account, CONTRACTS.bountyManager, "withdraw_stake", [], "withdraw");
    });

  // ---- Private investigator identity flows (STRK20-routed) ----
  // The seed never leaves this device. Stake/submit/payout-register travel as
  // pool-routed private transactions carrying only the identity commitment and
  // single-use preimages — never the wallet address. Challenge is a direct
  // call from any account (preimage knowledge is the auth).

  const discardPending = async () => {
    setBusy("discardPending");
    try {
      clearIdentity();
      setStoredIdentity(null);
      setIdentityInfo(null);
      setRefreshError(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const stakePrivate = () =>
    guard("stakePrivate", async () => {
      // A CONFIRMED identity blocks re-staking (one live stake per device).
      // An UNCONFIRMED (pending) record is replaced: it belongs to a stake
      // whose wallet promise never resolved, and keeping it would strand the
      // user behind a seed that may never land.
      const existing = loadIdentity();
      if (existing && existing.confirmed !== false) throw new Error("An investigator identity already exists on this device. Withdraw it first to start over.");
      if (existing) console.info("[stakePrivate] replacing unconfirmed pending identity", { identity: identityShortId(existing.identity) });
      const address = await ensureConnected();
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      // Required stake amount is authoritative on-chain.
      const cId: any = new Contract({ abi: IDENTITY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const amtRes: any = await cId.call("get_stake_amount", []);
      const stakeWei = BigInt(amtRes?.amt ?? amtRes ?? 0).toString();
      if (BigInt(stakeWei) <= 0n) throw new Error("STAKE_ZERO: no stake amount configured.");
      // Step 1 — wallet-side shielded balance read. Throws NOT_REGISTERED
      // (118) when this account never completed STRK20 onboarding; that is a
      // wallet/pool registration state, not a Verity state. Rethrown as-is.
      console.info("[stakePrivate] step=balances token", STRK20[NETWORK].strkTokenAddress);
      try {
        const balances: any = await account.strk20Balances([STRK20[NETWORK].strkTokenAddress as Address]);
        const entry = (balances as any[]).find((b: any) => String(b.token).toLowerCase() === STRK20[NETWORK].strkTokenAddress.toLowerCase());
        if (entry && BigInt(entry.balance) < BigInt(stakeWei)) throw new Error(`INSUFFICIENT_PRIVATE_BALANCE: private balance ${entry.balance} < required stake ${stakeWei}`);
      } catch (e: any) {
        if (String(e.message).includes("NOT_REGISTERED") || String(e.message).includes("INSUFFICIENT")) throw e;
        console.warn("[stakePrivate] private balance check skipped", e?.message);
      }
      const seed = generateIdentitySeed();
      const identity = genesisTip(seed);
      // Persist the seed BEFORE the wallet submits: if the transaction lands
      // on-chain but the wallet promise is lost (slow prover, closed tab),
      // the next load() still recovers this identity from chain state instead
      // of orphaning the escrow. Confirmed only on wallet acceptance below.
      const pending: StoredIdentity = { seed, identity, nextK: 63, backedUp: false, confirmed: false };
      saveIdentity(pending);
      setStoredIdentity(pending);
      const actionArray = buildStakeActions({
        helper: CONTRACTS.verityAnonymizer!,
        token: STRK20[NETWORK].strkTokenAddress,
        stakeWei,
        identityHex: identity,
      });
      console.info("[stakePrivate] STRK20 action array", JSON.stringify([
        { type: "withdraw", amount: stakeWei, recipient: CONTRACTS.verityAnonymizer },
        { type: "invoke", contract: CONTRACTS.verityAnonymizer, calldata: ["STAKE_IDENTITY", "0x0", stakeWei, "<nonce>", "0x0", "<identity-commitment>"] },
      ]));
      // Step 2 — private transaction. The payload below was validated
      // against the installed Wallet API 0.10.3 schema (withdraw + invoke,
      // all-0x-felts). A NOT_REGISTERED here is the same wallet-side gate.
      console.info("[stakePrivate] step=invoke actions=2 [withdraw stake→helper, invoke STAKE_IDENTITY]");
      try {
        const res: any = await account.strk20InvokeTransaction(actionArray as any);
        const h = res.transaction_hash ?? res.hash;
        // Confirm ONLY after the wallet accepts (guard waits for L2, then
        // load() polls the chain and derives eligibility — no reload needed).
        const confirmedRec = markIdentityConfirmed(pending);
        setStoredIdentity(confirmedRec);
        console.info("[stakePrivate] wallet response", res);
        void address;
        return h;
      } catch (e: any) {
        // The pending seed is KEPT: the transaction may still land. load()
        // recovers it (chain registered → confirmed → eligible) instead of
        // forcing a duplicate stake. Only an explicit discard clears it.
        console.error("[stakePrivate] wallet_strk20InvokeTransaction error (pending identity kept for recovery)", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        throw e;
      }
    });

  const submitPrivate = () =>
    guard("submitPrivate", async () => {
      const statusName = getStatusName((bounty as any)?.status ?? "Created");
      if (statusName !== "Open") throw new Error("NOT_OPEN: This bounty is not open for submissions right now.");
      const local = loadIdentity();
      if (!local) throw new Error("NOT_STAKED: stake privately first to create your investigator identity.");
      if (!evidence.trim()) throw new Error("Please add investigation details");
      await ensureConnected();
      const { wallet, address } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const evidenceFelt = evidenceToFelt(evidence);
      saveEvidenceDraft(Number(id), evidence);
      const preimage = peekPreimage(local);
      const actionArray = buildSubmitActions({
        helper: CONTRACTS.verityAnonymizer!,
        token: STRK20[NETWORK].strkTokenAddress as Address,
        selfAddress: address,
        bountyId: Number(id),
        evidenceFelt,
        preimageHex: preimage,
      });
      // Dust-anchored (Option A, §47.7): [transfer 1 wei→self, invoke].
      // Submitted via the shared fallback chain (direct -> prepare+addInvoke).
      try {
        const res = await strk20InvokeBareActions({ account, actions: actionArray, logTag: "submitPrivate", context: { bountyId: Number(id), pool: POOL, token: STRK20[NETWORK].strkTokenAddress } });
        const h = res.transaction_hash ?? res.hash;
        const { next } = consumePreimage(local); // advance ONLY after wallet acceptance
        setStoredIdentity(next);
        console.info("[submitPrivate] accepted via", res.path);
        return h;
      } catch (e: any) {
        console.error("[submitPrivate] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        throw e;
      }
    });

  const challengePrivate = (submissionId: number) =>
    guard("challengePrivate", async () => {
      const local = loadIdentity();
      if (!local) throw new Error("Identity not found on this device — challenge from the device holding the investigator identity.");
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Direct call from ANY account: preimage knowledge is the authorization.
      const preimage = peekPreimage(local);
      const h = await publicInvoke(account, CONTRACTS.bountyManager, "challenge_private_report", [id, submissionId, preimage], "challengePrivate", true);
      const { next } = consumePreimage(local);
      setStoredIdentity(next);
      return h;
    });

  const registerPayoutPrivate = () =>
    guard("registerPrivate", async () => {
      const local = loadIdentity();
      if (!local) throw new Error("NO_PAYOUT_SECRET: identity not found on this device. Open this page on the device holding the investigator identity.");
      let secret = getPayoutSecret(Number(id));
      if (!secret) secret = generateSecret();
      const { computeLock: lockOf } = await import("@/lib/bounty");
      const lock = lockOf(secret);
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const preimage = peekPreimage(local);
      // Preimage/chain-tip diagnostics (§47.10): prove sync or expose desync
      // BEFORE the wallet opens. Only hashes + redacted preimage ends reach
      // the log — the single-use preimage itself never prints in full.
      let diagChainTip: string | null = null;
      let diagRegistered: boolean | null = null;
      try {
        const tipAbi = [
          { name: "get_identity_tip", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "tip", type: "core::felt252" }], stateMutability: "view" },
          { name: "is_identity_registered", type: "function", inputs: [{ name: "identity", type: "core::felt252" }], outputs: [{ name: "registered", type: "core::bool" }], stateMutability: "view" },
        ] as const;
        const cDiag: any = new Contract({ abi: tipAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const [tipRes, regRes]: any = await Promise.all([
          cDiag.call("get_identity_tip", [local.identity]),
          cDiag.call("is_identity_registered", [local.identity]),
        ]);
        const chainTip = String(tipRes?.tip ?? tipRes?.[0] ?? tipRes ?? "0x0");
        const regRaw = regRes?.registered ?? regRes?.[0] ?? regRes;
        const registered = regRaw === true || String(regRaw).toLowerCase() === "true" || ((() => { try { return BigInt(String(regRaw)) !== 0n; } catch { return false; } })());
        diagChainTip = chainTip;
        diagRegistered = registered;
        const expectedTip = chainAt(local.seed, local.nextK + 1);
        const tipMatch = normFelt(expectedTip)?.toLowerCase() === normFelt(chainTip)?.toLowerCase();
        // Resync hint: walk the LOCAL chain for the on-chain tip. Found at
        // k*  =>  correct nextK is k*-1. Not found  =>  wrong seed/record.
        let resyncNextK: number | null = null;
        try {
          let v: string = normFelt(local.seed) ?? "";
          for (let k = 0; k <= 64 && v; k++) {
            if (v.toLowerCase() === normFelt(chainTip)?.toLowerCase()) { resyncNextK = k - 1; break; }
            v = poseidon1(v);
          }
        } catch {}
        console.info("[registerPayoutPrivate] preimage diagnostics", {
          nextK: local.nextK,
          identity: identityShortId(local.identity),
          preimageEnds: `${String(preimage).slice(0, 6)}…${String(preimage).slice(-4)}`,
          expectedTipEnds: `${expectedTip.slice(0, 6)}…${expectedTip.slice(-4)}`,
          chainTipEnds: `${chainTip.slice(0, 6)}…${chainTip.slice(-4)}`,
          registered,
          tipMatch,
          resyncNextK,
        });
      } catch (diagErr: any) {
        console.warn("[registerPayoutPrivate] preimage diagnostics skipped", diagErr?.message ?? String(diagErr));
      }
      // Fail fast on a PROVEN wrong record (§47.11): registered on-chain but
      // the tip is nowhere in this device's chain — submission would burn a
      // fee reverting. Stale reads cannot fake this (every historical tip is
      // in-walk); skipped reads never block (nulls).
      if (diagRegistered === true && diagChainTip) {
        const chk = deriveNextKFromTip(local.seed, diagChainTip);
        if (!chk.found) {
          throw new Error("WRONG_DEVICE_RECORD: this device's investigator record does not match any on-chain identity for the winner. Register from the device/browser that staked and submitted — compare the eligibility short-id with the winner. Nothing was submitted.");
        }
      }
      const actionArray = buildRegPayoutActions({
        helper: CONTRACTS.verityAnonymizer!,
        token: STRK20[NETWORK].strkTokenAddress as Address,
        selfAddress: address,
        bountyId: Number(id),
        payoutLockHex: lock,
        preimageHex: preimage,
      });
      // Dust-anchored (Option A, §47.8): [transfer 1 wei→self, invoke].
      try {
        const res = await strk20InvokeBareActions({ account, actions: actionArray, logTag: "registerPayoutPrivate", context: { bountyId: Number(id), pool: POOL } });
        const h = res.transaction_hash ?? res.hash;
        const { next } = consumePreimage(local);
        setStoredIdentity(next);
        savePayoutSecret(Number(id), secret);
        console.info("[registerPayoutPrivate] accepted via", res.path);
        return h;
      } catch (e: any) {
        console.error("[registerPayoutPrivate] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        throw e;
      }
    });

  const unstakePrivate = () =>
    guard("unstakePrivate", async () => {
      const local = loadIdentity();
      if (!local) throw new Error("Identity not found on this device.");
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const preimage = peekPreimage(local);
      const actionArray = buildUnstakeActions({
        helper: CONTRACTS.verityAnonymizer!,
        token: STRK20[NETWORK].strkTokenAddress,
        selfAddress: address,
        preimageHex: preimage,
      });
      console.info("[unstakePrivate] STRK20 action array", JSON.stringify([
        { type: "transfer", amount: "OPEN" },
        { type: "invoke", contract: CONTRACTS.verityAnonymizer, calldata: ["UNSTAKE_IDENTITY", "0x0", "0x0", "<nonce>", "${openNoteIds[0]}", "<preimage-single-use>"] },
      ]));
      try {
        const res: any = await account.strk20InvokeTransaction(actionArray as any);
        const h = res.transaction_hash ?? res.hash;
        const { next } = consumePreimage(local);
        setStoredIdentity(next);
        console.info("[unstakePrivate] wallet response", res);
        return h;
      } catch (e: any) {
        console.error("[unstakePrivate] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        throw e;
      }
    });

  const refund = () =>
    guard("refund", async () => {
      if (!bounty) throw new Error("Bounty not loaded");
      // Refund secret: stored at creation/lock time, else pasted backup. Never logged.
      const secret = (refundSecretPaste.trim() || getBountySecrets(Number(id))?.refund_secret || "").trim();
      if (!secret) throw new Error("NO_REFUND_SECRET: refund secret not found on this device. Paste your backup refund secret to continue.");
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const bountyIdFelt = "0x" + BigInt(String(bountyId)).toString(16);
      // Exact recorded escrow (helper enforces equality; 0 for unfunded cancel).
      const escrowWei = locksInfo?.escrowWei ?? 0n;
      const amountFelt = "0x" + escrowWei.toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const secretFelt = "0x" + BigInt(secret).toString(16);
      // Dust-anchored (Option A, §47.8): [transfer 1 wei→self, invoke].
      // The invoke below is byte-identical to the former bare shape.
      const actionArray = [
        buildDustAnchorAction(STRK20[NETWORK].strkTokenAddress as Address, address),
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [OP_REFUND, bountyIdFelt, amountFelt, nonce, "0x0", secretFelt] } as any,
      ];
      console.info("[refund] diagnostic payload", {
        walletApiMethod: "wallet_strk20InvokeTransaction",
        network: NETWORK,
        bountyId,
        escrowWei: escrowWei.toString(),
        hasSecret: true,
        targetContract: CONTRACTS.verityAnonymizer,
        actionCount: actionArray.length,
      });
      try {
        const res = await strk20InvokeBareActions({ account, actions: actionArray, logTag: "refund", context: { bountyId, pool: POOL } });
        console.info("[refund] accepted via", res.path);
        return res.transaction_hash ?? res.hash;
      } catch (e: any) {
        console.error("[refund] wallet_strk20InvokeTransaction error", e, "data", JSON.stringify(e?.data ?? e?.cause, null, 2));
        throw e;
      }
    });

  const registerPayout = () =>
    guard("register", async () => {
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Winner payout secret: reuse stored (rotation allowed pre-release),
      // persist only after registration confirms. Never logged.
      let secret = getPayoutSecret(Number(id));
      if (!secret) secret = generateSecret();
      const lock = computeLock(secret);
      const h = await publicInvoke(account, CONTRACTS.verityAnonymizer, "register_payout_lock", [id, lock], "register");
      savePayoutSecret(Number(id), secret);
      return h;
    });

  // Option A evidence publish (§47.12): public text, private author.
  // Direct call (challenge pattern): content is public by design, so no
  // pool leg and no pool fee. Private submissions retire a chain preimage
  // (consumed — never reuse it); legacy uses caller==investigator auth.
  // Sender IS visible: publish from a fresh account for unlinkability.
  const publishEvidenceText = (submissionId: number) =>
    guard("publish", async () => {
      const sub = submissions.find((s: any) => Number(s.id) === submissionId);
      if (!sub) throw new Error("Submission not loaded — reload and try again.");
      const text = (evidence.trim() || loadEvidenceDraft(Number(id)) || "").trim();
      if (!text) throw new Error("Evidence text not found on this device — type it again to publish.");
      const chunks = splitTextToFelts(text);
      const subIdentity = (() => { try { const n = normFelt(String((sub as any)?.identity ?? "")); return n && BigInt(n) !== 0n ? n : null; } catch { return null; } })();
      const { wallet } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const fx = (v: string | number | bigint) => "0x" + BigInt(String(v)).toString(16);
      let preimageHex = "0x0";
      let localRec: StoredIdentity | null = null;
      if (subIdentity) {
        localRec = loadIdentity();
        if (!localRec) throw new Error("Identity not found on this device — publish from the device holding the investigator identity.");
        preimageHex = peekPreimage(localRec);
      }
      const bmAddr = normalizeContractAddress(CONTRACTS.bountyManager, "BountyManager");
      // Span<felt252> serializes length-prefixed: [bid, sid, len, ...chunks, preimage].
      const calldata = [fx(id), fx(submissionId), fx(chunks.length), ...chunks.map((c) => fx(c)), fx(preimageHex)];
      console.info("[publish] wallet_addInvokeTransaction params", { contract: bmAddr, entrypoint: "publish_evidence", bountyId: Number(id), submissionId, chunkCount: chunks.length });
      const res: any = await account.execute([{ contractAddress: bmAddr, entrypoint: "publish_evidence", calldata }]);
      const h = res.transaction_hash ?? res.hash;
      if (subIdentity && localRec) {
        const { next } = consumePreimage(localRec);
        setStoredIdentity(next);
      }
      clearEvidenceDraft(Number(id));
      console.info("[publish] wallet response", res);
      return h;
    });

  const claim = () =>
    guard("claim", async () => {
      const winner = (bounty as any)?.winner ?? null;
      const normWinner = winner ? normalizeAddr(String(winner)) : null;
      const normConnected = connectedAddr ? normalizeAddr(connectedAddr) : null;
      // Private wins are authorized by the payout secret + identity chain, not
      // by the connected wallet (the recorded winner is a commitment, not a
      // signer). Legacy wins keep the wallet check.
      if (!isPrivateWin && normWinner && normConnected && normWinner !== normConnected) throw new Error("NOT_AUTHORIZED_CLAIM: Only the winner can claim this reward");
      if (isPrivateWin && !isWinnerPrivate) throw new Error("NOT_AUTHORIZED_CLAIM: Only the winning investigator identity (on its device) can claim this reward");
      if (!winner || String(winner) === "0x0" || (winner as any) === 0) throw new Error("No winner selected yet");
      if (!locksInfo?.hasPayoutLock) throw new Error("NO_PAYOUT_LOCK: register your payout claim first (one transaction), then claim privately.");
      const secret = (payoutSecretPaste.trim() || getPayoutSecret(Number(id)) || "").trim();
      if (!secret) throw new Error("NO_PAYOUT_SECRET: payout secret not found on this device. Register your payout claim again to rotate it.");
      const { wallet, address } = await connectWallet();
      await ensureConnected();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const bountyIdFelt = "0x" + BigInt(bountyId).toString(16);
      // Exact recorded escrow fills the winner's open note (helper enforces).
      const escrowWei = locksInfo?.escrowWei ?? getRewardWei(bounty);
      const amountFelt = "0x" + escrowWei.toString(16);
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const secretFelt = "0x" + BigInt(secret).toString(16);
      const actionArray = [
        { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [OP_RELEASE, bountyIdFelt, amountFelt, nonce, "${openNoteIds[0]}", secretFelt] } as any,
      ];
      console.info("[claim] STRK20 action array", JSON.stringify([
        { type: "transfer", token: STRK20[NETWORK].strkTokenAddress, amount: "OPEN", recipient: address },
        { type: "invoke", contract: CONTRACTS.verityAnonymizer, calldata: [OP_RELEASE, bountyIdFelt, amountFelt, nonce, "${openNoteIds[0]}", "<secret-redacted>"] },
      ], null, 2));
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
  const isCreatorLegacy = isCreatorAddr(creatorAddr, connectedAddr);
  // Private creator match: chain alias vs device seed (never the wallet).
  // On alias bounties the recorded "creator" is a commitment cast, so the
  // legacy wallet comparison above is always false there by construction.
  const creatorAlias = (bounty as any)?.creatorAlias ?? null;
  const isPrivateBounty = !!creatorAlias;
  const isCreatorPrivate = !!(
    isPrivateBounty && storedCreator &&
    normFelt(storedCreator.alias)?.toLowerCase() === normFelt(String(creatorAlias))?.toLowerCase()
  );
  // Combined creator control (legacy wallet OR alias seed). Every creator
  // action below branches on isPrivateBounty for the correct auth path.
  const isCreator = isCreatorLegacy || isCreatorPrivate;
  const isWinner = !!(normWinner && normConnected && normWinner === normConnected && normWinner !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  // Private win detection: the winning submission carries an identity
  // commitment (never a wallet). The local device matches by identity, not
  // by wallet address.
  const winningSub = submissions.find((s: any) => Number(s.id) === Number((bounty as any)?.winningSubmission));
  const winningSubIdentity = (() => {
    const raw = (winningSub as any)?.identity ?? (winningSub as any)?.[6];
    const n = normFelt(raw != null ? String(raw) : null);
    if (!n) return null;
    try {
      return BigInt(n) === 0n ? null : n;
    } catch {
      return null;
    }
  })();
  const isPrivateWin = !!winningSubIdentity;
  const isWinnerPrivate = !!(isPrivateWin && storedIdentity && normFelt(storedIdentity.identity)?.toLowerCase() === (winningSubIdentity as string).toLowerCase());
  // Creator device secrets (fund/refund set at creation or lock time; payout
  // by the winner at claim time). Plaintexts never leave this device except
  // inside the private-tx calldata that consumes them. Never logged.
  const storedSecrets = getBountySecrets(Number(id));
  const storedPayoutSecret = getPayoutSecret(Number(id));

  const secretField = (inputId: string, label: string, value: string, setValue: (v: string) => void, help: string) => (
    <div>
      <label className="label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="password"
        className="input"
        placeholder="Paste backup secret"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="help">{help}</div>
    </div>
  );

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

  // Submit gate — chain reads ONLY (never localStorage, never popup success).
  // Private identity first, legacy public stake second. The wallet must never
  // open when neither path is eligible: the contract would reject with
  // NOT_STAKED and the user would sign a doomed transaction.
  const legacyEligible = eligibility?.eligible ?? false;
  const privateEligible = identityInfo?.eligible ?? false;
  // Single rule for the submit button (chain reads only — see submitGate).
  const gateState = submitGate({ loaded: eligibilityLoaded, privateEligible, legacyEligible });
  const submitEligible = gateState === "eligible";
  const stakeAmountLabel = identityInfo?.stakeAmountWei && identityInfo.stakeAmountWei > 0n
    ? formatReward(identityInfo.stakeAmountWei.toString())
    : (eligibility?.stakeAmountStr ?? "1 STRK");

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
              {isPrivateBounty && creatorAlias ? (
                <span style={{ fontSize: 12 }}>Anonymous Creator {identityShortId(String(creatorAlias))} {isCreatorPrivate && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
              ) : (
                <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(creatorHex)} {isCreator && <span style={{ color: "var(--accent)", fontWeight: 600 }}>(you)</span>}</span>
              )}
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

      {/* Investigator eligibility — private staking first, basic staking fallback.
          Private identity: stake travels as a shielded STRK20 transaction bound
          to an identity commitment. No wallet address is recorded on-chain;
          Verity only learns eligible / not eligible. The seed lives on this
          device only — back it up. Legacy one-click staking still works
          on-chain (regression path) but is public. */}
      {!isCreator && isOpen && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: identityInfo?.eligible ? "var(--border)" : "var(--amber-border)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Investigator eligibility</h3>
          {!storedIdentity ? (
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Stake privately to participate. Your investigator identity and stake remain private
                while Verity verifies that you are eligible. A small privacy fee applies.
              </p>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Required stake</span>
                <span style={{ fontWeight: 600 }}>{identityInfo?.stakeAmountWei ? formatReward(identityInfo.stakeAmountWei.toString()) : (eligibility ? eligibility.stakeAmountStr : "1 STRK")}</span>
              </div>
              <button disabled={!!busy} onClick={stakePrivate} className="btn btn-primary" style={{ marginTop: 4 }}>
                {busy === "stakePrivate" ? "Confirm in wallet…" : "Stake privately"}
              </button>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
                After staking, this device holds your investigator identity — back it up when shown.
                Submissions, reputation and rewards link to that identity, not your wallet.
              </p>
              {!eligibility?.hasStake && (
                <details style={{ fontSize: 12 }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>Basic (public) staking instead</summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Public fallback: links your wallet address on-chain. Private staking above is recommended.</p>
                    <button disabled={!!busy} onClick={stake} className="btn btn-ghost">
                      {busy === "stake" ? "Staking…" : `Stake publicly${eligibility ? ` (${eligibility.stakeAmountStr})` : ""}`}
                    </button>
                  </div>
                </details>
              )}
            </div>
          ) : !identityInfo ? (
            storedIdentity && storedIdentity.confirmed === false ? (
              <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Stake submitted — waiting for on-chain confirmation for Anonymous {identityShortId(storedIdentity.identity)}.
                  This resolves automatically; no refresh needed.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button disabled={!!busy} onClick={() => load()} className="btn btn-secondary" style={{ fontSize: 12 }}>
                    Check again
                  </button>
                  <button disabled={!!busy} onClick={discardPending} className="btn btn-ghost" style={{ fontSize: 12 }}>
                    Discard pending identity
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
                  Discard only if the wallet never submitted (cancelled prompt). If the transaction landed,
                  this device re-discovers the stake from chain state instead — nothing is lost.
                </p>
              </div>
            ) : refreshError ? (
              <div>
                <p style={{ fontSize: 13, color: "var(--amber)", margin: "0 0 8px" }}>{refreshError}</p>
                <button disabled={!!busy} onClick={() => load()} className="btn btn-secondary" style={{ fontSize: 12 }}>
                  Retry stake-state read
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Loading eligibility…</p>
            )
          ) : identityInfo.slashed ? (
            <div className="alert alert-error" style={{ margin: 0 }}>
              <span>⚠</span>
              <div><strong>Identity slashed</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Investigator {identityShortId(identityInfo.identity)} can’t submit. The stake was forfeited.</div></div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Investigator</span>
                <span style={{ fontWeight: 600 }}>Anonymous {identityShortId(identityInfo.identity)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Private stake</span>
                <span>{identityInfo.registered && identityInfo.escrowWei > 0n ? `${formatReward(identityInfo.escrowWei.toString())} ✓ Verified` : "Not found ✗"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Reputation</span>
                <span style={{ fontWeight: 600 }}>{identityInfo.reputation} / 100 {identityInfo.reputation >= identityInfo.minRep ? "✓" : "✗"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Required</span>
                <span>{identityInfo.minRep}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: identityInfo.eligible ? "var(--text)" : "var(--amber)" }}>
                {identityInfo.eligible ? "✓ Eligible — you can submit an investigation" : "✗ Not eligible yet"}
              </div>
              {!storedIdentity.backedUp && identityInfo.registered && (
                <div className="alert alert-warn" style={{ margin: "6px 0 0" }}>
                  <span>◈</span>
                  <div><strong>Back up this device’s identity</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Your investigator identity lives only here. Clearing browser data without a backup locks the stake.</div></div>
                </div>
              )}
              {identityInfo.registered && identityInfo.escrowWei > 0n && !identityInfo.slashed && (
                <button disabled={!!busy} onClick={unstakePrivate} className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }}>
                  {busy === "unstakePrivate" ? "Withdrawing…" : "Withdraw stake privately"}
                </button>
              )}
            </div>
          )}
          {identityInfo && !identityInfo.eligible && !identityInfo.slashed && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.4 }}>
              {identityInfo.reputation < identityInfo.minRep ? `Reputation too low (have ${identityInfo.reputation}, need ${identityInfo.minRep}). Wins increase reputation; slashes reduce it.` : "Stake is still confirming — reload in a moment."}
            </p>
          )}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Actions</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
          {isCreated && (isCreator ? (locksInfo && !locksInfo.hasFundLock ? "Status: CREATED — set the funding locks first (one transaction), then fund privately." : "Status: CREATED — waiting for funding. Enter the exact reward amount and fund it privately. The bounty is NOT funded yet.") : "Status: CREATED — waiting for the creator to fund this bounty.")}
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
          {isCreated && isCreator && locksInfo && !locksInfo.hasFundLock && (
            <div style={{ display: "grid", gap: 10, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--amber-border)", borderRadius: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Set funding locks</div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                Before this bounty can be funded, commit the funding locks (one transaction).
                {isPrivateBounty ? " This authorizes funding for your anonymous creator identity — no wallet is linked." : " This binds funding authorization to your wallet — only you will be able to fund it."}
                New secrets are generated on this device and backed up to you if none exist yet.
              </p>
              <button disabled={!!busy} onClick={setLocks} className="btn btn-primary">
                {busy === "locks" ? "Setting locks…" : "Set funding locks"}
              </button>
            </div>
          )}
          {isPrivateBounty && isCreatorPrivate && !(bounty as any)?.payoutAddress && (
            <div style={{ display: "grid", gap: 10, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--amber-border)", borderRadius: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Set refund address</div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                Refunds move on a public transfer, so they need a plain address. Enter one you control —
                a fresh address keeps this bounty unlinkable to your other activity. Required before funding.
              </p>
              <input
                className="input"
                placeholder="0x… refund address"
                value={payoutAddrInput}
                onChange={(e) => setPayoutAddrInput(e.target.value)}
                style={{ fontFamily: "Fragment Mono", fontSize: 12 }}
                spellCheck={false}
              />
              <button disabled={!!busy} onClick={() => setPayoutAddress(payoutAddrInput)} className="btn btn-secondary">
                {busy === "payout" ? "Setting…" : "Set refund address"}
              </button>
            </div>
          )}
          {isCreated && isCreator && (!locksInfo || locksInfo.hasFundLock) && (
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
              {!storedSecrets?.fund_secret && secretField("fund-secret", "Funding secret (backup)", fundSecretPaste, setFundSecretPaste, "Not found on this device — paste the backup funding secret shown at creation.")}
              <button disabled={!!busy} onClick={fundPrivate} className="btn btn-primary">
                {busy === "fund" ? "Confirm in wallet…" : "Fund privately"}
              </button>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>Your shielded balance funds the helper escrow in one atomic private transaction. Status becomes FUNDED only after the transaction is confirmed.</p>
            </div>
          )}
          {isCreated && connectedAddr && !isCreator && (
            <div className="alert alert-warn" style={{ margin: 0 }}>
              <span>◈</span>
              <div><strong>Status: CREATED — awaiting creator funding</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Only the creator can fund this bounty. Check back after it is funded and opened.</div></div>
            </div>
          )}
          {isFunded && isCreator && (
            <div style={{ display: "grid", gap: 10 }}>
              <button disabled={!!busy} onClick={isPrivateBounty ? openPrivate : open} className="btn btn-primary">
                {busy === "open" ? "Processing…" : "Open bounty"}
              </button>
              <div style={{ display: "grid", gap: 8, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Reclaim instead (no winner)</div>
                {!storedSecrets?.refund_secret && secretField("refund-secret-funded", "Refund secret (backup)", refundSecretPaste, setRefundSecretPaste, "Not found on this device — paste the backup refund secret shown at creation.")}
                <button disabled={!!busy} onClick={refund} className="btn btn-secondary">
                  {busy === "refund" ? "Reclaiming…" : "No winner — reclaim funds (protocol fee applies)"}
                </button>
              </div>
            </div>
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
              {privateEligible && identityInfo && (
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Submitting as Anonymous {identityShortId(identityInfo.identity)} — your wallet stays private.</p>
              )}
              {!eligibilityLoaded || gateState === "loading" ? (
                <button disabled className="btn btn-primary">Checking eligibility…</button>
              ) : submitEligible ? (
                <button disabled={!!busy} onClick={privateEligible ? submitPrivate : submit} className="btn btn-primary">
                  {busy === "submitPrivate" ? "Submitting privately…" : busy === "submit" ? "Submitting…" : privateEligible ? "Submit investigation privately" : "Submit investigation"}
                </button>
              ) : refreshError ? (
                <>
                  <div className="alert alert-error" style={{ margin: 0 }}>
                    <span>⚠</span>
                    <div>
                      <strong>Couldn’t verify stake state</strong>
                      <div style={{ opacity: 0.85, marginTop: 4 }}>{refreshError} The chain may be fine — this is a read failure, not proof you are unstaked.</div>
                    </div>
                  </div>
                  <button disabled={!!busy} onClick={() => load()} className="btn btn-secondary">
                    Retry stake-state read
                  </button>
                  <button disabled className="btn btn-secondary" title="Eligibility reads must succeed before submitting">
                    Submit Investigation
                  </button>
                </>
              ) : (
                <>
                  <div className="alert alert-warn" style={{ margin: 0 }}>
                    <span>◈</span>
                    <div>
                      <strong>Private stake required</strong>
                      <div style={{ opacity: 0.85, marginTop: 4 }}>Stake {stakeAmountLabel} to become eligible. Submission unlocks only after your stake is confirmed on-chain.</div>
                    </div>
                  </div>
                  <button disabled={!!busy} onClick={stakePrivate} className="btn btn-primary">
                    {busy === "stakePrivate" ? "Confirm in wallet…" : "Stake Privately"}
                  </button>
                  <button disabled className="btn btn-secondary" title="Stake first — the contract rejects unstaked submissions">
                    Submit Investigation
                  </button>
                </>
              )}
              {!connectedAddr && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Connect your wallet to submit.</div>}
            </div>
          )}
          {isOpen && isCreator && (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="alert alert-warn" style={{ margin: 0 }}>
                <span>◈</span>
                <div><strong>You created this bounty. You cannot submit an investigation to it.</strong><div style={{ opacity: 0.85, marginTop: 4 }}>Review investigations below and select a winner when ready, or reclaim funds if none deserve the reward.</div></div>
              </div>
              {!storedSecrets?.refund_secret && secretField("refund-secret-open", "Refund secret (backup)", refundSecretPaste, setRefundSecretPaste, "Not found on this device — paste the backup refund secret shown at creation.")}
              <button disabled={!!busy} onClick={refund} className="btn btn-secondary">
                {busy === "refund" ? "Reclaiming…" : "No winner — reclaim funds (protocol fee applies)"}
              </button>
            </div>
          )}
          {(isWinnerSelected || isClaimable) && (
            <>
              {isWinner || isWinnerPrivate ? (
                isWinnerPrivate ? (
                  locksInfo && !locksInfo.hasPayoutLock ? (
                    <div style={{ display: "grid", gap: 8, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Register payout claim privately</div>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                        Step 1 of 2: register your payout claim as Anonymous {identityInfo ? identityShortId(identityInfo.identity) : ""} (one private transaction).
                        Only the winning identity can do this — your wallet stays private.
                      </p>
                      <button disabled={!!busy} onClick={registerPayoutPrivate} className="btn btn-primary">
                        {busy === "registerPrivate" ? "Registering…" : "Register payout claim privately"}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {!storedPayoutSecret && secretField("payout-secret", "Payout secret (backup)", payoutSecretPaste, setPayoutSecretPaste, "Not found on this device — register your payout claim again to rotate it, or paste the backup.")}
                      <button disabled={!!busy} onClick={claim} className="btn btn-primary">
                        {busy === "claim" ? "Claiming privately…" : "Claim reward privately"}
                      </button>
                    </div>
                  )
                ) : locksInfo && !locksInfo.hasPayoutLock ? (
                  <div style={{ display: "grid", gap: 8, padding: 16, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Register payout claim</div>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                      Step 1 of 2: register your payout claim (one transaction). Only the recorded winner can do this.
                      A payout secret is generated on this device — it authorizes the private release to you and nobody else.
                    </p>
                    <button disabled={!!busy} onClick={registerPayout} className="btn btn-primary">
                      {busy === "register" ? "Registering…" : "Register payout claim"}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {!storedPayoutSecret && secretField("payout-secret", "Payout secret (backup)", payoutSecretPaste, setPayoutSecretPaste, "Not found on this device — register your payout claim again to rotate it, or paste the backup.")}
                    <button disabled={!!busy} onClick={claim} className="btn btn-primary">
                      {busy === "claim" ? "Claiming privately…" : "Claim reward privately"}
                    </button>
                  </div>
                )
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
        {busy && <div style={{ marginTop: 12, fontSize: 12, color: "var(--amber)" }}>Waiting for wallet… {busy === "fund" || busy === "claim" || busy === "refund" || busy === "stakePrivate" || busy === "submitPrivate" || busy === "registerPrivate" || busy === "unstakePrivate" ? "This uses a private proof and may take up to 30 seconds." : "Confirm in your wallet."}</div>}
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
              // Ownership: private submissions match by identity commitment on
              // this device; legacy submissions match by wallet address.
              const subIdentityNorm = (() => {
                const raw = (s as any)?.identity ?? (s as any)?.[6];
                const n = normFelt(raw != null ? String(raw) : null);
                if (!n) return null;
                try {
                  return BigInt(n) === 0n ? null : n;
                } catch {
                  return null;
                }
              })();
              const isOwnPrivate = !!(subIdentityNorm && storedIdentity && normFelt(storedIdentity.identity)?.toLowerCase() === subIdentityNorm.toLowerCase());
              const isOwn = isOwnPrivate || (connectedAddr && normalizeAddr(invAddr) === normalizeAddr(connectedAddr));
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
                    {String((s as any).evidenceText ?? "").length > 0 ? String((s as any).evidenceText).slice(0, 280) : `${String(s.evidence_hash).slice(0, 64)}…`}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {isCreator && isOpen && statusLabel === "Pending" && (
                      <>
                        <button disabled={!!busy} onClick={() => (isPrivateBounty ? selectWinnerPrivate(Number(s.id)) : selectWinner(Number(s.id)))} className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}>
                          {busy === "select" && selectedSubmission === Number(s.id) ? "Selecting…" : "Select winner"}
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            const reason = prompt("Reason for reporting this investigation (will be recorded on-chain, investigator can challenge within 3 days):");
                            if (reason) {
                              setReportReason(reason);
                              setTimeout(() => (isPrivateBounty ? reportPrivate(Number(s.id)) : report(Number(s.id))), 100);
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
                      <button disabled={!!busy} onClick={() => (isOwnPrivate ? challengePrivate(Number(s.id)) : challenge(Number(s.id)))} className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12, borderColor: "var(--amber-border)", color: "var(--amber)" }}>
                        {busy === "challenge" || busy === "challengePrivate" ? "Challenging…" : "Challenge report (3-day window)"}
                      </button>
                    )}
                    {statusLabel === "Reported" && (isCreator || connectedAddr === "0x100") && (
                      <>
                        <button disabled={!!busy} onClick={() => (isPrivateBounty ? resolvePrivate(Number(s.id), true) : resolve(Number(s.id), true))} className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 12, background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}>
                          {busy === "resolve" ? "Resolving…" : "Confirm slash"}
                        </button>
                        <button disabled={!!busy} onClick={() => (isPrivateBounty ? resolvePrivate(Number(s.id), false) : resolve(Number(s.id), false))} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}>
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
                    {!(s as any).evidenceText && isOwn && (
                      <button disabled={!!busy} onClick={() => publishEvidenceText(Number(s.id))} className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }} title="Evidence text is public on-chain; only your commitment stays private. Publishing is a public transaction — use a fresh account for full unlinkability.">
                        {busy === "publish" ? "Publishing…" : "Publish evidence text (public)"}
                      </button>
                    )}
                    <button onClick={() => setSelectedSubmission(selectedSubmission === Number(s.id) ? null : Number(s.id))} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}>
                      {selectedSubmission === Number(s.id) ? "Hide" : "Read investigation"}
                    </button>
                  </div>
                  {selectedSubmission === Number(s.id) && (
                    <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Evidence</div>
                      <div style={{ wordBreak: "break-all", fontFamily: "Fragment Mono", fontSize: 11 }}>{String((s as any).evidenceText ?? s.evidence_hash)}</div>
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
