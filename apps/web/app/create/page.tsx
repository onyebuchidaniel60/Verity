"use client";

import { useState } from "react";
import Link from "next/link";
import { Contract, constants } from "starknet";
import { connectWallet, createStrk20Account, strk20InvokeBareActions } from "@/strk20-proof/strk20-proof";
import { CONTRACTS } from "@/lib/contracts";
import { createProvider } from "@/lib/starknet";
import { humanToWei as sharedHumanToWei, formatRewardWei, loadBounty, generateSecret, computeLock, saveBountySecrets, buildCreateBountyCalldata, hexFelt, normalizeContractAddress, buildInvokeCall, toWalletInvokeParams } from "@/lib/bounty";
import {
  genesisTip, peekCreatorPreimage, buildCreateActions, saveCreator,
  generateIdentitySeed,
} from "@/lib/identity-pure";
import { STRK20 } from "@/lib/strk20";

const NETWORK = "sepolia" as const;

// Marker logged with every create payload so a stale browser bundle is
// immediately visible in the console (the INVALID_REQUEST_PAYLOAD fix ships
// with this marker; its absence proves the browser runs older code).
const CREATE_FLOW_VERSION = "create-hex-v2/account.execute-array";

// Wallet must be on Sepolia: a request built for Sepolia contracts fails
// wallet-side validation otherwise. Tolerates hex or name forms; proceeds
// when the wallet does not report a chain (never block on a missing signal).
function assertSepoliaChain(chainId: string | undefined, where: string) {
  if (!chainId) return;
  const hex = constants.StarknetChainId.SN_SEPOLIA;
  const ok = /sepolia/i.test(chainId) || chainId.toLowerCase() === String(hex).toLowerCase();
  if (!ok) throw new Error(`Wallet is on ${chainId} (${where}) — switch to Sepolia and retry.`);
}

