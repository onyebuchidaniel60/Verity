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
  const [diagnoseLog, setDiagnoseLog] = useState<string | null>(null);

  // Keep the WalletAccount for declare/deploy — do not touch Phase1's accountRef.
  // We store it in a ref-like state via closure; simplest is to keep in a module ref.
  // For this isolated page we keep it in state as any (WalletAccountV6 extends WalletAccountV5 -> Account).
  const [account, setAccount] = useState<any>(null);
  const [walletObj, setWalletObj] = useState<any>(null);

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
      // Keep wallet object for direct Wallet API diagnosis (bypass starknet.js wrapper if needed)
      setWalletObj(wallet);
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
      if (!walletObj) throw new Error("Wallet object not available — reconnect");
      setStep("declare — awaiting Ready X signature");
      const [sierraRes, casmRes] = await Promise.all([fetch(SIERRA_URL), fetch(CASM_URL)]);
      const sierra = await sierraRes.json();
      const casm = await casmRes.json();
      // --- PRE-REQUEST LOGS (as requested) ---
      let computedClassHash: string | null = null;
      let computedCompiledHash: string | null = null;
      let contractClassVersion: string | null = null;
      try {
        const { hash } = await import("starknet");
        computedClassHash = (hash as any).computeContractClassHash?.(sierra) ?? null;
        computedCompiledHash = (hash as any).computeCompiledClassHash?.(casm) ?? null;
        contractClassVersion = sierra.contract_class_version ?? sierra.contract_class_version ?? null;
        // Also try to get version from sierra json directly
        if (!contractClassVersion && sierra.abi) contractClassVersion = "0.1.0 (from sierra)";
        console.info("[phase2-deploy][PRE] wallet_addDeclareTransaction — exact type", "wallet_addDeclareTransaction");
        console.info("[phase2-deploy][PRE] exact params structure", {
          type: "wallet_addDeclareTransaction",
          params: {
            compiled_class_hash: computedCompiledHash,
            contract_class: {
              // starknet.js sends { ...sierra, abi: stringified } — log the exact shape
              sierra_program_length: sierra.sierra_program?.length,
              contract_class_version: sierra.contract_class_version,
              entry_points_by_type: Object.keys(sierra.entry_points_by_type ?? {}),
              abi_length: sierra.abi?.length,
              abi_preview: typeof sierra.abi === "string" ? sierra.abi.slice(0, 120) : JSON.stringify(sierra.abi).slice(0, 200),
            },
          },
        });
        console.info("[phase2-deploy][PRE] compiled_class_hash", computedCompiledHash);
        console.info("[phase2-deploy][PRE] contract_class_version", contractClassVersion ?? sierra.contract_class_version ?? "unknown");
        console.info("[phase2-deploy][PRE] chainId", chainId, "account address", walletAddr, "wallet", walletName, "walletApiVersions", walletApiVersions);
        // Log fee estimation vs balance before request
        if (balance && declareFee) {
          try {
            const balBig = BigInt(balance.replace(/[^0-9]/g, "") || "0");
            // Try to extract overall_fee from declareFee JSON
            let feeBig: bigint | null = null;
            try {
              const parsed = JSON.parse(declareFee);
              const feeStr = parsed.overall_fee ?? parsed.suggestedMaxFee ?? parsed.max_fee ?? parsed.execution_resources?.overall_fee ?? null;
              if (feeStr) feeBig = BigInt(String(feeStr).replace(/[^0-9]/g, ""));
            } catch {}
            if (feeBig !== null) {
              const remaining = balBig - feeBig;
              console.info("[phase2-deploy][PRE] balance - estimated declare fee", { balance: balBig.toString(), fee: feeBig.toString(), remaining: remaining.toString(), remainingFRI: remaining.toString(), wouldBeNegative: remaining < 0n });
            }
          } catch (e) {
            console.warn("[phase2-deploy][PRE] balance - fee calc failed", e);
          }
        }
      } catch (e) {
        console.warn("[phase2-deploy][PRE] payload preview failed", e);
      }
      // Check if class already declared before sending — if so, wallet will grey out Confirm
      try {
        const provider = createProvider(NETWORK);
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
      let res: any;
      let walletError: any = null;
      const startTime = Date.now();
      try {
        // This triggers Ready X wallet_addDeclareTransaction via starknet.js wrapper
        console.info("[phase2-deploy][REQUEST] calling account.declare({ contract: sierra, casm }) — this will show Ready X prompt");
        res = await account.declare({ contract: sierra, casm });
        console.info("[phase2-deploy][RESPONSE] wallet_addDeclareTransaction returned", res, "elapsedMs", Date.now() - startTime);
        console.info("[phase2-deploy][RESPONSE] error object", null, "code", (res as any)?.code ?? "n/a", "message", (res as any)?.message ?? "n/a", "data", (res as any)?.data ?? "n/a");
      } catch (e: any) {
        walletError = e;
        // Capture exact wallet error — Ready X may return { code, message, data } or throw
        console.error("[phase2-deploy][RESPONSE] wallet_addDeclareTransaction error", e, "code", e?.code, "data", e?.data, "message", e?.message, "elapsedMs", Date.now() - startTime);
        console.error("[phase2-deploy][RESPONSE] full error object", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
        setDiagnoseLog(
          `type: wallet_addDeclareTransaction\nparams: { compiled_class_hash: ${computedCompiledHash}, contract_class_version: ${contractClassVersion}, chainId: ${chainId}, account: ${walletAddr} }\nerror code: ${e?.code ?? "n/a"}\nerror message: ${e?.message ?? String(e)}\nerror data: ${JSON.stringify(e?.data ?? e?.cause ?? e, null, 2)}\ncomputedClassHash: ${computedClassHash ?? "n/a"}\ncompiledClassHash: ${computedCompiledHash ?? "n/a"}`,
        );
        throw new Error(
          `wallet_addDeclareTransaction failed: ${e?.message ?? String(e)} | code: ${e?.code ?? "n/a"} | data: ${JSON.stringify(e?.data ?? e?.cause ?? "")} | payload: sierra ${sierra.abi?.length} entries, casm ${JSON.stringify(casm).length} chars | classHash ${computedClassHash ?? "n/a"} | compiled ${computedCompiledHash ?? "n/a"} | chainId ${chainId} | account ${walletAddr}`,
        );
      }
      const txHash = res.transaction_hash ?? res.transactionHash ?? res.hash;
      const cHash = res.class_hash ?? res.classHash ?? res.class_hash ?? computedClassHash;
      console.info("[phase2-deploy][RESPONSE] parsed txHash", txHash, "classHash", cHash);
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

  const diagnoseDirectDeclare = () =>
    guard(async () => {
      if (!walletObj) throw new Error("Connect wallet first — wallet object required for direct Wallet API");
      if (!account) throw new Error("Connect wallet first");
      setDiagnoseLog(null);
      setStep("diagnose direct wallet_addDeclareTransaction");
      const [sierraRes, casmRes] = await Promise.all([fetch(SIERRA_URL), fetch(CASM_URL)]);
      const sierra = await sierraRes.json();
      const casm = await casmRes.json();
      const { hash } = await import("starknet");
      const computedClassHash = (hash as any).computeContractClassHash?.(sierra) ?? "n/a";
      const computedCompiledHash = (hash as any).computeCompiledClassHash?.(casm) ?? "n/a";
      const params = {
        compiled_class_hash: computedCompiledHash,
        contract_class: { ...sierra, abi: JSON.stringify(sierra.abi) },
      };
      console.info("[phase2-deploy][DIRECT][PRE] type", "wallet_addDeclareTransaction");
      console.info("[phase2-deploy][DIRECT][PRE] params", params);
      console.info("[phase2-deploy][DIRECT][PRE] compiled_class_hash", computedCompiledHash, "contract_class_version", sierra.contract_class_version, "chainId", chainId, "account", walletAddr, "walletApiVersions", walletApiVersions);
      // Balance - fee calc before direct call
      if (balance) {
        try {
          const balBig = BigInt(String(balance).replace(/[^0-9]/g, "") || "0");
          let feeBig: bigint | null = null;
          if (declareFee) {
            try {
              const parsed = JSON.parse(declareFee);
              const feeStr = parsed.overall_fee ?? parsed.suggestedMaxFee ?? "";
              if (feeStr) feeBig = BigInt(String(feeStr).replace(/[^0-9]/g, ""));
            } catch {}
          }
          if (feeBig !== null) {
            const rem = balBig - feeBig;
            console.info("[phase2-deploy][DIRECT][PRE] balance - fee", { balance: balBig.toString(), fee: feeBig.toString(), remaining: rem.toString() });
            setDiagnoseLog(`Direct call preview — type: wallet_addDeclareTransaction\ncompiled_class_hash: ${computedCompiledHash}\nclass_hash: ${computedClassHash}\nchainId: ${chainId}\naccount: ${walletAddr}\nbalance: ${balBig.toString()}\nestimated fee: ${feeBig.toString()}\nremaining: ${rem.toString()} (${rem < 0n ? "INSUFFICIENT" : "sufficient"})`);
          }
        } catch {}
      }
      // Direct Wallet API call bypassing starknet.js wrapper — for diagnosis only, still shows Ready X prompt but we log raw response
      console.info("[phase2-deploy][DIRECT][REQUEST] wallet.features[\"starknet:walletApi\"].request({ type: \"wallet_addDeclareTransaction\", params })");
      let directRes: any = null;
      let directErr: any = null;
      try {
        directRes = await (walletObj as any).features["starknet:walletApi"].request({
          type: "wallet_addDeclareTransaction",
          params,
        });
        console.info("[phase2-deploy][DIRECT][RESPONSE] returned", directRes);
      } catch (e: any) {
        directErr = e;
        console.error("[phase2-deploy][DIRECT][RESPONSE] error", e, "code", e?.code, "message", e?.message, "data", e?.data);
      }
      const log = `DIRECT wallet_addDeclareTransaction:\ntype: wallet_addDeclareTransaction\nparams.compiled_class_hash: ${computedCompiledHash}\nparams.contract_class_version: ${sierra.contract_class_version}\nchainId: ${chainId}\naccount: ${walletAddr}\nwalletApiVersions: ${walletApiVersions?.join(",")}\n\nReturned: ${directRes ? JSON.stringify(directRes, null, 2) : "— (no return, see error)"}\n\nError code: ${directErr?.code ?? "n/a"}\nError message: ${directErr?.message ?? "n/a"}\nError data: ${JSON.stringify(directErr?.data ?? directErr?.cause ?? directErr ?? {}, null, 2)}`;
      setDiagnoseLog(log);
      if (directErr) throw new Error(`Direct wallet_addDeclareTransaction failed: ${directErr?.message ?? String(directErr)} | code ${directErr?.code ?? "n/a"} | data ${JSON.stringify(directErr?.data ?? "")}`);
      if (directRes?.transaction_hash) {
        setDeclareHash(directRes.transaction_hash);
        setClassHash(directRes.class_hash ?? computedClassHash);
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
        <div>
          <b>10b. Balance − fee:</b>{" "}
          {(() => {
            if (!balance || !declareFee || balance.startsWith("(")) return <span className="opacity-60">— (connect + estimate first)</span>;
            try {
              const bal = BigInt(String(balance).replace(/[^0-9]/g, "") || "0");
              let fee: bigint | null = null;
              try {
                const parsed = JSON.parse(declareFee);
                const raw = parsed.overall_fee ?? parsed.suggestedMaxFee ?? parsed.overallFee ?? null;
                if (raw) fee = BigInt(String(raw).replace(/[^0-9]/g, ""));
              } catch {
                // declareFee may be plain string with fee inside
                const m = declareFee.match(/(\d{12,})/);
                if (m) fee = BigInt(m[1]);
              }
              if (fee === null) return <span>{balance} − fee (could not parse fee)</span>;
              const rem = bal - fee;
              const isNeg = rem < 0n;
              return (
                <code className={isNeg ? "text-red-600" : ""}>
                  {bal.toString()} − {fee.toString()} = {rem.toString()} FRI {isNeg ? "— INSUFFICIENT (needs more STRK)" : "— sufficient"}
                </code>
              );
            } catch {
              return <span>could not compute</span>;
            }
          })()}
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
        <button className={btn} disabled={busy} onClick={diagnoseDirectDeclare}>
          3d · Diagnose Declare (direct Wallet API)
        </button>
      </div>

      {busy && <p className="mt-3">Waiting for Ready X… approve the prompt (may take 10–30s). Current step: {step}</p>}
      {error && <p className="mt-3 text-red-600">Error: {error}</p>}
      {diagnoseLog && (
        <pre className="mt-3 overflow-auto border bg-black/5 p-3 text-xs">Diagnose log:\n{diagnoseLog}</pre>
      )}

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
