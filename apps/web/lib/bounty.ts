import { Contract, RpcProvider } from "starknet";
import { CONTRACTS } from "./contracts";
import {
  BountyViewModel,
  formatRewardWei,
  getStatusName,
} from "./bounty-pure";

// Re-export pure logic so existing `@/lib/bounty` imports keep working.
export * from "./bounty-pure";

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
      // On-chain reward is authoritative: detect local metadata mismatch, never display local value.
      if (meta?.rewardWei !== undefined) {
        try {
          if (BigInt(meta.rewardWei).toString() !== rewardWei.toString()) {
            console.warn(`[bounty ${idNum}] metadata reward mismatch: local ${meta.rewardWei} != on-chain ${rewardWei.toString()} — displaying on-chain value`);
          }
        } catch {}
      }
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
