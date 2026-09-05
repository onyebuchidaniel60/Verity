/**
 * VERITY — Phase 1 read-only Sepolia probe (NOT Gate 1 evidence).
 *
 * Confirms, live on Starknet Sepolia, that the official STRK20 privacy pool
 * and the STRK token are deployed and reachable, using only public RPC reads:
 *   - provider.getChainId() / getBlockNumber()        (network reachable)
 *   - provider.getClassHashAt(<pool>)                 (pool deployed + class)
 *   - provider.getClassAt(<pool>).abi length          (pool class readable)
 *   - provider.callContract(<STRK>, 'decimals')       (STRK ERC20 responds)
 *
 * This performs NO signing, NO private operations, and NO state change.
 * Per docs/AI_HANDOFF.md §18 and docs/STRK20_INTEGRATION.md §9.8, this
 * reconfirms the pinned addresses but can NEVER answer Gate 1 — only a real
 * wallet-signed STRK20 operation can.
 *
 * Run (from WSL, repo root):
 *   node apps/web/strk20-proof/readonly-probe.cjs
 */

const fs = require("fs");
const path = require("path");
const { RpcProvider } = require("starknet");

const NETWORK = "sepolia";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const REPORT = path.join(__dirname, "..", "..", "..", "probe-result", `readonly-probe-${NETWORK}.json`);

async function main() {
  const provider = new RpcProvider({
    nodeUrl: "https://starknet-sepolia-rpc.publicnode.com",
  });
  const report = {
    probe: "readonly",
    network: NETWORK,
    poolAddress: POOL,
    strkTokenAddress: STRK,
    startedAt: new Date().toISOString(),
    isGateEvidence: false,
  };

  report.chainId = await provider.getChainId();
  report.blockNumberAtProbe = await provider.getBlockNumber();

  try {
    report.poolClassHash = await provider.getClassHashAt(POOL);
    const poolClass = await provider.getClassAt(POOL);
    report.poolContractClassVersion = poolClass.contract_class_version;
    report.poolAbiEntryCount = Array.isArray(poolClass.abi) ? poolClass.abi.length : 0;
  } catch (e) {
    report.poolError = String(e && e.message ? e.message : e);
  }

  try {
    const strkClass = await provider.getClassAt(STRK);
    report.strkTokenClassReadable = !!strkClass;
    const decimals = await provider.callContract({
      contractAddress: STRK,
      entrypoint: "decimals",
    });
    report.strkDecimals = parseInt(String(decimals[0]), 16);
  } catch (e) {
    report.strkError = String(e && e.message ? e.message : e);
  }

  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log("PROBE_DONE " + REPORT);
}

main().catch((e) => {
  const msg = { probe: "readonly", fatal: String(e && e.message ? e.message : e) };
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify(msg, null, 2) + "\n");
  } catch (e2) { /* ignore */ }
  console.log("PROBE_FAILED " + msg.fatal);
});