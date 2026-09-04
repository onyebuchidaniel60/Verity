import type { Metadata } from "next";
import ConnectWallet from "@/components/ConnectWallet";
import { STRK20 } from "@/lib/strk20";
import { VERITY_NETWORKS } from "@/lib/starknet";
import { BOUNTY_LIFECYCLE, VERIFIER_SET_SIZE, WINNER_THRESHOLD } from "@/lib/bounty";

export const metadata: Metadata = {
  title: "VERITY — Private Bounty & Truth Marketplace",
  description:
    "A private bounty & truth marketplace on Starknet, powered by genuine STRK20 privacy.",
};

export default function Home() {
  return (
    <main className="verity-shell">
      <section className="verity-hero">
        <h1>VERITY</h1>
        <p className="verity-tagline">A private market for verified intelligence.</p>
        <ConnectWallet />
      </section>

      <section className="verity-status">
        <h2>Phase 0 — Foundation</h2>
        <p>
          This shell establishes wallet connection and Starknet / STRK20
          configuration only. Bounty creation, private funding, evidence
          submission, verifier voting and private payouts are built in later
          phases — each gated on real on-chain STRK20 evidence, never on
          compilation alone.
        </p>
        <p>
          Canonical bounty lifecycle: <code>{BOUNTY_LIFECYCLE.join(" → ")}</code>.
          Verifier set: <strong>{VERIFIER_SET_SIZE}</strong> verifiers, winner
          threshold <strong>{WINNER_THRESHOLD} / {VERIFIER_SET_SIZE}</strong>.
        </p>
      </section>

      <section className="verity-networks">
        <h2>Configured networks</h2>
        <ul>
          {Object.values(VERITY_NETWORKS).map((n) => (
            <li key={n.id}>
              <strong>{n.name}</strong> · <code>{n.chainId}</code> · <code>{n.rpcUrl}</code>
            </li>
          ))}
        </ul>

        <h2>STRK20 privacy pool</h2>
        <ul>
          {Object.values(STRK20).map((cfg) => (
            <li key={cfg.network}>
              <strong>{cfg.network}</strong> · <code>{cfg.poolAddress}</code>
            </li>
          ))}
        </ul>
        <p>
          Correctness of these addresses was verified against the official STRK20
          resources on 2026-09-03 — see{" "}
          <code>docs/STRK20_INTEGRATION.md</code>.
        </p>
      </section>

      <section className="verity-privacy-note">
        <h2>Honest privacy note</h2>
        <p>
          STRK20 keeps in-pool sender, recipient and amount relationships
          private. Deposits and withdrawals are public legs, STRK20 pool
          interaction is observable, and VERITY bounty state is public by
          design. VERITY will never describe a public ERC-20 transfer as
          private funding or a private payout. Full model:{" "}
          <code>docs/PRIVACY_MODEL.md</code>.
        </p>
      </section>
    </main>
  );
}