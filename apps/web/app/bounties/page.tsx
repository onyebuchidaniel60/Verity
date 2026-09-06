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
  "3": { label: "Winner Selected", cls: "badge-winner" },
  "4": { label: "Claimable", cls: "badge-claimable" },
  "5": { label: "Paid", cls: "badge-paid" },
  "6": { label: "Refunded", cls: "badge-refunded" },
  CREATED: { label: "Created", cls: "badge-created" },
  FUNDED: { label: "Funded", cls: "badge-funded" },
  OPEN: { label: "Open", cls: "badge-open" },
  WINNER_SELECTED: { label: "Winner Selected", cls: "badge-winner" },
  CLAIMABLE: { label: "Claimable", cls: "badge-claimable" },
  PAID: { label: "Paid", cls: "badge-paid" },
  REFUNDED: { label: "Refunded", cls: "badge-refunded" },
  // Backwards compat for old Sepolia bounties that used Voting
  "VOTING": { label: "Winner Selected", cls: "badge-winner" },
  "7": { label: "Refunded", cls: "badge-refunded" },
};

function formatReward(v: any): string {
  try {
    const n = BigInt(v ?? 0);
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
    return String(v ?? "—");
  }
}

function shortAddr(a: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function getStoredMeta(id: number) {
  try {
    const raw = localStorage.getItem(`verity_bounty_${id}`);
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
            const meta = getStoredMeta(i);
            const fallbackTitle = feltToTitle(b?.metadata_hash ?? b?.[4]);
            const title = meta?.title || fallbackTitle || `Bounty #${i}`;
            const description = meta?.description || "";
            list.push({ id: i, ...b, _title: title, _description: description, _meta: meta });
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
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Bounties</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>Private bounties, verified outcomes.</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
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
            <div style={{ opacity: 0.8, marginTop: 4 }}>{error}</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Bounties</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {bounties.length} {bounties.length === 1 ? "bounty" : "bounties"} • Private funding, community verified
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
        <div style={{ display: "grid", gap: 14 }}>
          {bounties.map((b) => {
            const statusKey = String(b.status ?? b.bounty_status ?? "CREATED");
            const meta = STATUS_LABEL[statusKey] ?? { label: statusKey, cls: "badge-created" };
            const id = b.id ?? b.bounty_id ?? b[0];
            const title = b._title as string;
            const desc: string = b._description as string;
            const excerpt = desc ? (desc.length > 110 ? desc.slice(0, 110) + "…" : desc) : "Investigation bounty — evidence helps verify the claim.";
            const reward = formatReward(b.reward_amount ?? b.rewardAmount ?? b[2]);
            const creator = String(b.creator ?? b[1] ?? "");
            const createdAt = b.created_at ? new Date(Number(b.created_at) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
            return (
              <Link key={id} href={`/bounty/${id}`} className="card card-pad card-hover" style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text)", letterSpacing: "-0.01em" }}>{reward}</span>
                </div>
                <h3 style={{ fontSize: 15.5, fontWeight: 600, margin: "0 0 6px", lineHeight: 1.35, letterSpacing: "-0.01em" }}>{title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px", lineHeight: 1.55 }}>{excerpt}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-muted)", alignItems: "center" }}>
                    <span>{shortAddr(creator) ? `By ${shortAddr(creator)}` : ""}</span>
                    {createdAt && (
                      <>
                        <span style={{ opacity: 0.4 }}>•</span>
                        <span>{createdAt}</span>
                      </>
                    )}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    View bounty <span aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
