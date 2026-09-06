"use client";

/**
 * VERITY — Phase 2 deployment harness (isolated, NOT production UI).
 *
 * Deploys the already-built VerityAnonymizer (Milestone 2.0) to Sepolia
 * via the SAME Ready X WalletAccount path used for Phase 1 STRK20 ops.
 * Uses starknet.js 10.5.0 WalletAccount declare/deploy (wallet_addDeclareTransaction
 * + UDC deploy via wallet_addInvokeTransaction) — no sncast private key.
 *
 * Keeps Phase 1 harness untouched (apps/web/app/phase1-proof, strk20-proof).
 */

import { useState } from "react";
import { Contract, RpcProvider } from "starknet";
import {
  connectWallet,
  createStrk20Account,
  detectStrk20Capability,
  type Address,
} from "@/strk20-proof/strk20-proof";
import { STRK20 } from "@/lib/strk20";
import { createProvider, VERITY_NETWORKS } from "@/lib/starknet";

const NETWORK = "sepolia" as const;
const POOL = STRK20[NETWORK].poolAddress as Address;
const SIERRA_URL = "/contracts/verity_anonymizer/VerityAnonymizer.sierra.json";
const CASM_URL = "/contracts/verity_anonymizer/VerityAnonymizer.casm.json";
const EXPLORER = VERITY_NETWORKS[NETWORK].explorerUrl;
const RPC_URL = VERITY_NETWORKS[NETWORK].rpcUrl;

