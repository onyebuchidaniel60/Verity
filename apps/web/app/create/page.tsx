"use client";

import { useState } from "react";
import Link from "next/link";
import { Contract } from "starknet";
import { connectWallet, createStrk20Account } from "@/strk20-proof/strk20-proof";
import { CONTRACTS } from "@/lib/contracts";

const NETWORK = "sepolia" as const;

export default function CreateBountyPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ hash: string; id: number | null } | null>(null);

  function humanToWei(s: string): string {
    const trimmed = s.trim().replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Please enter a valid reward amount");
    const [whole, frac = ""] = trimmed.split(".");
    if (frac.length > 18) throw new Error("Too many decimal places (max 18)");
    const frac18 = (frac + "0".repeat(18)).slice(0, 18);
    return BigInt((whole === "" ? "0" : whole) + frac18).toString();
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (!title.trim()) throw new Error("Please add a bounty title");
      if (!reward.trim()) throw new Error("Please set a reward");
      const rewardWei = humanToWei(reward);
      const metadata = title.trim().slice(0, 31) || "Verity Bounty";
      const metadataFelt = "0x" + Buffer.from(metadata).toString("hex").slice(0, 62) || "0x1234";

      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });

      const abi = [
        { name: "create_bounty", type: "function", inputs: [{ name: "reward_amount", type: "core::integer::u128" }, { name: "metadata_hash", type: "core::felt252" }], outputs: [{ name: "bounty_id", type: "core::integer::u64" }], stateMutability: "external" },
        { name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
      ] as const;

      const contract = new Contract({ abi: abi as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await contract.invoke("create_bounty", [rewardWei, metadataFelt]);
      const hash = res.transaction_hash ?? res.hash ?? "";
      let newId: number | null = null;
      try {
        const c2 = new Contract({ abi: [{ name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
        const r: any = await c2.call("get_bounty_count", []);
        newId = Number(r?.count ?? r) || null;
        // Persist full metadata off-chain for display (title, description, reward)
        if (newId) {
          const meta = { title: title.trim(), description: description.trim(), reward, rewardWei, metadataFelt, createdAt: Date.now() };
          try {
            localStorage.setItem(`verity_bounty_${newId}`, JSON.stringify(meta));
            // Also keep an index
            const idxRaw = localStorage.getItem("verity_bounty_index");
            const idx = idxRaw ? JSON.parse(idxRaw) : [];
            if (!idx.includes(newId)) {
              idx.push(newId);
              localStorage.setItem("verity_bounty_index", JSON.stringify(idx));
            }
          } catch {}
        }
      } catch {}
      setSuccess({ hash, id: newId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("USER_REFUSED") || msg.includes("user rejected") || msg.includes("UserRejected")) setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      else if (msg.includes("INSUFFICIENT") || msg.includes("balance")) setError("Insufficient balance to create this bounty. Try a smaller reward or add funds.");
      else if (msg.includes("Validate Unhandled")) setError("We couldn't prepare that reward amount. Please try a different amount.");
      else setError(msg);
      console.error("[create bounty] failed", e);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", padding: "32px 0" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", margin: "0 auto 16px", fontSize: 24, color: "var(--text)" }}>
          ✓
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Your bounty is live</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
          It’s now visible to investigators. Next, fund it privately so the reward can be claimed.
        </p>
        <div className="card card-pad" style={{ textAlign: "left", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Transaction</div>
          <div style={{ fontSize: 12, wordBreak: "break-all", color: "var(--text-secondary)" }}>{success.hash}</div>
          {success.id && <div style={{ marginTop: 8, fontSize: 13 }}>Bounty #{success.id} — <Link href={`/bounty/${success.id}`} className="underline" style={{ color: "var(--accent)" }}>View bounty →</Link></div>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <Link href="/bounties" className="btn btn-secondary">
            Browse bounties
          </Link>
          {success.id && (
            <Link href={`/bounty/${success.id}`} className="btn btn-primary">
              Go to bounty
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto" }}>
      <Link href="/bounties" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        ← Back to bounties
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "16px 0 6px" }}>Create a bounty</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>
        Describe what you need verified. Set a reward and let the community find the truth — funding and payout stay private.
      </p>

      <div className="card card-pad" style={{ display: "grid", gap: 16 }}>
        <div>
          <label className="label">Bounty title *</label>
          <input className="input" placeholder="e.g. Verify the source of this photo" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="help">Be specific — investigators will use this to gather evidence.</div>
        </div>

        <div>
          <label className="label">Details</label>
          <textarea className="textarea" rows={4} placeholder="Add context, links, and what a good submission should include…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className="label">Reward *</label>
          <div style={{ position: "relative" }}>
            <input className="input" placeholder="1.0" value={reward} onChange={(e) => setReward(e.target.value)} style={{ paddingRight: 60 }} />
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>STRK</span>
          </div>
          <div className="help">You’ll fund this after creating. The amount is locked privately until a winner is selected.</div>
        </div>

        <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Summary</div>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Title</span>
              <span style={{ fontWeight: 500 }}>{title || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Reward</span>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{reward || "0"} STRK</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Network</span>
              <span>Sepolia</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error">
            <span>⚠</span>
            <div>
              <strong>Something went wrong</strong>
              <div style={{ opacity: 0.85, marginTop: 4 }}>{error}</div>
            </div>
          </div>
        )}

        <button disabled={busy} onClick={handleCreate} className="btn btn-primary btn-lg" style={{ width: "100%" }}>
          {busy ? "Waiting for wallet…" : "Create bounty"}
        </button>
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", margin: 0 }}>
          Your wallet will open to securely approve this. VERITY never sees your private key.
        </p>
      </div>
    </main>
  );
}
