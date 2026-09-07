// VERITY bounty pure logic — chain I/O free (no Contract/RpcProvider imports)
// so it can be unit-tested with Node's built-in runner (`node --test`)
// without a bundler. apps/web/lib/bounty.ts re-exports everything here and
// adds loadBounty/loadBounties.
//
// NOTE: this module imports only the dependency-free `hash` utilities from
// starknet (Poseidon + felt math), which Node resolves as a package.

import { hash } from "starknet";

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
  // Private creator identity: commitment felt (decimal/hex string) or null
  // when unset/legacy. Payout recipient address or null when unset.
  creatorAlias: string | null;
  payoutAddress: string | null;
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

const HEX_FELT_RE = /^0x[0-9a-fA-F]+$/;

/** Canonical 0x-hex felt for wallet calldata.
 *  Accepts decimal or 0x-hex input (BigInt-exact, never Number) and validates
 *  the felt range. Ready X validates invoke calldata as ^0x hex felts and
 *  rejects decimal strings with INVALID_REQUEST_PAYLOAD. */
export function hexFelt(v: bigint | string | number): string {
  const n = typeof v === "bigint" ? v : BigInt(String(v).trim());
  if (n < 0n || n >= STARK_PRIME) throw new Error("Value out of felt range");
  return "0x" + n.toString(16);
}

/** "0x1" / "0x0" for Cairo bools in wallet calldata (never true/false). */
export function boolToFelt(b: boolean): string {
  return b ? "0x1" : "0x0";
}

/** Normalize + validate a contract address override (env-provided values can
 *  carry whitespace or malformed text that the wallet rejects with
 *  INVALID_REQUEST_PAYLOAD). Trims, requires 0x-hex, felt range, non-zero.
 *  Returns the trimmed address unchanged (leading zeros preserved) so logs
 *  stay comparable with deployment records. */
export function normalizeContractAddress(addr: unknown, label: string): string {
  const s = String(addr ?? "").trim();
  if (!HEX_FELT_RE.test(s)) throw new Error(`${label}: invalid contract address ${JSON.stringify(s)} (expected 0x-hex felt)`);
  const n = BigInt(s);
  if (n <= 0n || n >= STARK_PRIME) throw new Error(`${label}: contract address out of felt range`);
  return s;
}

// ---- Public-invoke transport (wallet_addInvokeTransaction) ----------------
// starknet.js Contract.invoke compiles calldata to DECIMAL strings, which
// Ready X rejects with INVALID_REQUEST_PAYLOAD (code 114). Every public
// (non-STRK20) write must therefore go through buildInvokeCall +
// account.execute([call]): BigInt-exact 0x-hex felts, validated before the
// wallet ever sees them. Reads (Contract.call) are unaffected.

/** starknet.js-shaped call: { contractAddress, entrypoint, calldata }. */
export interface InvokeCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/** Wallet-shaped params preview: { calls: [{ contract_address,
 *  entry_point, calldata }] } — byte-identical to what WalletAccountV5/V6
 *  .execute sends to wallet_addInvokeTransaction (see starknet@10.5.0
 *  WalletAccount execute: [].concat(calls) map contractAddress->contract_address,
 *  entrypoint->entry_point, calldata passthrough). Used for exact pre-submit
 *  logging so the browser request can be compared 1:1 against this schema. */
export function toWalletInvokeParams(call: InvokeCall): {
  calls: Array<{ contract_address: string; entry_point: string; calldata: string[] }>;
} {
  return {
    calls: [{
      contract_address: call.contractAddress,
      entry_point: call.entrypoint,
      calldata: [...call.calldata],
    }],
  };
}

/** Build a pre-validated public-invoke call. Accepts felt-ish values
 *  (decimal/hex/bigint/number) plus booleans for Cairo bools; every element
 *  is normalized to minimal 0x-hex and range-checked. Throws a precise error
 *  naming the offending index BEFORE anything reaches the wallet. */
export function buildInvokeCall(
  contractAddress: string,
  entrypoint: string,
  args: Array<bigint | string | number | boolean>,
): InvokeCall {
  if (!entrypoint || !entrypoint.trim()) throw new Error("buildInvokeCall: empty entrypoint");
  const calldata = args.map((a, i) => {
    try {
      return typeof a === "boolean" ? boolToFelt(a) : hexFelt(a as bigint | string | number);
    } catch (e: any) {
      throw new Error(`buildInvokeCall(${entrypoint}): arg[${i}] invalid (${e instanceof Error ? e.message : String(e)})`);
    }
  });
  for (const el of calldata) {
    if (!HEX_FELT_RE.test(el)) throw new Error(`buildInvokeCall(${entrypoint}): invalid wallet calldata felt: ${el}`);
  }
  return { contractAddress, entrypoint: entrypoint.trim(), calldata };
}

/** Hex calldata for BountyManager.create_bounty(reward u128, metadata felt).
 *  starknet.js CallData.compile emits DECIMAL strings, which Ready X rejects
 *  with INVALID_REQUEST_PAYLOAD — so the create flow bypasses Contract.invoke
 *  and sends this pre-built, schema-validated hex array via account.execute
 *  (normal wallet_addInvokeTransaction path, NOT the STRK20 privacy API).
 *  Values are BigInt-exact: 10 STRK -> 0x8ac7230489e80000, never Number/1e18. */
