"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Contract } from "starknet";
import { createProvider } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  "0": { label: "Created", cls: "badge-created" },
  "1": { label: "Funded", cls: "badge-funded" },
  "2": { label: "Open", cls: "badge-open" },
  "3": { label: "Voting", cls: "badge-voting" },
  "4": { label: "Winner Selected", cls: "badge-winner" },
  "5": { label: "Claimable", cls: "badge-claimable" },
  "6": { label: "Paid", cls: "badge-paid" },
  "7": { label: "Refunded", cls: "badge-refunded" },
  CREATED: { label: "Created", cls: "badge-created" },
  FUNDED: { label: "Funded", cls: "badge-funded" },
  OPEN: { label: "Open", cls: "badge-open" },
  VOTING: { label: "Voting", cls: "badge-voting" },
  WINNER_SELECTED: { label: "Winner Selected", cls: "badge-winner" },
  CLAIMABLE: { label: "Claimable", cls: "badge-claimable" },
  PAID: { label: "Paid", cls: "badge-paid" },
  REFUNDED: { label: "Refunded", cls: "badge-refunded" },
};

function formatReward(v: any) {
  try {
    const n = BigInt(v ?? 0);
    // Show as STRK if large (wei), otherwise raw
    if (n >= 1000000000000000000n) return `${(Number(n) / 1e18).toFixed(2)} STRK`;
    return `${n.toString()} wei`;
  } catch {
    return String(v ?? "—");
  }
}

export default function BountiesPage() {
  const [bounties, setBounties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!CONTRACTS.bountyManager) {
        setError("Bounty system is initializing.");
        setLoading(false);
        return;
      }
      try {
        const provider = createProvider("sepolia");
        const abi = [
          { name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
          { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" },
        ] as const;
        const c = new Contract({ abi: abi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const countRes: any = await c.call("get_bounty_count", []);
        const count = Number(countRes?.count ?? countRes ?? 0);
        const list: any[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const r: any = await c.call("get_bounty", [i]);
            const b = r?.bounty ?? r;
            list.push({ id: i, ...b });
          } catch {}
        }
        setBounties(list.reverse());
      } catch (e) {
        setError("We couldn't load bounties right now. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <main>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bounties</h1>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card card-pad">
              <div className="skeleton skeleton-line medium" style={{ width: "30%" }} />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main>
        <div className="alert alert-error">
          <span>⚠</span>
          <div>
            <strong>We couldn’t load bounties</strong>
            <div style={{ opacity: 0.8, marginTop: 4 }}>{error} — please check your connection and try again.</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bounties</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Discover investigations and reward verified answers.
          </p>
        </div>
        <Link href="/create" className="btn btn-primary">
          + Create bounty
        </Link>
      </div>

      {bounties.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">◈</div>
          <h3>No bounties yet</h3>
          <p>Be the first to create one. Set a reward and let the community find the truth.</p>
          <Link href="/create" className="btn btn-primary">
            Create bounty
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {bounties.map((b) => {
            const statusKey = String(b.status ?? b.bounty_status ?? "CREATED");
            const meta = STATUS_LABEL[statusKey] ?? { label: statusKey, cls: "badge-created" };
            const id = b.id ?? b.bounty_id ?? b[0];
            return (
              <Link key={id} href={`/bounty/${id}`} className="card card-pad card-hover" style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{formatReward(b.reward_amount ?? b.rewardAmount ?? b[2])}</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px", lineHeight: 1.4 }}>Bounty #{id}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.5 }}>
                  {b.metadata_hash ? `Evidence ref: ${String(b.metadata_hash).slice(0, 24)}…` : "Investigation bounty — evidence required"}
                </p>
                <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>Created {b.created_at ? new Date(Number(b.created_at) * 1000).toLocaleDateString() : ""}</span>
                  <span>•</span>
                  <span style={{ color: "var(--accent)" }}>View →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
