"use client";

import { useState } from "react";
import { Contract } from "starknet";
import { connectWallet, createStrk20Account } from "@/strk20-proof/strk20-proof";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";
import { CONTRACTS } from "@/lib/contracts";

const NETWORK = "sepolia" as const;

export default function CreateBountyPage() {
  const [reward, setReward] = useState("1000");
  const [metadata, setMetadata] = useState("0x1234");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [bountyId, setBountyId] = useState<number | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const { wallet, address } = await connectWallet();
      const provider = createProvider(NETWORK);
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });
      // Use the BountyManager ABI from the compiled artifact (fetch)
      // For MVP, we will use a minimal ABI for create_bounty
      const abi = [
        {
          name: "create_bounty",
          type: "function",
          inputs: [
            { name: "reward_amount", type: "u128" },
            { name: "metadata_hash", type: "felt" },
          ],
          outputs: [{ name: "bounty_id", type: "u64" }],
          stateMutability: "external",
        },
      ];
      const contract = new Contract({ abi: abi as any, address: CONTRACTS.bountyManager!, providerOrAccount: account });
      // Convert reward to u128 (felt)
      const rewardU128 = BigInt(reward);
      const tx: any = await contract.invoke("create_bounty", [rewardU128.toString(), metadata]);
      // For WalletAccount, invoke returns transaction_hash via wallet
      const hash = tx.transaction_hash ?? tx.hash ?? JSON.stringify(tx);
      setTxHash(hash);
      // Try to get bounty count to infer id
      try {
        const c2 = new Contract({
          abi: [
            { name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "u64" }], stateMutability: "view" },
          ] as any,
          address: CONTRACTS.bountyManager!,
          providerOrAccount: provider,
        });
        const res: any = await c2.call("get_bounty_count", []);
        const count = Number(res?.count ?? res);
        setBountyId(count);
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Create Bounty</h1>
      <p className="text-sm opacity-70">Reward is in STRK wei (1 STRK = 1e18). Metadata hash is a felt (e.g. IPFS hash as felt).</p>
      <div className="mt-4 grid gap-3">
        <label>
          Reward amount (u128, wei): <input className="border px-2 py-1 w-full" value={reward} onChange={(e) => setReward(e.target.value)} />
        </label>
        <label>
          Metadata hash (felt): <input className="border px-2 py-1 w-full" value={metadata} onChange={(e) => setMetadata(e.target.value)} />
        </label>
        <button disabled={busy} onClick={create} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create via Wallet"}
        </button>
        {txHash && (
          <p>
            Tx:{" "}
            <a href={`${VERITY_NETWORKS[NETWORK].explorerUrl}/tx/${txHash}`} target="_blank" className="underline break-all">
              {txHash}
            </a>
            {bountyId && <> — Bounty ID: {bountyId} — <a href={`/bounty/${bountyId}`} className="underline">View</a></>}
          </p>
        )}
        {error && <p className="text-red-600">Error: {error}</p>}
        <p className="text-xs opacity-60">BountyManager: {CONTRACTS.bountyManager}</p>
      </div>
    </main>
  );
}