export function buildCreateBountyCalldata(rewardWei: string, metadataFelt: string): [string, string] {
  const out = [hexFelt(rewardWei), hexFelt(metadataFelt)] as [string, string];
  for (const el of out) {
    if (!HEX_FELT_RE.test(el)) throw new Error(`Invalid wallet calldata felt: ${el}`);
  }
  return out;
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
    const s = String(a).trim();
    if (!s) return null;
    // Canonicalize ANY felt representation — 0x-hex (any case/padding) OR
    // decimal (this is what starknet.js returns for ContractAddress fields:
    // e.g. creator "38919134...") — via BigInt to 0x + 64 hex lowercase.
    // A naive 0x-only comparison NEVER matches on-chain decimal strings,
    // which misclassifies the creator as a non-creator.
    const hex = BigInt(s).toString(16).padStart(64, "0");
    if (hex === "0".repeat(64)) return "0x0";
    return ("0x" + hex).toLowerCase();
  } catch {
    try {
      const f = String(a).trim().toLowerCase();
      return f || null;
    } catch {
      return null;
    }
  }
}

/** Canonical 0x-hex display for any felt (decimal or hex). Null when unparseable. */
export function toHexAddress(a: string | null | undefined): string | null {
  const n = normalizeAddrLower(a);
  if (!n || n === "0x0") return n;
  return n;
}

// Single source of truth for the status badge: derived STRICTLY from the
// canonical chain status name. CREATED can never render "Funded" here —
export function statusMeta(s: BountyStatusName | string | number): { label: string; cls: string; desc: string } {
  switch (getStatusName(s as any)) {
    case "Created": return { label: "Created", cls: "badge-created", desc: "Awaiting funding" };
    case "Funded": return { label: "Funded", cls: "badge-funded", desc: "Ready to open" };
    case "Open": return { label: "Open", cls: "badge-open", desc: "Accepting investigations" };
    case "WinnerSelected": return { label: "Winner Selected", cls: "badge-winner", desc: "Winner chosen" };
    case "Claimable": return { label: "Claimable", cls: "badge-claimable", desc: "Ready to release" };
    case "Paid": return { label: "Paid", cls: "badge-paid", desc: "Completed" };
    case "Refunded": return { label: "Refunded", cls: "badge-refunded", desc: "Refunded" };
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

export function getSubmissionStatusName(status: any): string {  if (!status && status !== 0) return "Pending";
  if (typeof status === "string" || typeof status === "number" || typeof status === "bigint") {
    const t = String(status).trim().toLowerCase();
    const map: Record<string, string> = {
      "0": "Pending", pending: "Pending",
      "1": "Accepted", accepted: "Accepted",
      "2": "Rejected", rejected: "Rejected",
      "3": "Reported", reported: "Reported",
      "4": "Slashed", slashed: "Slashed",
    };
    if (map[t]) return map[t];
    return String(status);
  }
  if (typeof status === "object" && status.variant) {
    const variant = status.variant as Record<string, any>;
    const key = Object.keys(variant).find(k => variant[k] !== undefined);
    if (key) {
      const t = key.trim().toLowerCase();
      const map: Record<string, string> = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", reported: "Reported", slashed: "Slashed" };
      return map[t] || key;
    }
    return "Pending";
  }
  if (typeof status === "object") {
    const keys = Object.keys(status);
    for (const k of keys) if (["Pending","Accepted","Rejected","Reported","Slashed"].includes(k)) return k;
    for (const k of keys) {
      const t = k.trim().toLowerCase();
      const map: Record<string, string> = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", reported: "Reported", slashed: "Slashed" };
      if (map[t]) return map[t];
    }
  }
  return String(status);
}

// ---- Phase 3 funding secrets (secret-bound FUND/REFUND/RELEASE) ----
// Secrets are random felts generated client-side at creation. Only their
// Poseidon locks go on-chain (via set_locks / register_payout_lock).
// Plaintexts live ONLY in the creator/winner device storage + a one-time UI
// backup. NEVER log secrets — diagnostics must carry hashes/flags only.
const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = BigInt("0x" + Buffer.from(bytes).toString("hex")) % STARK_PRIME;
  if (v === 0n) v = 1n;
  return "0x" + v.toString(16);
}

/** Poseidon lock matching the helper's `poseidon_hash_span([secret])`
 *  (parity proven by snforge `test_poseidon_lock_parity_with_starknet_js`
 *  and the lock-vector tests below against the same constants). */
export function computeLock(secret: string): string {
  const h = hash.computePoseidonHashOnElements([secret]);
  return "0x" + BigInt(h).toString(16);
}

export interface BountySecrets {
  fund_secret: string;
  refund_secret: string;
}

function secretsKey(id: number): string {
  return `verity_secrets_${id}`;
}

function payoutSecretKey(id: number): string {
  return `verity_payout_secret_${id}`;
}

export function saveBountySecrets(id: number, s: BountySecrets): void {
  try {
    localStorage.setItem(secretsKey(id), JSON.stringify(s));
  } catch {}
}

export function getBountySecrets(id: number): BountySecrets | null {
  try {
    const raw = localStorage.getItem(secretsKey(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.fund_secret === "string" && typeof p?.refund_secret === "string") return p;
    return null;
  } catch {
    return null;
  }
}

export function savePayoutSecret(id: number, secret: string): void {
  try {
    localStorage.setItem(payoutSecretKey(id), JSON.stringify({ payout_secret: secret }));
  } catch {}
}

export function getPayoutSecret(id: number): string | null {
  try {
    const raw = localStorage.getItem(payoutSecretKey(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return typeof p?.payout_secret === "string" ? p.payout_secret : null;
  } catch {
    return null;
  }
}