export default function Phase2DeployPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [declareHash, setDeclareHash] = useState<string | null>(null);
  const [classHash, setClassHash] = useState<string | null>(null);
  const [deployHash, setDeployHash] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [declareFee, setDeclareFee] = useState<string | null>(null);
  const [deployFee, setDeployFee] = useState<string | null>(null);
  const [walletApiVersions, setWalletApiVersions] = useState<string[] | null>(null);
  const [step, setStep] = useState<string>("idle");

  // Keep the WalletAccount for declare/deploy — do not touch Phase1's accountRef.
  // We store it in a ref-like state via closure; simplest is to keep in a module ref.
  // For this isolated page we keep it in state as any (WalletAccountV6 extends WalletAccountV5 -> Account).
  const [account, setAccount] = useState<any>(null);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    guard(async () => {
      setStep("connect");
      const { wallet, address, walletName: wName, chainId: cId } = await connectWallet();
      const cap = await detectStrk20Capability(wallet);
      setWalletApiVersions(cap.walletApiVersions);
      console.info("[phase2-deploy] wallet connected", { walletName: wName, address, chainId: cId, walletApiVersions: cap.walletApiVersions, supported: cap.supported });
      if (!cap.supported) throw new Error(`Wallet API ${cap.walletApiVersions.join(",")} < 0.10.3`);
      const acc = await createStrk20Account(wallet, { network: NETWORK, token: STRK20[NETWORK].strkTokenAddress as Address });
      // Also create a generic provider for fee checks
      const provider = createProvider(NETWORK);
      // Check if account is deployed on Sepolia and has balance
      setWalletAddr(address);
      setWalletName(wName);
      setChainId(cId ?? null);
      setAccount(acc);
      setStep("connected");
      // Check deployment status and balance via provider
      try {
        const fetchedClass = await provider.getClassAt(address);
        setIsDeployed(!!fetchedClass);
      } catch {
        setIsDeployed(false);
      }
      try {
        // STRK is ERC20, use provider call for balance? Use Contract with ERC20 ABI minimal
        // For now just show that we attempted — real balance check via STRK contract
        const erc20Abi = [
          {
            name: "balanceOf",
            type: "function",
            inputs: [{ name: "account", type: "felt" }],
            outputs: [{ name: "balance", type: "u256" }],
            stateMutability: "view",
          },
        ];
        const strkContract = new Contract({ abi: erc20Abi, address: STRK20[NETWORK].strkTokenAddress as string, providerOrAccount: provider });
        const res: any = await strkContract.call("balanceOf", [address]);
        // u256 may be returned as bigint or object with low/high
        let balStr = "";
        if (typeof res === "bigint") balStr = res.toString();
        else if (res?.balance) balStr = String(res.balance);
        else if (Array.isArray(res)) balStr = String(res[0]);
        else balStr = JSON.stringify(res);
        setBalance(balStr);
      } catch (e) {
        setBalance(`(could not fetch: ${e instanceof Error ? e.message : String(e)})`);
      }
      // Pre-fetch artifacts to show they are loadable (no signing)
      setStep("artifacts ready");
    });

  const estimateFees = () =>
    guard(async () => {
      if (!account) throw new Error("Connect wallet first");
      setStep("estimating fees");
      const [sierraRes, casmRes] = await Promise.all([fetch(SIERRA_URL), fetch(CASM_URL)]);
      if (!sierraRes.ok) throw new Error(`Failed to fetch Sierra: ${sierraRes.status}`);
      if (!casmRes.ok) throw new Error(`Failed to fetch CASM: ${casmRes.status}`);
      const sierra = await sierraRes.json();
      const casm = await casmRes.json();
      console.info("[phase2-deploy] estimateDeclareFee payload", { sierra: { abi_len: sierra.abi?.length, sierra_program_len: sierra.sierra_program?.length }, casm_len: JSON.stringify(casm).length });
      // Try wallet account estimate first, then fallback to provider estimate
      let est: any = null;
      let estErr: string | null = null;
      try {
        est = await (account as any).estimateDeclareFee?.({ contract: sierra, casm });
        console.info("[phase2-deploy] estimateDeclareFee via account", est);
        if (!est) throw new Error("estimateDeclareFee returned empty");
      } catch (e) {
        estErr = e instanceof Error ? e.message : String(e);
        console.warn("[phase2-deploy] estimateDeclareFee via account failed", e);
        try {
          const provider = createProvider(NETWORK);
          // Provider estimate uses same payload shape but via RPC
          est = await (provider as any).estimateDeclareFee?.({ contract: sierra, casm }, { blockIdentifier: "latest" });
          console.info("[phase2-deploy] estimateDeclareFee via provider fallback", est);
          estErr = null;
        } catch (e2) {
          console.warn("[phase2-deploy] provider estimate also failed", e2);
          estErr = `${estErr} | provider: ${e2 instanceof Error ? e2.message : String(e2)}`;
        }
      }
      if (est) {
        setDeclareFee(JSON.stringify(est, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
      } else {
        setDeclareFee(`estimate failed: ${estErr ?? "unknown"}`);
      }
      // Check if class already declared on Sepolia — if so, declare will be rejected with CLASS_ALREADY_DECLARED and wallet may grey out Confirm
      try {
        const provider = createProvider(NETWORK);
        // Compute class hash via starknet.js hash utility if available
        const { hash } = await import("starknet");
        const computedClassHash = (hash as any).computeContractClassHash?.(sierra);
        const computedCompiledHash = (hash as any).computeCompiledClassHash?.(casm);
        console.info("[phase2-deploy] computed hashes", { computedClassHash, computedCompiledHash });
        if (computedClassHash) {
          setClassHash(computedClassHash);
          try {
            const existing = await provider.getClassByHash(computedClassHash);
            console.info("[phase2-deploy] class already declared on Sepolia", existing ? "YES" : "NO");
            if (existing) setDeclareFee((prev) => `${prev}\n\nNOTE: Class 0x06EB... already declared on Sepolia — wallet will show CLASS_ALREADY_DECLARED and disable Confirm. You can skip Declare and go to Deploy.`);
          } catch (e) {
            console.info("[phase2-deploy] getClassByHash not found (expected if not declared)", e);
          }
        }
      } catch (e) {
        console.warn("[phase2-deploy] hash compute failed", e);
      }
      setDeployFee("(estimate after declare — deploy uses UDC, fee depends on classHash + constructor)");
      setStep("fees estimated");
    });

  const doDeclare = () =>
    guard(async () => {
      if (!account) throw new Error("Connect wallet first");
      setStep("declare — awaiting Ready X signature");
      const [sierraRes, casmRes] = await Promise.all([fetch(SIERRA_URL), fetch(CASM_URL)]);
      const sierra = await sierraRes.json();
      const casm = await casmRes.json();
      // Log exact Wallet API payload that starknet.js will send to Ready X
      // WalletAccountV5.declare does: extractContractHashes({contract,casm}) -> {compiledClassHash, contract_class: {abi: stringified}} -> wallet_addDeclareTransaction {compiled_class_hash, contract_class}
      // We replicate the extraction here for logging without sending yet
      try {
        const { hash } = await import("starknet");
        const computedClassHash = (hash as any).computeContractClassHash?.(sierra);
        const computedCompiledHash = (hash as any).computeCompiledClassHash?.(casm);
        console.info("[phase2-deploy] declare payload preview", {
          sierra_abi_len: sierra.abi?.length,
          sierra_program_len: sierra.sierra_program?.length,
          compiledClassHash: computedCompiledHash,
          classHash: computedClassHash,
          contract_class_preview: { abi: typeof sierra.abi === "string" ? sierra.abi.slice(0, 100) : JSON.stringify(sierra.abi).slice(0, 200) },
        });
        // Also log what starknet.js will actually send (extracted)
        // The wallet request is: { type: "wallet_addDeclareTransaction", params: { compiled_class_hash, contract_class: { ...sierra, abi: stringified } } }
        console.info("[phase2-deploy] wallet_addDeclareTransaction params preview", {
          compiled_class_hash: computedCompiledHash,
          contract_class: { ...sierra, abi: typeof sierra.abi === "string" ? sierra.abi.slice(0, 100) + "..." : `${sierra.abi?.length} abi entries` },
        });
      } catch (e) {
        console.warn("[phase2-deploy] payload preview failed", e);
      }
      // Check if class already declared before sending — if so, wallet will grey out Confirm
      try {
        const provider = createProvider(NETWORK);
        const { hash } = await import("starknet");
        const computedClassHash = (hash as any).computeContractClassHash?.(sierra);
        if (computedClassHash) {
          try {
            const existing = await provider.getClassByHash(computedClassHash);
            if (existing) {
              console.warn("[phase2-deploy] class already declared, wallet will likely show CLASS_ALREADY_DECLARED and disable Confirm", computedClassHash);
              setError(`Class ${computedClassHash} already declared on Sepolia — wallet will disable Confirm (CLASS_ALREADY_DECLARED). Skip Declare and use Deploy with existing class_hash.`);
              return;
            }
          } catch {}
        }
      } catch {}
      // Log chainId and account before sending
      console.info("[phase2-deploy] declare account", { address: walletAddr, chainId, walletName });
      let res: any;
      try {
        // This triggers Ready X wallet_addDeclareTransaction
        res = await account.declare({ contract: sierra, casm });
        console.info("[phase2-deploy] wallet_addDeclareTransaction response", res);
      } catch (e: any) {
        // Capture exact wallet error — Ready X may return { code, message, data } or throw
        console.error("[phase2-deploy] wallet_addDeclareTransaction error", e, "code", e?.code, "data", e?.data, "message", e?.message);
        // Also log the full error object for browser console inspection
        throw new Error(
          `wallet_addDeclareTransaction failed: ${e?.message ?? String(e)} | code: ${e?.code ?? "n/a"} | data: ${JSON.stringify(e?.data ?? e?.cause ?? "")} | payload: sierra ${sierra.abi?.length} entries, casm ${JSON.stringify(casm).length} chars | classHash preview ${res?.class_hash ?? "n/a"}`,
        );
      }
      const txHash = res.transaction_hash ?? res.transactionHash ?? res.hash;
      const cHash = res.class_hash ?? res.classHash ?? res.class_hash;
      if (!txHash) throw new Error(`Declare returned no transaction_hash: ${JSON.stringify(res)}`);
      setDeclareHash(txHash);
      if (cHash) setClassHash(cHash);
      setStep("declared");
      if (cHash) {
        const provider = createProvider(NETWORK);
        try {
          await provider.waitForTransaction(txHash);
        } catch {}
      }
    });

  const doDeploy = () =>
    guard(async () => {
      if (!account) throw new Error("Connect wallet first");
      // Need classHash from prior declare, or recompute
      let cHash = classHash;
      if (!cHash) {
        // Try to get classHash from declareHash via tx receipt, or fallback to Sierra class hash
        // For now require declare first
        throw new Error("Declare first — class_hash is required for deploy. Click Declare and wait for it to be mined.");
      }
      setStep("deploy — awaiting Ready X signature (UDC)");
      // UniversalDeployer payload: classHash, constructorCalldata: [pool], salt optional, unique true by default
      const res: any = await account.deploy({
        classHash: cHash,
        constructorCalldata: [POOL],
      });
      // deploy returns { transaction_hash, contract_address } or MultiDeploy
      const txHash = res.transaction_hash ?? res.transactionHash ?? res.deploy?.transaction_hash;
      const addr = res.contract_address ?? res.contractAddress ?? res.deploy?.contract_address ?? res.address;
      // For MultiDeploy, it may be array
      const finalTx = txHash ?? (Array.isArray(res) ? res[0]?.transaction_hash : null);
      const finalAddr = addr ?? (Array.isArray(res) ? res[0]?.contract_address : null);
      if (finalTx) setDeployHash(finalTx);
      if (finalAddr) setContractAddress(finalAddr);
      if (!finalTx && !finalAddr) {
        // Fallback: log full result
        setDeployHash(JSON.stringify(res, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 500));
      }
      setStep("deployed");
      if (finalAddr) {
        // Verify get_pool and version via provider call
        const provider = createProvider(NETWORK);
        try {
          const tmpContract = new Contract({
            abi: [
              { name: "get_pool", type: "function", inputs: [], outputs: [{ name: "pool", type: "ContractAddress" }], stateMutability: "view" },
              { name: "version", type: "function", inputs: [], outputs: [{ name: "version", type: "felt" }], stateMutability: "view" },
            ],
            address: finalAddr,
            providerOrAccount: provider,
          });
          const poolRes: any = await tmpContract.call("get_pool", []);
          const verRes: any = await tmpContract.call("version", []);
          console.info("[phase2-deploy] verification get_pool", poolRes, "version", verRes);
        } catch (e) {
          console.warn("[phase2-deploy] verification failed", e);
        }
      }
    });

  const doDeclareAndDeploy = () =>
    guard(async () => {
      if (!account) throw new Error("Connect wallet first");
      setStep("declareAndDeploy — awaiting Ready X signatures (2 txs)");
      const [sierraRes, casmRes] = await Promise.all([fetch(SIERRA_URL), fetch(CASM_URL)]);
      const sierra = await sierraRes.json();
      const casm = await casmRes.json();
      // declareAndDeploy is the combined helper that does declare + UDC deploy via the same account
      // In starknet.js 10.5, Account has declareAndDeploy(payload) -> DeclareDeployUDCResponse
      const res: any = await (account as any).declareAndDeploy({
        contract: sierra,
        casm: casm,
        constructorCalldata: [POOL],
      });
      const dHash = res.declare?.transaction_hash ?? res.transaction_hash;
      const depHash = res.deploy?.transaction_hash ?? res.deploy?.transactionHash;
      const cHash = res.declare?.class_hash ?? res.class_hash;
      const addr = res.deploy?.contract_address ?? res.contract_address;
      if (dHash) setDeclareHash(dHash);
      if (cHash) setClassHash(cHash);
      if (depHash) setDeployHash(depHash);
      if (addr) setContractAddress(addr);
      setStep("declareAndDeploy done");
    });

  const btn = "rounded border px-3 py-1 text-sm disabled:opacity-40";
  const txLink = (h?: string | null) =>
    h && h.startsWith("0x") ? (
      <a className="underline" href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer">
        {h.slice(0, 10)}…{h.slice(-6)}
      </a>
    ) : h ? (
      <span className="break-all">{h}</span>
    ) : (
      "—"
    );

  return (
    <main className="mx-auto max-w-3xl p-6 text-sm">
      <h1 className="text-lg font-semibold">VERITY — Phase 2 Deploy (Sepolia) — Ready X</h1>
      <p className="mt-1 opacity-80">
        VerityAnonymizer via <code>WalletAccountV6.declare</code> + <code>deploy</code> (no sncast key). Network{" "}
        <b>{NETWORK}</b> · RPC <code className="break-all">{RPC_URL}</code>
      </p>

      <div className="mt-4 rounded border bg-amber-50 p-3 text-xs">
        <b>Isolated harness</b> — does not touch Phase 1 Shield/Balances/Transfer/Withdraw. Artifacts:{" "}
        <code>{SIERRA_URL}</code> + <code>{CASM_URL}</code> (copied from <code>target/dev/*</code> at build{" "}
        <code>bc75e4b</code>). Constructor: <code>pool = {POOL}</code> (real Sepolia pool). This page will request{" "}
        <b>two</b> wallet signatures (DECLARE + DEPLOY via UDC) or one combined <code>declareAndDeploy</code>.
      </div>

      <div className="mt-4 grid gap-2 rounded border p-3">
        <div>
          <b>1. Artifact:</b> <code>VerityAnonymizer</code> Sierra <code>verity_anonymizer_VerityAnonymizer.contract_class.json</code>{" "}
          (40100 bytes) + CASM <code>verity_anonymizer_VerityAnonymizer.compiled_contract_class.json</code> (23368 bytes) — pinned privacy{" "}
          <code>bc75e4b</code>, <code>starknet 2.17.0</code> `2024_07`.
        </div>
        <div>
          <b>2. Constructor:</b> <code>pool: ContractAddress = {POOL}</code> (single felt, zero check `POOL_ZERO`)
        </div>
        <div>
          <b>3. Network:</b> <code>{NETWORK}</code> — chainId <code>{VERITY_NETWORKS[NETWORK].chainId}</code>
        </div>
        <div>
          <b>4. Provider/RPC:</b> <code className="break-all">{RPC_URL}</code> (override via <code>NEXT_PUBLIC_STARKNET_RPC_URL</code>)
        </div>
        <div>
          <b>5. Signer:</b>{" "}
          {walletAddr ? (
            <>
              <code>{walletName ?? "Ready X"}</code> <code className="break-all">{walletAddr}</code> (connected via Wallet Standard `createStore` +{" "}
              <code>WalletAccountV6.connect</code>)
            </>
          ) : (
            <span className="opacity-60">not connected — click Connect</span>
          )}
        </div>
        <div>
          <b>5b. Wallet API versions:</b>{" "}
          {walletApiVersions ? <code>{walletApiVersions.join(", ")}</code> : "— (connect first)"} (need <code>0.10.3</code> for STRK20; <code>wallet_addDeclareTransaction</code> is standard, not STRK20)
        </div>
        <div>
          <b>6. Is account deployed on Sepolia?</b> {isDeployed === null ? "— (connect first)" : isDeployed ? "YES" : "NO — deploy account first via Ready X/Braavos UI, then fund"}
        </div>
        <div>
          <b>7. Sepolia STRK balance:</b> {balance ?? "—"} (needs STRK for `declare` + `deploy` fees; estimate via button below)
        </div>
        <div>
          <b>8. Transactions Ready X will request:</b>{" "}
          <code>wallet_addDeclareTransaction</code> (DECLARE, class hash) then{" "}
          <code>wallet_addInvokeTransaction</code> via UDC (DEPLOY, constructor <code>[pool]</code>) — <b>two prompts</b> (or one if using{" "}
          <code>declareAndDeploy</code> which batches them)
        </div>
        <div>
          <b>9. DECLARE+DEPLOY vs combined:</b> This page offers <b>separate</b> `Declare` then `Deploy` (clearer for verification) and also{" "}
          <code>declareAndDeploy</code> (combined, one call, two txs). Both are wallet-mediated; neither uses `sncast` private key.
        </div>
        <div>
          <b>10. Estimated fee (before signing):</b> Declare: <code className="break-all">{declareFee ?? "— click Estimate Fees"}</code> · Deploy:{" "}
          <code className="break-all">{deployFee ?? "—"}</code>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={connect}>
          1 · Connect Ready X
        </button>
        <button className={btn} disabled={busy} onClick={estimateFees}>
          2 · Estimate Fees
        </button>
        <button className={btn} disabled={busy} onClick={doDeclare}>
          3a · Declare (wallet)
        </button>
        <button className={btn} disabled={busy} onClick={doDeploy}>
          3b · Deploy UDC (wallet)
        </button>
        <button className={btn} disabled={busy} onClick={doDeclareAndDeploy}>
          3c · DeclareAndDeploy (combined)
        </button>
      </div>

      {busy && <p className="mt-3">Waiting for Ready X… approve the prompt (may take 10–30s). Current step: {step}</p>}
      {error && <p className="mt-3 text-red-600">Error: {error}</p>}

      <div className="mt-4 grid gap-2 rounded border p-3">
        <div>
          Declare tx: {txLink(declareHash)} {classHash && <span> · class_hash: <code className="break-all">{classHash}</code></span>}
        </div>
        <div>Deploy tx: {txLink(deployHash)}</div>
        <div>
          VerityAnonymizer Sepolia address:{" "}
          {contractAddress ? (
            <a className="underline break-all" href={`${EXPLORER}/contract/${contractAddress}`} target="_blank" rel="noreferrer">
              {contractAddress}
            </a>
          ) : (
            "—"
          )}
        </div>
        <div className="text-xs opacity-80">
          After deploy, verify: <code>get_pool() == {POOL}</code> and <code>version() == 0x5645524954595f414e4f4e594d495a45525f5630</code> via Voyager
          contract page. Deployment is <b>NOT</b> Gate 2 — next is <code>wallet_strk20InvokeTransaction</code> with{" "}
          <code>invoke</code> to this address (operation <code>VERITY_PROOF</code>) to prove pool →{" "}
          <code>privacy_invoke</code>.
        </div>
      </div>

      <details className="mt-4 text-xs opacity-70">
        <summary>Debug — constructor ABI</summary>
        <pre className="mt-2 overflow-auto border bg-black/5 p-2">
          {JSON.stringify({ constructor: { pool: POOL }, network: NETWORK, rpcUrl: RPC_URL, poolInAbi: "ContractAddress", selector: "0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043 (privacy_invoke)" }, null, 2)}
        </pre>
      </details>
    </main>
  );
}
