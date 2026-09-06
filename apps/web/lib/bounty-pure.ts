// VERITY bounty pure logic — NO chain/wallet imports.
//
// Single source of truth for reward conversion, status parsing, and
// current-stage permission gating. Dependency-free so it can be unit-tested
// with Node's built-in runner (`node --test`) without a bundler.
// apps/web/lib/bounty.ts re-exports everything here and adds chain I/O.

export type BountyStatusName = "Created" | "Funded" | "Open" | "WinnerSelected" | "Claimable" | "Paid" | "Refunded";

export interface BountyViewModel {
  id: number;
  creator: string;
  rewardWei: bigint; // exact u128 as bigint, never Number
  rewardStr: string; // human "10" or "1,550"
  status: BountyStatusName;
  metadataHash: string;
  createdAt: number;
  fundedAmountWei: bigint;
  winner: string | null;
  winningSubmission: number | null;
  title: string;
  description: string;
}

export function formatRewardWei(wei: bigint | string | number): string {
  try {
    const n = BigInt(wei ?? 0);
    if (n === 0n) return "0 STRK";
    const weiPerStrk = 1000000000000000000n;
    const whole = n / weiPerStrk;
    const frac = n % weiPerStrk;
    if (frac === 0n) return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} STRK`;
    let fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    if (fracStr.length > 6) fracStr = fracStr.slice(0, 6).replace(/0+$/, "");
    if (whole === 0n) return `0.${fracStr} STRK`;
    return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fracStr} STRK`;
  } catch {
    return String(wei ?? "—");
  }
}

export function weiToStr(wei: bigint | string): string {
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

export function humanToWei(s: string): string {
  const trimmed = s.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Please enter a valid amount");
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) throw new Error("Too many decimal places (max 18)");
  const frac18 = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt((whole === "" ? "0" : whole) + frac18).toString();
}

// Extract status name from CairoCustomEnum or string/number
// Canonical return is PascalCase: Created|Funded|Open|WinnerSelected|Claimable|Paid|Refunded
export function getStatusName(status: any): BountyStatusName {
  const canon = (s: string): BountyStatusName | null => {
    const t = s.trim().toLowerCase().replace(/[\s_-]/g, "");
    const map: Record<string, BountyStatusName> = {
      created: "Created",
      funded: "Funded",
      open: "Open",
      winnerSelected: "WinnerSelected",
      winnerselected: "WinnerSelected",
      winner: "WinnerSelected",
      voting: "WinnerSelected", // legacy Sepolia bounties
      claimable: "Claimable",
      paid: "Paid",
      refunded: "Refunded",
    };
    return map[s.trim()] as BountyStatusName
      || map[t] as BountyStatusName
      || null;
  };
  if (!status && status !== 0) return "Created";
  if (typeof status === "string") {
    const c = canon(status);
    if (c) return c;
    const map: Record<string, BountyStatusName> = { "0":"Created","1":"Funded","2":"Open","3":"WinnerSelected","4":"Claimable","5":"Paid","6":"Refunded","7":"Refunded" };
    return map[status.trim()] || "Created";
  }
  if (typeof status === "number" || typeof status === "bigint") {
    const map: Record<string, BountyStatusName> = { "0":"Created","1":"Funded","2":"Open","3":"WinnerSelected","4":"Claimable","5":"Paid","6":"Refunded" };
    return map[String(status)] || "Created";
  }
  // CairoCustomEnum { variant: {Created: {}, Funded: undefined, ...} }
  if (typeof status === "object" && status.variant) {
    const variant = status.variant as Record<string, any>;
    const key = Object.keys(variant).find(k => variant[k] !== undefined);
    if (key) {
      const c = canon(key);
      if (c) return c;
    }
  }
  // Fallback for starknet.js enum that may be like { Created: null } directly
  if (typeof status === "object") {
    const keys = Object.keys(status);
    for (const k of keys) {
      const c = canon(k);
      if (c) return c;
    }
    // Try to find active variant where value is {} or not undefined
    for (const k of keys) {
      if ((status as any)[k] !== undefined) {
        const c2 = canon(k);
        if (c2) return c2;
        return "Created";
      }
    }
  }
  return "Created";
}

// ---- Authoritative status helpers (single source of truth for UI gating) ----
// All accept the canonical BountyStatusName from getStatusName/loadBounty,
// but also tolerate legacy numeric ("0") and uppercase ("CREATED") inputs.
export function isStatus(s: BountyStatusName | string | number, name: BountyStatusName): boolean {
  return getStatusName(s as any) === name;
}

export function isCreatedStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Created"); }
export function isFundedStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Funded"); }
export function isOpenStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Open"); }
export function isWinnerSelectedStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "WinnerSelected"); }
export function isClaimableStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Claimable"); }
export function isPaidStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Paid"); }
export function isRefundedStatus(s: BountyStatusName | string | number): boolean { return isStatus(s, "Refunded"); }

