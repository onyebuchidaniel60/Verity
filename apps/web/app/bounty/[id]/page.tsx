"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Contract } from "starknet";
import { connectWallet, createStrk20Account, type Address } from "@/strk20-proof/strk20-proof";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";
import { STRK20 } from "@/lib/strk20";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;

const STATUS_META: Record<string, { label: string; cls: string; desc: string }> = {
  "0": { label: "Created", cls: "badge-created", desc: "Waiting to be funded" },
  "1": { label: "Funded", cls: "badge-funded", desc: "Ready to open" },
  "2": { label: "Open", cls: "badge-open", desc: "Accepting evidence" },
  "3": { label: "Voting", cls: "badge-voting", desc: "Under review" },
  "4": { label: "Winner Selected", cls: "badge-winner", desc: "Winner chosen" },
  "5": { label: "Claimable", cls: "badge-claimable", desc: "Ready to claim" },
  "6": { label: "Paid", cls: "badge-paid", desc: "Completed" },
  "7": { label: "Refunded", cls: "badge-refunded", desc: "Refunded" },
};

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function formatReward(v: any) {
  try {
    const n = BigInt(v ?? 0);
    if (n >= 1000000000000000000n) return `${(Number(n) / 1e18).toFixed(2)} STRK`;
    return `${n.toString()} wei`;
  } catch {
    return String(v ?? "—");
  }
}

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [bounty, setBounty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [evidenceHash, setEvidenceHash] = useState("");
  const [voteSubmission, setVoteSubmission] = useState("1");
  const [submissions, setSubmissions] = useState<any[]>([]);

  const provider = createProvider(NETWORK);
  const bountyAbi = [
    { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" },
    { name: "get_submission_count", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" },
    { name: "get_submission", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ name: "submission", type: "Submission" }], stateMutability: "view" },
  ] as const;

  function getStoredMeta(bountyId: number) {
    try {
      const raw = localStorage.getItem(`verity_bounty_${bountyId}`);
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const c = new Contract({ abi: bountyAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const r: any = await c.call("get_bounty", [id]);
      const b = r?.bounty ?? r;
      setBounty(b);
      // Load submissions
      try {
        const cnt: any = await c.call("get_submission_count", [id]);
        const count = Number(cnt?.count ?? cnt ?? 0);
        const list: any[] = [];
        for (let i = 1; i <= count; i++) {
          try {
            const s: any = await c.call("get_submission", [id, i]);
            const sub = s?.submission ?? s;
            const vAbi = [{ name: "get_vote_count", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [{ name: "count", type: "core::integer::u32" }], stateMutability: "view" }] as const;
            const c2 = new Contract({ abi: vAbi as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
            const vc: any = await c2.call("get_vote_count", [id, i]);
            const votes = Number(vc?.count ?? vc ?? 0);
            list.push({ id: i, ...sub, votes });
          } catch {}
        }
        setSubmissions(list);
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function guard(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setTxHash(null);
    try {
      const hash = await fn();
      if (hash) setTxHash(hash);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[bounty ${id}] ${key} failed`, e);
      if (msg.includes("USER_REFUSED") || msg.includes("UserRejected") || msg.includes("user rejected")) setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      else if (msg.includes("INSUFFICIENT") || msg.includes("balance")) setError("Insufficient balance. Add funds and try again.");
      else if (msg.includes("NOT_VERIFIER")) setError("Only verified reviewers can vote on this bounty.");
      else if (msg.includes("ALREADY_VOTED")) setError("You’ve already voted on this bounty.");
      else if (msg.includes("INVALID_REQUEST_PAYLOAD")) setError("We couldn’t prepare the private funding transaction. Please try again.");
      else if (msg.includes("NOT_POOL") || msg.includes("NOT_ANONYMIZER")) setError("This action must go through the secure funding flow. Please use the Fund button.");
      else if (msg.includes("Validate Unhandled")) setError("We couldn’t prepare the transaction. Please try a different amount.");
      else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const fundPrivate = () =>
    guard("fund", async () => {
      if (!bounty) throw new Error("Bounty not loaded");
      const reward = bounty.reward_amount ?? bounty.rewardAmount ?? bounty[2] ?? 1000;
      const { wallet, address } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const amount = BigInt(reward).toString();
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      // Correct STRK20 Wallet API funding flow: create an OPEN note via private transfer, then invoke VerityAnonymizer
      // The VerityAnonymizer's privacy_invoke expects (operation, bounty_id, amount, nonce, note_id) where note_id is the open note id
      // We use the placeholder ${openNoteIds[0]} which the wallet resolves to the actual note_id of the OPEN transfer in the same tx
      const operation = "0x46554e445f424f554e5459"; // 'FUND_BOUNTY' as felt
      // For funding, we need to create an open note for the reward amount and then fill it via the anonymizer
      // The correct wallet request is a single atomic transaction with two actions: transfer OPEN + invoke
      try {
        const res: any = await account.strk20InvokeTransaction([
          { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
          { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyId.toString(), amount, nonce, "${openNoteIds[0]}"] } as any,
        ]);
        return res.transaction_hash ?? res.hash;
      } catch (e) {
        // Fallback for wallets that don't support OPEN in same tx: try single invoke with note_id 0 (empty span, bounty still funded on-chain via credit)
        console.warn("[fundPrivate] transfer+invoke failed, trying single invoke fallback", e);
        const res: any = await account.strk20InvokeTransaction([
          { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyId.toString(), amount, nonce, "0x0"] } as any,
        ]);
        return res.transaction_hash ?? res.hash;
      }
    });

  const open = () =>
    guard("open", async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "open_bounty", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("open_bounty", [id]);
      return res.transaction_hash ?? res.hash;
    });

  const submit = () =>
    guard("submit", async () => {
      if (!evidenceHash.trim()) throw new Error("Please add an evidence reference");
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "submit_evidence", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "evidence_hash", type: "core::felt252" }], outputs: [{ name: "submission_id", type: "core::integer::u64" }], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("submit_evidence", [id, evidenceHash]);
      return res.transaction_hash ?? res.hash;
    });

  const vote = () =>
    guard("vote", async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: [{ name: "vote", type: "function", inputs: [{ name: "bounty_id", type: "core::integer::u64" }, { name: "submission_id", type: "core::integer::u64" }], outputs: [], stateMutability: "external" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("vote", [id, Number(voteSubmission)]);
      return res.transaction_hash ?? res.hash;
    });

  const claim = () =>
    guard("claim", async () => {
      const { wallet, address } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const bountyId = Number(id);
      const amount = BigInt(bounty?.reward_amount ?? bounty?.rewardAmount ?? 1000).toString();
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operation = "0x52454c45415345"; // 'RELEASE' as felt
      // Correct payout: create OPEN note for winner, then invoke RELEASE with its id
      try {
        const res: any = await account.strk20InvokeTransaction([
          { type: "transfer", token: STRK20[NETWORK].strkTokenAddress as Address, amount: "OPEN", recipient: address } as any,
          { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyId.toString(), amount, nonce, "${openNoteIds[0]}"] } as any,
        ]);
        return res.transaction_hash ?? res.hash;
      } catch (e) {
        console.warn("[claim] transfer+invoke failed, trying single invoke", e);
        const noteId = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
        const res: any = await account.strk20InvokeTransaction([{ type: "invoke" as const, contract: CONTRACTS.verityAnonymizer!, calldata: [operation, bountyId.toString(), amount, nonce, noteId] } as any]);
        return res.transaction_hash ?? res.hash;
      }
    });

  if (loading) {
    return (
      <main>
        <div className="skeleton skeleton-line medium" style={{ width: 120, height: 24, marginBottom: 16 }} />
        <div className="card card-pad">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      </main>
    );
  }

  if (error && !bounty) {
    return (
      <main>
        <div className="alert alert-error">
          <span>⚠</span>
          <div>
            <strong>Bounty not found</strong>
            <div style={{ opacity: 0.8, marginTop: 4 }}>It may not exist or the network is unavailable. Try again.</div>
          </div>
        </div>
        <Link href="/bounties" className="btn btn-secondary" style={{ marginTop: 16 }}>
          Back to bounties
        </Link>
      </main>
    );
  }

  const statusKey = String(bounty?.status ?? bounty?.[3] ?? "0");
  const meta = STATUS_META[statusKey] ?? { label: statusKey, cls: "badge-created", desc: "" };
  const reward = bounty?.reward_amount ?? bounty?.[2] ?? 0;
  const storedMeta = (() => {
    const m = getStoredMeta(Number(id));
    if (m?.title) return m;
    const feltTitle = feltToTitle(bounty?.metadata_hash ?? bounty?.[4]);
    if (feltTitle) return { title: feltTitle, description: "" };
    return null;
  })();
  const displayTitle = storedMeta?.title || `Bounty #${id}`;
  const displayDesc = storedMeta?.description || "Investigation bounty — evidence required to verify the claim.";
  const isPaid = statusKey === "6" || statusKey === "PAID";
  const isClaimable = statusKey === "5" || statusKey === "CLAIMABLE";
  const isVoting = statusKey === "3" || statusKey === "VOTING";
  const isOpen = statusKey === "2" || statusKey === "OPEN";
  const isFunded = statusKey === "1" || statusKey === "FUNDED";
  const isCreated = statusKey === "0" || statusKey === "CREATED";

  const timeline = [
    { key: "Created", done: true, current: isCreated },
    { key: "Funded", done: !isCreated, current: isFunded },
    { key: "Open", done: isOpen || isVoting || isClaimable || isPaid, current: isOpen },
    { key: "Voting", done: isVoting || isClaimable || isPaid, current: isVoting },
    { key: "Winner", done: isClaimable || isPaid, current: isClaimable },
    { key: "Paid", done: isPaid, current: isPaid },
  ];

  return (
    <main>
      <Link href="/bounties" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        ← Back to bounties
      </Link>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", lineHeight: 1.2 }}>{displayTitle}</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.5 }}>{displayDesc}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`badge ${meta.cls}`}>{meta.label}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{meta.desc}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 120 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Reward</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>{formatReward(reward)}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Bounty #{id}</div>
        </div>
      </div>

      <div className="timeline" style={{ marginTop: 16, marginBottom: 24 }}>
        {timeline.map((s) => (
          <div key={s.key} className={`timeline-step ${s.done ? "done" : ""} ${s.current ? "current" : ""} ${!s.done && !s.current ? "upcoming" : ""}`}>
            {s.done ? "✓" : "○"} {s.key}
          </div>
        ))}
      </div>

      {bounty && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Details</h3>
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Creator</span>
              <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(String(bounty.creator ?? bounty[1] ?? ""))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Created</span>
              <span>{bounty.created_at ? new Date(Number(bounty.created_at) * 1000).toLocaleDateString() : "—"}</span>
            </div>
            {bounty.winner && String(bounty.winner) !== "0x0" && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Winner</span>
                <span style={{ fontFamily: "Fragment Mono", fontSize: 12 }}>{shortAddr(String(bounty.winner))}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Actions</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
          {isCreated && "This bounty needs funding. Fund it privately to make it discoverable."}
          {isFunded && "Bounty funded. Open it to accept evidence."}
          {isOpen && "Bounty is open. Submit evidence for review."}
          {isVoting && "Voting is active. Verifiers can vote for the best submission."}
          {isClaimable && "A winner has been selected. The reward is ready to claim privately."}
          {isPaid && "This bounty is complete. The reward has been paid."}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {isCreated && (
            <button disabled={!!busy} onClick={fundPrivate} className="btn btn-primary">
              {busy === "fund" ? "Confirm in wallet…" : "Fund privately"}
            </button>
          )}
          {isFunded && (
            <button disabled={!!busy} onClick={open} className="btn btn-primary">
              {busy === "open" ? "Processing…" : "Open bounty"}
            </button>
          )}
          {isOpen && (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="Evidence reference (hash)" value={evidenceHash} onChange={(e) => setEvidenceHash(e.target.value)} />
              <button disabled={!!busy} onClick={submit} className="btn btn-primary">
                {busy === "submit" ? "Submitting…" : "Submit"}
              </button>
            </div>
          )}
          {isVoting && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="input" style={{ maxWidth: 120 }} value={voteSubmission} onChange={(e) => setVoteSubmission(e.target.value)} placeholder="ID" />
              <button disabled={!!busy} onClick={vote} className="btn btn-primary">
                {busy === "vote" ? "Voting…" : "Vote"}
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Choose the best submission</span>
            </div>
          )}
          {isClaimable && (
            <button disabled={!!busy} onClick={claim} className="btn btn-primary">
              {busy === "claim" ? "Claiming privately…" : "Claim reward privately"}
            </button>
          )}
          {isPaid && <div className="alert alert-success">✓ Reward paid — check your private balance in your wallet.</div>}
        </div>
        {busy && <div style={{ marginTop: 12, fontSize: 12, color: "var(--amber)" }}>Waiting for wallet… {busy === "fund" || busy === "claim" ? "This uses STRK20 private proof and may take 20s." : "Confirm in your wallet."}</div>}
        {txHash && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            Transaction:{" "}
            <a href={`${VERITY_NETWORKS[NETWORK].explorerUrl}/tx/${txHash}`} target="_blank" className="underline" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
              View on explorer
            </a>
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            <span>⚠</span>
            <div>
              <strong>Something went wrong</strong>
              <div style={{ opacity: 0.85, marginTop: 4 }}>{error}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Submissions</h3>
        {submissions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>No submissions yet. Be the first to submit evidence.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {submissions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>#{s.id} — {shortAddr(String(s.investigator))}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "Fragment Mono" }}>{String(s.evidence_hash).slice(0, 24)}…</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.votes ?? 0} votes</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(Number(s.timestamp) * 1000).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