export default function CreateBountyPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("1");
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [payoutAddr, setPayoutAddr] = useState("");
  const [success, setSuccess] = useState<{ hash: string; id: number | null; rewardWei: string; rewardDisplay: string; locksHash: string | null; locksError: string | null; fundSecret: string | null; refundSecret: string | null; creatorAlias: string | null; creatorSeed: string | null } | null>(null);

  // Single source of truth for STRK→wei (BigInt/string-safe, never Number/1e18).
  function humanToWei(s: string): string {
    return sharedHumanToWei(s);
  }

  async function handleCreate() {
    setBusy(true);
    setBusyStep("create");
    setError(null);
    setSuccess(null);
    setCopied(null);
    try {
      if (!title.trim()) throw new Error("Please add a bounty title");
      if (!reward.trim()) throw new Error("Please set a reward");
      const rewardWei = humanToWei(reward);
      if (BigInt(rewardWei) <= 0n) throw new Error("Reward must be greater than 0");
      const metadata = title.trim().slice(0, 31) || "Verity Bounty";
      const metadataFelt = "0x" + Buffer.from(metadata).toString("hex").slice(0, 62) || "0x1234";

      const { wallet, address: connectedAddress, chainId } = await connectWallet();
      assertSepoliaChain(chainId, "create");
      console.info("[create bounty] context", { network: NETWORK, chainId, connectedAddress, bountyManager: CONTRACTS.bountyManager, helper: CONTRACTS.verityAnonymizer });
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: "" as any });

      // Normal public invoke (wallet_addInvokeTransaction — NOT the STRK20
      // privacy API; creation and private funding are separate steps).
      // starknet.js CallData.compile emits DECIMAL strings, which Ready X
      // rejects with INVALID_REQUEST_PAYLOAD, so the hex calldata is
      // pre-built + schema-validated and sent via account.execute directly.
      // Env-provided addresses are normalized (trim + 0x-hex + range) because
      // a malformed override fails the same wallet-side validation.
      const bountyManager = normalizeContractAddress(CONTRACTS.bountyManager, "BountyManager");
      const [rewardHex, metadataHex] = buildCreateBountyCalldata(rewardWei, metadataFelt);
      const createCall = buildInvokeCall(bountyManager, "create_bounty", [rewardHex, metadataHex]);
      const walletParams = toWalletInvokeParams(createCall);
      console.info("[create bounty] flow", CREATE_FLOW_VERSION, { method: "wallet_addInvokeTransaction", network: NETWORK, chainId, account: connectedAddress, bountyManager });
      console.info("[create bounty] wallet_addInvokeTransaction params", JSON.parse(JSON.stringify(walletParams)));
      console.info("[create bounty] calldata items", createCall.calldata.map((c, i) => ({ index: i, value: c, chars: c.length })));
      const res: any = await account.execute([createCall]);
      const hash = res.transaction_hash ?? res.hash ?? "";
      // CREATE does NOT fund: wait for actual L2 confirmation, then read the
      // authoritative on-chain bounty ID + reward. Metadata is written only
      // after confirmation, keyed by the actual on-chain bounty ID.
      let newId: number | null = null;
      let onChainRewardWei = rewardWei;
      try {
        const provider = createProvider(NETWORK);
        if (hash) {
          try {
            await provider.waitForTransaction(hash, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
          } catch (w: any) {
            console.warn("[create bounty] waitForTransaction warning", w?.message);
          }
        }
        const c2 = new Contract({ abi: [{ name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
        const r: any = await c2.call("get_bounty_count", []);
        newId = Number(r?.count ?? r) || null;
        if (newId) {
          // Verify on-chain reward is exactly what the user entered.
          try {
            const vm = await loadBounty(provider, newId);
            onChainRewardWei = vm.rewardWei.toString();
            if (BigInt(onChainRewardWei) !== BigInt(rewardWei)) {
              console.warn(`[create bounty] reward mismatch: entered ${rewardWei} != on-chain ${onChainRewardWei} for bounty #${newId} — displaying on-chain value`);
            }
          } catch (vErr) {
            console.warn("[create bounty] on-chain verification skipped", vErr);
          }
          // Persist title/description off-chain for display (reward/status stay on-chain authoritative).
          const meta = { title: title.trim(), description: description.trim(), reward, rewardWei: onChainRewardWei, metadataFelt, createdAt: Date.now() };
          try {
            localStorage.setItem(`verity_bounty_${newId}`, JSON.stringify(meta));
            // Also keep an index
            const idxRaw = localStorage.getItem("verity_bounty_index");
            const idx = idxRaw ? JSON.parse(idxRaw) : [];
            if (!idx.includes(newId)) {
              idx.push(newId);
              localStorage.setItem("verity_bounty_index", JSON.stringify(idx));
            }
          } catch {}
          // Phase 3 secret-bound funding: generate fund/refund secrets NOW,
          // commit ONLY their Poseidon locks on-chain via set_locks (direct
          // creator call — secrets never leave this device except the one-time
          // backup below). Plaintexts are persisted locally only after the
          // lock transaction confirms, keyed by the actual on-chain bounty ID.
          let locksHash: string | null = null;
          let locksError: string | null = null;
          let fundSecret: string | null = null;
          let refundSecret: string | null = null;
          try {
            setBusyStep("locks");
            fundSecret = generateSecret();
            refundSecret = generateSecret();
            const fundLock = computeLock(fundSecret);
            const refundLock = computeLock(refundSecret);
            // Hex calldata (same INVALID_REQUEST_PAYLOAD reason as create).
            const helper = normalizeContractAddress(CONTRACTS.verityAnonymizer, "VerityAnonymizer");
            const locksCall = buildInvokeCall(helper, "set_locks", [hexFelt(newId), hexFelt(fundLock), hexFelt(refundLock), "0x0"]);
            console.info("[create bounty] wallet_addInvokeTransaction set_locks params", JSON.parse(JSON.stringify(toWalletInvokeParams(locksCall))));
            const lres: any = await account.execute([locksCall]);
            locksHash = lres.transaction_hash ?? lres.hash ?? "";
            if (locksHash) {
              try {
                await provider.waitForTransaction(locksHash, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
              } catch (w: any) {
                console.warn("[create bounty] locks waitForTransaction warning", w?.message);
              }
            }
            saveBountySecrets(newId, { fund_secret: fundSecret, refund_secret: refundSecret });
          } catch (lErr: any) {
            // Bounty exists (CREATED) but locks are unset: the detail page
            // offers "Set funding locks" as a retry. Secrets are NOT stored.
            locksError = lErr instanceof Error ? lErr.message : String(lErr);
            console.warn("[create bounty] set_locks failed", lErr);
            fundSecret = null;
            refundSecret = null;
          }
          setSuccess({ hash, id: newId, rewardWei: onChainRewardWei, rewardDisplay: formatRewardWei(BigInt(onChainRewardWei)), locksHash, locksError, fundSecret, refundSecret, creatorAlias: null, creatorSeed: null });
          return;
        }
      } catch {}
      setSuccess({ hash, id: newId, rewardWei: onChainRewardWei, rewardDisplay: formatRewardWei(BigInt(onChainRewardWei)), locksHash: null, locksError: null, fundSecret: null, refundSecret: null, creatorAlias: null, creatorSeed: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("USER_REFUSED") || msg.includes("user rejected") || msg.includes("UserRejected")) setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      else if (msg.includes("INSUFFICIENT") || msg.includes("balance")) setError("Insufficient balance to create this bounty. Try a smaller reward or add funds.");
      else if (msg.includes("Validate Unhandled")) setError("We couldn't prepare that reward amount. Please try a different amount.");
      else setError(msg);
      console.error("[create bounty] failed", e);
    } finally {
      setBusy(false);
      setBusyStep(null);
    }
  }

  // Private creation: the bounty is born pool-routed under a creator alias.
  // No creator wallet is recorded. Control auth is a per-bounty hash chain
  // (same scheme as investigator identities); value movement binds an
  // explicit payout address the creator chooses (refunds land there —
  // withdraw edges are inherently public, so a fresh address is best).
  async function handleCreatePrivate() {
    setBusy(true);
    setBusyStep("create");
    setError(null);
    setSuccess(null);
    setCopied(null);
    try {
      if (!title.trim()) throw new Error("Please add a bounty title");
      if (!reward.trim()) throw new Error("Please set a reward");
      const rewardWei = humanToWei(reward);
      if (BigInt(rewardWei) <= 0n) throw new Error("Reward must be greater than 0");
      const metadata = title.trim().slice(0, 31) || "Verity Bounty";
      const metadataFelt = "0x" + Buffer.from(metadata).toString("hex").slice(0, 62) || "0x1234";

      const { wallet, address, chainId } = await connectWallet();
      assertSepoliaChain(chainId, "private create");
      console.info("[create private] context", { network: NETWORK, chainId, bountyManager: CONTRACTS.bountyManager, helper: CONTRACTS.verityAnonymizer });
      const account: any = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as any });
      const payout = (payoutAddr.trim() || address).trim();
      if (!payout) throw new Error("No payout address available — connect your wallet.");

      // Creator alias: fresh seed per bounty, genesis tip is the pseudonym.
      const seed = generateIdentitySeed();
      const alias = genesisTip(seed);
      console.info("[create private] step=invoke CREATE_BOUNTY (pool-routed, no wallet in calldata)");
      const actionArray = buildCreateActions({
        helper: CONTRACTS.verityAnonymizer!,
        token: STRK20[NETWORK].strkTokenAddress as any,
        selfAddress: address,
        rewardWei,
        metadataFelt,
        aliasHex: alias,
      });
      let hash = "";
      try {
        // Dust-anchored (Option A, §47.7): [transfer 1 wei→self, invoke].
        // Shared fallback chain (direct -> prepare+addInvoke).
        const res = await strk20InvokeBareActions({ account, actions: actionArray, logTag: "create private", context: { pool: STRK20[NETWORK].poolAddress, token: STRK20[NETWORK].strkTokenAddress } });
        hash = res.transaction_hash ?? res.hash ?? "";
        console.info("[create private] accepted via", res.path);
      } catch (e: any) {
        console.error("[create private] wallet_strk20InvokeTransaction error", e);
        throw e;
      }
      // Read back the assigned id + verify the alias on-chain, then persist
      // the creator seed (device-only) and bind the payout address.
      const provider = createProvider(NETWORK);
      if (hash) {
        try {
          await provider.waitForTransaction(hash, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
        } catch (w: any) {
          console.warn("[create private] waitForTransaction warning", w?.message);
        }
      }
      const c2 = new Contract({ abi: [{ name: "get_bounty_count", type: "function", inputs: [], outputs: [{ name: "count", type: "core::integer::u64" }], stateMutability: "view" }] as any, address: CONTRACTS.bountyManager!, providerOrAccount: provider });
      const r: any = await c2.call("get_bounty_count", []);
      const newId = Number(r?.count ?? r) || null;
      if (!newId) throw new Error("Bounty was not assigned an ID. Check the transaction and try again.");
      const vm = await loadBounty(provider, newId);
      if (!vm.creatorAlias || BigInt(vm.creatorAlias).toString(16) !== BigInt(alias).toString(16)) {
        throw new Error("On-chain alias mismatch — bounty not created as private. Nothing was stored on this device.");
      }
      saveCreator(newId, { seed, alias, nextK: 63 });
      try {
        localStorage.setItem(`verity_bounty_${newId}`, JSON.stringify({ title: title.trim(), description: description.trim(), reward, rewardWei, metadataFelt, createdAt: Date.now(), private: true }));
        const idxRaw = localStorage.getItem("verity_bounty_index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        if (!idx.includes(newId)) {
          idx.push(newId);
          localStorage.setItem("verity_bounty_index", JSON.stringify(idx));
        }
      } catch {}
      // Bind payout address (non-consuming setup auth) + fund/refund secrets
      // + funding locks (non-consuming alias auth). The creator chain stays
      // at nextK 63 until the first state-changing op (open).
      let locksHash: string | null = null;
      let locksError: string | null = null;
      let fundSecret: string | null = null;
      let refundSecret: string | null = null;
      try {
        setBusyStep("locks");
        // Direct invokes use pre-built hex calldata (same INVALID_REQUEST_PAYLOAD
        // reason as public create: starknet.js would emit decimal strings).
        const stored = { seed, alias, nextK: 63 };
        const bmAddr = normalizeContractAddress(CONTRACTS.bountyManager, "BountyManager");
        const helperAddr = normalizeContractAddress(CONTRACTS.verityAnonymizer, "VerityAnonymizer");
        const payoutCall = buildInvokeCall(bmAddr, "set_payout_address", [hexFelt(newId), hexFelt(payout.trim()), hexFelt(peekCreatorPreimage(stored))]);
        console.info("[create private] flow", CREATE_FLOW_VERSION, { method: "wallet_addInvokeTransaction", network: NETWORK, chainId, bountyManager: bmAddr });
        console.info("[create private] wallet_addInvokeTransaction set_payout_address params", JSON.parse(JSON.stringify(toWalletInvokeParams({ ...payoutCall, calldata: payoutCall.calldata.map((c, i) => (i === 2 ? "<preimage-redacted>" : c)) }))));
        const pres: any = await account.execute([payoutCall]);
        try {
          await provider.waitForTransaction(pres.transaction_hash ?? pres.hash, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
        } catch {}
        fundSecret = generateSecret();
        refundSecret = generateSecret();
        const privLocksCall = buildInvokeCall(helperAddr, "set_locks", [hexFelt(newId), hexFelt(computeLock(fundSecret)), hexFelt(computeLock(refundSecret)), hexFelt(peekCreatorPreimage(stored))]);
        console.info("[create private] wallet_addInvokeTransaction set_locks params", JSON.parse(JSON.stringify(toWalletInvokeParams({ ...privLocksCall, calldata: privLocksCall.calldata.map((c, i) => (i === 3 ? "<preimage-redacted>" : c)) }))));
        const lres: any = await account.execute([privLocksCall]);
        locksHash = lres.transaction_hash ?? lres.hash ?? "";
        if (locksHash) {
          try {
            await provider.waitForTransaction(locksHash, { retryInterval: 2000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] } as any);
          } catch {}
        }
        saveBountySecrets(newId, { fund_secret: fundSecret, refund_secret: refundSecret });
      } catch (lErr: any) {
        locksError = lErr instanceof Error ? lErr.message : String(lErr);
        console.warn("[create private] payout/locks setup failed", lErr);
        fundSecret = null;
        refundSecret = null;
      }
      setSuccess({ hash, id: newId, rewardWei, rewardDisplay: formatRewardWei(BigInt(rewardWei)), locksHash, locksError, fundSecret, refundSecret, creatorAlias: alias, creatorSeed: seed });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("USER_REFUSED") || msg.includes("user rejected") || msg.includes("UserRejected")) setError("Transaction cancelled — you declined in your wallet. No changes were made.");
      else if (msg.includes("NOT_REGISTERED") || msg.includes("118")) setError("Your wallet isn’t registered for private transactions yet. In Ready: enable privacy/STRK20, finish private setup, and shield some STRK first — then retry.");
      else setError(msg);
      console.error("[create private] failed", e);
    } finally {
      setBusy(false);
      setBusyStep(null);
    }
  }

  function copySecret(label: string, value: string) {    try {
      navigator.clipboard.writeText(value).then(
        () => setCopied(label),
        () => setCopied(null),
      );
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  if (success) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", padding: "32px 0" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", margin: "0 auto 16px", fontSize: 24, color: "var(--text)" }}>
          ✓
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Bounty created</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
          Status: <strong>CREATED</strong> — not funded yet. Next, fund it privately so it can be opened for investigations.
        </p>
        <div className="card card-pad" style={{ textAlign: "left", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Reward</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>{success.rewardDisplay}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Transaction</div>
          <div style={{ fontSize: 12, wordBreak: "break-all", color: "var(--text-secondary)" }}>{success.hash}</div>
          {success.id && <div style={{ marginTop: 8, fontSize: 13 }}>Bounty #{success.id} — Status: CREATED — <Link href={`/bounty/${success.id}`} className="underline" style={{ color: "var(--accent)" }}>Fund it privately →</Link></div>}
          {success.creatorAlias && <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>Anonymous creator identity registered — your wallet was never recorded.</div>}
          {success.locksHash && <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>Funding locks: SET — {success.creatorAlias ? "only the funding-secret holder can fund this bounty." : "only this wallet can fund this bounty."}</div>}
          {success.locksError && (
            <div className="alert alert-error" style={{ marginTop: 8 }}>
              <span>⚠</span>
              <div>
                <strong>Funding locks were not set</strong>
                <div style={{ opacity: 0.85, marginTop: 4 }}>The bounty exists, but funding is locked until you set the funding locks from the bounty page.</div>
              </div>
            </div>
          )}
        </div>
        {((success.fundSecret && success.refundSecret) || success.creatorSeed) && (
          <div className="card card-pad" style={{ textAlign: "left", marginBottom: 16, borderColor: "var(--amber-border)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Back up your funding secrets — once</div>            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px", lineHeight: 1.5 }}>
              These authorize funding, refunds{success.creatorSeed ? ", and control of this bounty" : ""} for this bounty. They are stored on this device only.
              Anyone with the refund secret can trigger a refund to you — keep them private.
            </p>
            {(
              [
                ["Funding secret", success.fundSecret],
                ["Refund secret", success.refundSecret],
                ["Creator identity seed (controls this bounty)", success.creatorSeed],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => !!v)
              .map(([label, value]) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>{value ?? ""}</code>
                  <button type="button" className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => copySecret(label, value ?? "")}>
                    {copied === label ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <Link href="/bounties" className="btn btn-secondary">
            Browse bounties
          </Link>
          {success.id && (
            <Link href={`/bounty/${success.id}`} className="btn btn-primary">
              Go to bounty
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto" }}>
      <Link href="/bounties" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        ← Back to bounties
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "16px 0 6px" }}>Create a bounty</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>
        Describe what you need verified. Set a reward and let the community find the truth — funding and payout stay private.
      </p>

      <div className="card card-pad" style={{ display: "grid", gap: 16 }}>
        <div>
          <label className="label">Bounty title *</label>
          <input className="input" placeholder="e.g. Verify the source of this photo" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="help">Be specific — investigators will use this to gather evidence.</div>
        </div>

        <div>
          <label className="label">Details</label>
          <textarea className="textarea" rows={4} placeholder="Add context, links, and what a good submission should include…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className="label">Reward *</label>
          <div style={{ position: "relative" }}>
            <input className="input" placeholder="1.0" value={reward} onChange={(e) => setReward(e.target.value)} style={{ paddingRight: 60 }} />
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>STRK</span>
          </div>
          <div className="help">You’ll fund this after creating. The amount is locked privately until a winner is selected.</div>
        </div>

        <div>
          <label className="label">Refund address (private bounties)</label>
          <input className="input" placeholder="Defaults to your wallet" value={payoutAddr} onChange={(e) => setPayoutAddr(e.target.value)} style={{ fontFamily: "Fragment Mono", fontSize: 12 }} disabled={!privateMode} />
          <div className="help">Refunds land here on a public transfer — use a fresh address for full privacy. Only needed for private bounties.</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <input id="private-create" type="checkbox" checked={privateMode} onChange={(e) => setPrivateMode(e.target.checked)} style={{ marginTop: 3 }} />
          <label htmlFor="private-create" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text)" }}>Create as an anonymous creator.</strong> Your wallet is never recorded —
            control is proven with a private identity instead. Uses one private transaction (a small privacy fee applies).
          </label>
        </div>

        <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Summary</div>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Title</span>
              <span style={{ fontWeight: 500 }}>{title || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Reward</span>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{reward || "0"} STRK</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Network</span>
              <span>Sepolia</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error">
            <span>⚠</span>
            <div>
              <strong>Something went wrong</strong>
              <div style={{ opacity: 0.85, marginTop: 4 }}>{error}</div>
            </div>
          </div>
        )}

        <button disabled={busy} onClick={privateMode ? handleCreatePrivate : handleCreate} className="btn btn-primary btn-lg" style={{ width: "100%" }}>
          {busy ? (busyStep === "locks" ? "Setting funding locks…" : "Waiting for wallet…") : privateMode ? "Create bounty privately" : "Create bounty"}
        </button>
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", margin: 0 }}>
          Your wallet will open to securely approve this. VERITY never sees your private key.
        </p>
      </div>
    </main>
  );
}
