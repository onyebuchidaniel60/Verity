import type { Metadata } from "next";
import Link from "next/link";
import ConnectWallet from "@/components/ConnectWallet";
import { STRK20 } from "@/lib/strk20";
import { VERITY_NETWORKS } from "@/lib/starknet";
import { BOUNTY_LIFECYCLE, VERIFIER_SET_SIZE, WINNER_THRESHOLD } from "@/lib/bounty";
import { CONTRACTS } from "@/lib/contracts";

export const metadata: Metadata = {
  title: "VERITY — Private Bounty & Truth Marketplace",
  description: "A private bounty & truth marketplace on Starknet, powered by genuine STRK20 privacy.",
};

export default function Home() {
  return (
    <main className="verity-shell">
      <section className="verity-hero">
        <h1>VERITY</h1>
        <p className="verity-tagline">A private market for verified intelligence.</p>
        <ConnectWallet />
        <div className="mt-4 flex gap-2">
          <Link href="/bounties" className="rounded bg-black px-4 py-2 text-white">
            Browse Bounties
          </Link>
          <Link href="/create" className="rounded border px-4 py-2">
            Create Bounty
          </Link>
          <Link href="/phase1-proof" className="rounded border px-4 py-2">
            Phase 1 Proof
          </Link>
        </div>
      </section>

      <section className="verity-status">
        <h2>Live on Sepolia</h2>
        <p>
          BountyManager: <code className="break-all">{CONTRACTS.bountyManager}</code>
          <br />
          VerityAnonymizer: <code className="break-all">{CONTRACTS.verityAnonymizer}</code>
          <br />
          Pool: <code>{STRK20.sepolia.poolAddress}</code> (Sepolia)
        </p>
        <p>
          Lifecycle: <code>{BOUNTY_LIFECYCLE.join(" → ")}</code>. Verifiers: <strong>{VERIFIER_SET_SIZE}</strong>, threshold{" "}
          <strong>{WINNER_THRESHOLD} / {VERIFIER_SET_SIZE}</strong>.
        </p>
      </section>

      <section className="verity-networks">
        <h2>Networks</h2>
        <ul>
          {Object.values(VERITY_NETWORKS).map((n) => (
            <li key={n.id}>
              <strong>{n.name}</strong> · <code>{n.chainId}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="verity-privacy-note">
        <h2>Privacy</h2>
        <p>
          Funding and payout move through the real STRK20 pool (`privacy_invoke` → `VerityAnonymizer` → `BountyManager`). In-pool
          sender/amount are private; deposits, pool interaction, and bounty state are public. See{" "}
          <code>docs/PRIVACY_MODEL.md</code>.
        </p>
      </section>
    </main>
  );
}
