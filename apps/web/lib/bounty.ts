import { Contract, RpcProvider } from "starknet";
import { createProvider } from "./starknet";
import { CONTRACTS } from "./contracts";

// Shared authoritative bounty model — chain is source of truth, BigInt exact, no Number.
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
export function getStatusName(status: any): BountyStatusName {
  if (!status) return "Created";
  if (typeof status === "string") {
    // Handle both "Created" and "0" etc.
    if (["Created","Funded","Open","WinnerSelected","Claimable","Paid","Refunded"].includes(status)) return status as BountyStatusName;
    const map: Record<string, BountyStatusName> = { "0":"Created","1":"Funded","2":"Open","3":"WinnerSelected","4":"Claimable","5":"Paid","6":"Refunded" };
    return map[status] || "Created";
  }
  if (typeof status === "number" || typeof status === "bigint") {
    const map: Record<string, BountyStatusName> = { "0":"Created","1":"Funded","2":"Open","3":"WinnerSelected","4":"Claimable","5":"Paid","6":"Refunded" };
    return map[String(status)] || "Created";
  }
  // CairoCustomEnum { variant: {Created: {}, Funded: undefined, ...} }
  if (typeof status === "object" && status.variant) {
    const variant = status.variant as Record<string, any>;
    const key = Object.keys(variant).find(k => variant[k] !== undefined);
    if (key && ["Created","Funded","Open","WinnerSelected","Claimable","Paid","Refunded"].includes(key)) return key as BountyStatusName;
  }
  // Fallback for starknet.js enum that may be like { Created: null } directly
  if (typeof status === "object") {
    const keys = Object.keys(status);
    for (const k of keys) {
      if (["Created","Funded","Open","WinnerSelected","Claimable","Paid","Refunded"].includes(k)) return k as BountyStatusName;
    }
    // Try to find active variant where value is {} or not undefined
    for (const k of keys) {
      if ((status as any)[k] !== undefined) return k as BountyStatusName;
    }
  }
  return "Created";
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

// Load a single bounty authoritative from chain + optional localStorage title/desc
export async function loadBounty(provider: RpcProvider, id: number): Promise<BountyViewModel> {
  let fullAbi: any = null;
  try {
    const cls: any = await provider.getClassAt(CONTRACTS.bountyManager!);
    fullAbi = cls.abi;
  } catch {}
  const fallbackAbi = [
    { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ type: "bounty_manager::types::Bounty" }], stateMutability: "view" },
  ] as const;
  const c = new Contract({ abi: (fullAbi || fallbackAbi) as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
  const r: any = await c.call("get_bounty", [id]);
  const bRaw = r;
  const b = Array.isArray(bRaw) ? { id: bRaw[0], creator: bRaw[1], reward_amount: bRaw[2], status: bRaw[3], metadata_hash: bRaw[4], created_at: bRaw[5], funded_amount: bRaw[6], winner: bRaw[7], winning_submission: bRaw[8] } : bRaw;
  // Also handle case where b is already the struct (with named fields) — it will have id, creator, etc.
  const idNum = Number(b.id ?? id);
  const creator = String(b.creator ?? b[1] ?? "0x0");
  const rewardWei = BigInt(b.reward_amount ?? b[2] ?? 0);
  const status = getStatusName(b.status ?? b[3]);
  const metadataHash = String(b.metadata_hash ?? b[4] ?? "0x0");
  const createdAt = Number(b.created_at ?? b[5] ?? 0);
  const fundedAmountWei = BigInt(b.funded_amount ?? b[6] ?? 0);
  const winnerRaw = b.winner ?? b[7] ?? "0x0";
  const winner = String(winnerRaw) === "0x0" || String(winnerRaw) === "0" ? null : String(winnerRaw);
  const winningSubmission = b.winning_submission !== undefined && b.winning_submission !== null ? Number(b.winning_submission) : (b[8] !== undefined ? Number(b[8]) : null);
  // Title/description from localStorage (presentation only, not authoritative for reward/status)
  let title = `Bounty #${idNum}`;
  let description = "";
  try {
    const raw = localStorage.getItem(`verity_bounty_${idNum}`);
    if (raw) {
      const meta = JSON.parse(raw);
      if (meta?.title) title = meta.title;
      if (meta?.description) description = meta.description;
    }
  } catch {}
  if (title === `Bounty #${idNum}`) {
    try {
      const hex = BigInt(metadataHash).toString(16);
      const padded = hex.padStart(62, "0");
      const buf = Buffer.from(padded, "hex");
      const str = buf.toString("utf-8").replace(/\0/g, "").trim();
      if (str && /^[\x20-\x7E ]+$/.test(str)) title = str;
    } catch {}
  }
  if (!description) description = "Investigation bounty — evidence helps verify the claim.";
  return {
    id: idNum,
    creator,
    rewardWei,
    rewardStr: formatRewardWei(rewardWei),
    status,
    metadataHash,
    createdAt,
    fundedAmountWei,
    winner,
    winningSubmission,
    title,
    description,
  };
}

export async function loadBounties(provider: RpcProvider): Promise<BountyViewModel[]> {
  let fullAbi: any = null;
  try {
    const cls: any = await provider.getClassAt(CONTRACTS.bountyManager!);
    fullAbi = cls.abi;
  } catch {}
  const fallbackAbi = [
    { name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
    { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ type: "bounty_manager::types::Bounty" }], stateMutability: "view" },
  ] as const;
  const c = new Contract({ abi: (fullAbi || fallbackAbi) as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
  const countRes: any = await c.call("get_bounty_count", []);
  const count = Number(countRes?.count ?? countRes ?? 0);
  const list: BountyViewModel[] = [];
  for (let i = 1; i <= count; i++) {
    try {
      const vm = await loadBounty(provider, i);
      list.push(vm);
    } catch {}
  }
  return list.reverse();
}