// Parse any on-chain wei-ish value to exact bigint (never Number).
export function parseRewardWei(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    return BigInt(String(v ?? 0));
  } catch {
    return 0n;
  }
}

// Extract reward wei from either a BountyViewModel (rewardWei) or a legacy
// raw contract shape (reward_amount). ViewModel wins; on-chain is authoritative.
export function getRewardWei(b: any): bigint {
  if (!b) return 0n;
  if (b.rewardWei !== undefined && b.rewardWei !== null) {
    try { return BigInt(b.rewardWei); } catch {}
  }
  return parseRewardWei(b.reward_amount ?? b.rewardAmount ?? b?.[2] ?? 0);
}

// Funding validation: entered human amount must equal on-chain reward exactly.
export function validateFundingAmount(enteredHuman: string, onChainRewardWei: bigint | string): { ok: boolean; enteredWei: string; error?: string } {
  let enteredWei: string;
  try {
    enteredWei = humanToWei(enteredHuman);
  } catch (e: any) {
    return { ok: false, enteredWei: "0", error: e?.message || "Please enter a valid amount" };
  }
  const rewardStr = BigInt(onChainRewardWei).toString();
  if (BigInt(enteredWei) <= 0n) return { ok: false, enteredWei, error: "Amount must be greater than 0" };
  if (BigInt(enteredWei) !== BigInt(rewardStr)) {
    return { ok: false, enteredWei, error: `Funding amount must match the bounty reward (${formatRewardWei(BigInt(rewardStr))}).` };
  }
  return { ok: true, enteredWei };
}

export function normalizeAddrLower(a: string | null | undefined): string | null {
  if (!a) return null;
  try {
    const s = String(a).trim().toLowerCase();
    if (!s) return null;
    // Compare zero addresses across representations
    if (s === "0x0" || s === "0" || s === "0x" + "0".repeat(64)) return "0x0";
    // Pad short hex for stable comparison
    if (/^0x[0-9a-f]+$/.test(s)) {
      const hex = s.slice(2).padStart(64, "0");
      return ("0x" + hex).toLowerCase();
    }
    return s;
  } catch {
    return String(a).toLowerCase();
  }
}

export function isZeroAddress(a: string | null | undefined): boolean {
  const n = normalizeAddrLower(a);
  return n === null || n === "0x0" || n === "0x" + "0".repeat(64);
}

// ---- Current-stage permission model (BEFORE private staking) ----
// Creator can never submit to own bounty (enforced on-chain + here for UX).
// Any connected non-creator can submit to an OPEN bounty. Staking/reputation
// are FUTURE eligibility requirements and must NOT gate the form.
export function canSubmitInvestigation(opts: {
  status: BountyStatusName | string | number;
  creator: string | null | undefined;
  connectedAddr: string | null | undefined;
  evidence: string;
}): { ok: boolean; reason: "NOT_OPEN" | "NOT_CONNECTED" | "IS_CREATOR" | "EMPTY_EVIDENCE" | null } {
  if (!isOpenStatus(opts.status)) return { ok: false, reason: "NOT_OPEN" };
  if (!opts.connectedAddr) return { ok: false, reason: "NOT_CONNECTED" };
  const c = normalizeAddrLower(opts.creator);
  const u = normalizeAddrLower(opts.connectedAddr);
  if (c && u && c === u) return { ok: false, reason: "IS_CREATOR" };
  if (!opts.evidence || !opts.evidence.trim()) return { ok: false, reason: "EMPTY_EVIDENCE" };
  return { ok: true, reason: null };
}

export function submitBlockMessage(reason: "NOT_OPEN" | "NOT_CONNECTED" | "IS_CREATOR" | "EMPTY_EVIDENCE" | null): string | null {
  if (reason === "IS_CREATOR") return "You created this bounty. You cannot submit an investigation to it.";
  if (reason === "NOT_CONNECTED") return "Connect your wallet to submit an investigation.";
  return null;
}

// Creator-only actions (fund/open/select-winner/refund/report).
export function isCreator(creator: string | null | undefined, connectedAddr: string | null | undefined): boolean {
  const c = normalizeAddrLower(creator);
  const u = normalizeAddrLower(connectedAddr);
  return !!(c && u && c === u && !isZeroAddress(c));
}

export function getSubmissionStatusName(status: any): string {
  if (!status) return "Pending";
  if (typeof status === "string") return status;
  if (typeof status === "object" && status.variant) {
    const variant = status.variant as Record<string, any>;
    const key = Object.keys(variant).find(k => variant[k] !== undefined);
    return key || "Pending";
  }
  if (typeof status === "object") {
    const keys = Object.keys(status);
    for (const k of keys) if (["Pending","Accepted","Rejected","Reported","Slashed"].includes(k)) return k;
  }
  return String(status);
}
