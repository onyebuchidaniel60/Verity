"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Contract, RpcProvider } from "starknet";
import { connectWallet, createStrk20Account, type Address } from "@/strk20-proof/strk20-proof";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";
import { STRK20 } from "@/lib/strk20";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;
const BOUNTY_ABI = [
  { name: "get_bounty", type: "function", inputs: [{ name: "bounty_id", type: "u64" }], outputs: [{ name: "bounty", type: "Bounty" }], stateMutability: "view" },
  { name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "u64" }], stateMutability: "view" },
  { name: "open_bounty", type: "function", inputs: [{ name: "bounty_id", type: "u64" }], outputs: [], stateMutability: "external" },
  { name: "submit_evidence", type: "function", inputs: [{ name: "bounty_id", type: "u64" }, { name: "evidence_hash", type: "felt" }], outputs: [{ name: "submission_id", type: "u64" }], stateMutability: "external" },
  { name: "vote", type: "function", inputs: [{ name: "bounty_id", type: "u64" }, { name: "submission_id", type: "u64" }], outputs: [], stateMutability: "external" },
  { name: "claim_payout", type: "function", inputs: [{ name: "bounty_id", type: "u64" }], outputs: [], stateMutability: "external" },
  { name: "get_submission", type: "function", inputs: [{ name: "bounty_id", type: "u64" }, { name: "submission_id", type: "u64" }], outputs: [{ name: "submission", type: "Submission" }], stateMutability: "view" },
  { name: "get_vote_count", type: "function", inputs: [{ name: "bounty_id", type: "u64" }, { name: "submission_id", type: "u64" }], outputs: [{ name: "count", type: "u32" }], stateMutability: "view" },
] as const;

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [bounty, setBounty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [evidenceHash, setEvidenceHash] = useState("0x1234");
  const [voteSubmission, setVoteSubmission] = useState("1");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const provider = createProvider(NETWORK);
      const c = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const res: any = await c.call("get_bounty", [id]);
      const b = res?.bounty ?? res;
      setBounty(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const fundPrivate = () =>
    guard(async () => {
      if (!bounty) throw new Error("Bounty not loaded");
      const reward = bounty.reward_amount ?? bounty.rewardAmount ?? bounty[2];
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      // Private funding via VerityAnonymizer privacy_invoke
      // We do a single invoke with FUND_BOUNTY, bounty_id, amount, nonce, note_id
      // For Phase 3, amount = reward, nonce random, note_id 0 (empty) or open note
      const bountyId = Number(id);
      const amount = BigInt(reward).toString();
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const noteId = "0x0"; // empty for minimal proof
      // The wallet's invoke will cause pool -> VerityAnonymizer.privacy_invoke(FUND_BOUNTY, bounty_id, amount, nonce, note_id)
      // We need to construct the invoke calldata as felt array: [FUND_BOUNTY, bounty_id, amount_low, amount_high, nonce, note_id] but our VerityAnonymizer expects (operation, bounty_id:u64, amount:u128, nonce, note_id)
      // For starknet.js invoke, we pass calldata as array of felts: first is operation, then bounty_id, amount, nonce, note_id
      // However amount is u128, so it fits in one felt
      const calldata = [1465531345863704738689n.toString(), bountyId.toString(), amount, nonce, noteId]; // 1465... is 'FUND_BOUNTY' felt? Actually 'FUND_BOUNTY' as felt is 0x... Let's use the string 'FUND_BOUNTY' via shortString
      // Instead, we will use the helper: the VerityAnonymizer's privacy_invoke expects operation as felt 'FUND_BOUNTY'
      // We can just use the string 'FUND_BOUNTY' as felt via shortString, but starknet.js will handle
      // For now, we will use a simple invoke with the 5 params as above, but we need to ensure the operation felt is correct
      // Let's use the actual felt for 'FUND_BOUNTY' = 0x46554e445f424f554e5459 (from 'FUND_BOUNTY')
      // To avoid complexity, we will call via the wallet's strk20InvokeTransaction with invoke action
      const actions = [
        {
          type: "invoke" as const,
          contract: CONTRACTS.verityAnonymizer!,
          calldata: [bountyId.toString(), amount, nonce, noteId], // simplified, operation is implicit via selector?
        },
      ];
      // The above is not correct for our 5-arg function. Instead, we should call the contract directly via normal invoke for now (since private funding via STRK20 invoke is complex)
      // For MVP Phase 3, we will fund via a direct call to VerityAnonymizer.privacy_invoke as pool would, but via wallet's normal invoke (not private)
      // This is not private, but demonstrates the credit. The real private path will be via strk20InvokeTransaction with proper calldata.
      // For now, we will do a direct invoke to BountyManager.fund_bounty via VerityAnonymizer for testing
      // Let's do a direct private invoke via strk20InvokeTransaction with the correct calldata
      const operationFelt = "0x46554e445f424f554e5459"; // 'FUND_BOUNTY'
      const invokeCalldata = [operationFelt, bountyId.toString(), amount, nonce, noteId];
      const res: any = await account.strk20InvokeTransaction([
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: invokeCalldata } as any,
      ]);
      const hash = res.transaction_hash ?? res.hash;
      setTxHash(hash);
    });

  const fundPublicFallback = () =>
    guard(async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      const c = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      // This will fail if not via anonymizer, but for testing we can try
      const res: any = await c.invoke("fund_bounty", [id, bounty?.reward_amount ?? 1000]);
      setTxHash(res.transaction_hash ?? res.hash);
    });

  const open = () =>
    guard(async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("open_bounty", [id]);
      setTxHash(res.transaction_hash ?? res.hash);
    });

  const submit = () =>
    guard(async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("submit_evidence", [id, evidenceHash]);
      setTxHash(res.transaction_hash ?? res.hash);
    });

  const vote = () =>
    guard(async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      const c = new Contract({ abi: BOUNTY_ABI as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      const res: any = await c.invoke("vote", [id, Number(voteSubmission)]);
      setTxHash(res.transaction_hash ?? res.hash);
    });

  const claim = () =>
    guard(async () => {
      const { wallet } = await connectWallet();
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      // Private payout via VerityAnonymizer
      const bountyId = Number(id);
      const amount = bounty?.reward_amount ?? 1000;
      const nonce = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const noteId = "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
      const operationFelt = "0x52454c45415345"; // 'RELEASE'
      const res: any = await account.strk20InvokeTransaction([
        { type: "invoke", contract: CONTRACTS.verityAnonymizer!, calldata: [operationFelt, bountyId.toString(), amount.toString(), nonce, noteId] } as any,
      ]);
      setTxHash(res.transaction_hash ?? res.hash);
    });

  if (loading) return <main className="p-6">Loading bounty #{id}…</main>;
  if (error && !bounty) return <main className="p-6 text-red-600">Error: {error}</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/bounties" className="underline">
        ← Back to bounties
      </Link>
      <h1 className="mt-4 text-xl font-semibold">Bounty #{id}</h1>
      {bounty && (
        <div className="mt-2 rounded border p-3">
          <div>Status: {String(bounty.status ?? bounty[3] ?? "?")}</div>
          <div>Creator: {String(bounty.creator ?? bounty[1] ?? "")}</div>
          <div>Reward: {String(bounty.reward_amount ?? bounty[2] ?? "?")}</div>
          <div>Winner: {String(bounty.winner ?? "—")}</div>
        </div>
      )}
      <div className="mt-4 grid gap-3">
        <button disabled={busy} onClick={fundPrivate} className="rounded bg-black px-3 py-1 text-white disabled:opacity-50">
          Fund Private (via VerityAnonymizer)
        </button>
        <button disabled={busy} onClick={fundPublicFallback} className="rounded border px-3 py-1 disabled:opacity-50">
          Fund Public (fallback, will fail if not via anonymizer)
        </button>
        <button disabled={busy} onClick={open} className="rounded border px-3 py-1 disabled:opacity-50">
          Open Bounty
        </button>
        <div className="flex gap-2">
          <input value={evidenceHash} onChange={(e) => setEvidenceHash(e.target.value)} className="border px-2 py-1 flex-1" placeholder="evidence hash" />
          <button disabled={busy} onClick={submit} className="rounded border px-3 py-1 disabled:opacity-50">
            Submit Evidence
          </button>
        </div>
        <div className="flex gap-2">
          <input value={voteSubmission} onChange={(e) => setVoteSubmission(e.target.value)} className="border px-2 py-1" placeholder="submission id" />
          <button disabled={busy} onClick={vote} className="rounded border px-3 py-1 disabled:opacity-50">
            Vote (verifier)
          </button>
        </div>
        <button disabled={busy} onClick={claim} className="rounded bg-black px-3 py-1 text-white disabled:opacity-50">
          Claim Payout (private via VerityAnonymizer)
        </button>
      </div>
      {txHash && (
        <p className="mt-3">
          Tx:{" "}
          <a href={`${VERITY_NETWORKS[NETWORK].explorerUrl}/tx/${txHash}`} target="_blank" className="underline break-all">
            {txHash}
          </a>
        </p>
      )}
      {error && <p className="mt-3 text-red-600">Error: {error}</p>}
      <p className="mt-4 text-xs opacity-60">
        BountyManager: {CONTRACTS.bountyManager} · VerityAnonymizer: {CONTRACTS.verityAnonymizer} · Pool: {POOL}
      </p>
    </main>
  );
}
