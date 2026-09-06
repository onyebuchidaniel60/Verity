"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Contract } from "starknet";
import { createProvider } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";

// Minimal ABI for reading bounties — we will fetch via provider
const BOUNTY_ABI = [
  {
    name: "get_bounty_count",
    type: "function",
    inputs: [],
    outputs: [{ name: "count", type: "u64" }],
    stateMutability: "view",
  },
  {
    name: "get_bounty",
    type: "function",
    inputs: [{ name: "bounty_id", type: "u64" }],
    outputs: [{ name: "bounty", type: "Bounty" }],
    stateMutability: "view",
  },
] as const;

export default function BountiesPage() {
  const [bounties, setBounties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!CONTRACTS.bountyManager) {
        setError("BountyManager not configured");
        setLoading(false);
        return;
      }
      try {
        const provider = createProvider("sepolia");
        // Use raw call via provider to avoid ABI parsing issues — directly call contract
        const contract = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const countRes: any = await contract.call("get_bounty_count", []);
        const count = Number(countRes?.count ?? countRes ?? 0);
        const list: any[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const b: any = await contract.call("get_bounty", [i]);
            // Handle both direct return and wrapped
            const bounty = b?.bounty ?? b;
            list.push({ id: i, ...bounty });
          } catch {}
        }
        setBounties(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <main className="p-6">Loading bounties…</main>;
  if (error) return <main className="p-6 text-red-600">Error: {error}</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Bounties</h1>
      <Link href="/create" className="mt-2 inline-block rounded bg-black px-3 py-1 text-white">
        Create Bounty
      </Link>
      {bounties.length === 0 ? (
        <p className="mt-4">No bounties yet. Create the first one.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {bounties.map((b) => (
            <li key={b.id ?? b.bounty_id} className="rounded border p-3">
              <div>
                <b>#{b.id ?? b.bounty_id}</b> — {String(b.status ?? b.bounty_status ?? "CREATED")} — reward{" "}
                {String(b.reward_amount ?? b.rewardAmount ?? "?")} STRK (wei)
              </div>
              <div className="text-xs opacity-70">creator: {String(b.creator ?? "")}</div>
              <Link href={`/bounty/${b.id ?? b.bounty_id}`} className="text-sm underline">
                View →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
