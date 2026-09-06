import Link from "next/link";

export default function Home() {
  return (
    <div className="animate-in">
      <section className="hero">
        <h1>
          Private bounties.
          <br />
          Anonymous truth.
        </h1>
        <p>
          Fund investigations privately and reward the best findings. Investigators build reputation without revealing who they are — creators choose the winner, payouts stay private.
        </p>
        <div className="hero-actions">
          <Link href="/create" className="btn btn-primary btn-lg">
            Create a bounty →
          </Link>
          <Link href="/bounties" className="btn btn-secondary btn-lg">
            Explore bounties
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <div className="card card-pad">
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>How VERITY works</h2>
          <div className="steps">
            <div className="step">
              <div className="step-icon">◈</div>
              <h3>Create</h3>
              <p>Describe your question and set a reward</p>
            </div>
            <div className="step">
              <div className="step-icon">◎</div>
              <h3>Fund</h3>
              <p>Reward locked privately via STRK20</p>
            </div>
            <div className="step">
              <div className="step-icon">⬡</div>
              <h3>Investigate</h3>
              <p>Anonymous investigators submit findings</p>
            </div>
            <div className="step">
              <div className="step-icon">⬢</div>
              <h3>Review</h3>
              <p>Creator reviews and selects the winner</p>
            </div>
            <div className="step">
              <div className="step-icon">✦</div>
              <h3>Reward</h3>
              <p>Winner paid privately</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Private funding</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Rewards move through the STRK20 privacy pool. Who you fund and how much stays private inside the pool — not on a public market.
          </p>
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Reputation without identity</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Investigators stake and build reputation anonymously. A threshold keeps spam low — good work is rewarded, bad work is slashed.
          </p>
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Creator-controlled</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            You decide what wins. Review investigations with anonymous profiles and reputation, then release the reward privately to the chosen investigator.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 32, textAlign: "center" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Ready to get started?</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>Create a bounty or build reputation as an anonymous investigator.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/bounties" className="btn btn-primary">
            Browse bounties
          </Link>
          <Link href="/create" className="btn btn-secondary">
            Create bounty
          </Link>
        </div>
      </section>
    </div>
  );
}
