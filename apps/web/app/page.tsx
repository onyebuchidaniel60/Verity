import Link from "next/link";

export default function Home() {
  return (
    <div className="animate-in">
      <section className="hero">
        <h1>
          Private payments.
          <br />
          Transparent truth.
        </h1>
        <p>
          Create bounties for investigations and research. Fund them privately and reward the best evidence — verified by the
          community, paid in private.
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
              <p>Deposit securely — in-pool movement stays private</p>
            </div>
            <div className="step">
              <div className="step-icon">⬡</div>
              <h3>Submit</h3>
              <p>Investigators share evidence</p>
            </div>
            <div className="step">
              <div className="step-icon">⬢</div>
              <h3>Vote</h3>
              <p>13 verifiers review, 7 needed to decide</p>
            </div>
            <div className="step">
              <div className="step-icon">✦</div>
              <h3>Reward</h3>
              <p>Winner claims privately</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Private funding</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Your deposit and payout move through the STRK20 privacy pool. Who you pay and how much stays private inside the
            pool.
          </p>
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Transparent progress</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Bounty status, submissions, and votes are public and auditable. You always know where things stand.
          </p>
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Community verified</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Trusted verifiers review evidence. A submission needs 7 of 13 votes to win — no single party decides.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 32, textAlign: "center" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Ready to get started?</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>Connect your wallet to create and fund bounties securely.</p>
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
