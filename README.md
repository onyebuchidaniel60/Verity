# VERITY

**A private market for verified intelligence.**

VERITY is a decentralized bounty marketplace for investigations, research, and
truth-finding on **Starknet**, where bounty funding and winner payouts use
**genuine STRK20 privacy flows** — real shielded balances, the real privacy
pool, `privacy_invoke`, and real `privacy::objects::OpenNoteDeposit` — rather
than simulated privacy or ordinary public ERC20 transfers.

> **Status: Phases 0–6 verified on Sepolia, evolving to creator-controlled bounty marketplace.** Verity is a privacy-preserving marketplace where bounty creators privately fund bounties, anonymous investigators with stake and reputation submit investigations, and creators directly select and privately reward winners. Development follows the gates in [`CLINE_IMPLEMENTATION_PLAN.md`](./CLINE_IMPLEMENTATION_PLAN.md). STRK20 integration proven via real Sepolia pool `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` (`Ready X` `0xdc46…420ca5`) and local `snforge` 18 tests. `BountyManager V2` (staking + reputation, no verifiers) built locally, Sepolia deployment pending faucet funding. See [`docs/REPUTATION.md`](./docs/REPUTATION.md) for anonymous reputation design. Mainnet `strk20.json` pending.

## Canonical documents

| Document | Purpose |
| --- | --- |
| [`VERITY_SPEC.md`](./VERITY_SPEC.md) | **What VERITY must be** — the canonical architecture specification. |
| [`CLINE_IMPLEMENTATION_PLAN.md`](./CLINE_IMPLEMENTATION_PLAN.md) | **How VERITY is built & verified** — phases, gates, evidence and failure policy. |
| [`docs/STRK20_INTEGRATION.md`](./docs/STRK20_INTEGRATION.md) | Selected STRK20 integration route, pinned versions, addresses, required APIs and known limitations. |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | High-level architecture (application / STRK20 / anonymizer / pool). |
| [`docs/PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md) | What STRK20 hides and what stays public. |

## What VERITY is (short version)

- A creator posts a bounty (question / claim / investigation) and sets a reward.
- The reward is **funded privately** through the STRK20 privacy pool (`transfer OPEN + invoke VerityAnonymizer FUND_BOUNTY`).
- Anonymous investigators — pseudonymous `Anonymous Investigator #A7F3`, not wallet addresses — stake a fixed amount (default `1 STRK`) and need a minimum reputation (default `60/100`) to be eligible.
- Eligible investigators submit investigations; they build reputation while anonymous (wins `+10`, slashes `-20`).
- The **bounty creator reviews** investigations and directly selects the winner — no verifier committee.
- The winner **claims privately** (`RELEASE` → `OpenNoteDeposit` → private note) or the creator reclaims funds with a protocol fee if no entry deserves the reward.
- Funding and payout move value through the **real STRK20 privacy pool**:

```text
Requester ─▶ STRK20 pool ─▶ privacy_invoke ─▶ VerityAnonymizer ─▶ BountyManager ─▶ FUNDED
BountyManager (CLAIMABLE) ─▶ STRK20 wallet op ─▶ pool ─▶ privacy_invoke ─▶ VerityAnonymizer
      ─▶ ReleaseToOpenNote ─▶ real OpenNoteDeposit ─▶ winner private STRK20 note
```

## Repository structure

```text
verity/
├── VERITY_SPEC.md
├── CLINE_IMPLEMENTATION_PLAN.md
├── README.md
├── LICENSE
├── package.json              # pnpm workspace scripts
├── pnpm-workspace.yaml
├── Scarb.toml                # Cairo workspace (single, root-level)
├── strk20.json               # hackathon manifest (populated in later phases)
├── apps/
│   └── web/                  # Next.js 16 / React 19 / TypeScript shell
├── contracts/
│   ├── bounty_manager/       # VERITY business logic (scaffold only, Phase 0)
│   └── verity_anonymizer/    # STRK20 application boundary (scaffold only, Phase 0)
├── tests/
│   ├── bounty_manager/       # planned Phase 4 test suites
│   └── integration/          # planned STRK20 → anonymizer → manager integration suites
├── scripts/                  # setup + deploy/fund/payout/verify script stubs
└── docs/
    ├── ARCHITECTURE.md
    ├── STRK20_INTEGRATION.md
    ├── PRIVACY_MODEL.md
    └── DEMO.md
```

## Toolchain (Phase 0 verdict)

Cairo tooling runs inside **WSL Ubuntu-24.04** because Starknet Foundry
(`snforge`) publishes no native Windows binaries (verified against release
assets, including v0.63.0). See [`scripts/setup-wsl-toolchain.sh`](./scripts/setup-wsl-toolchain.sh)
and [`docs/STRK20_INTEGRATION.md`](./docs/STRK20_INTEGRATION.md) for exact pins.

| Tool | Version | Where |
| --- | --- | --- |
| Node.js | 24.20.0 | Windows (native) |
| pnpm | 10.34.5 | Windows (via `npm i -g pnpm@10.34.5`) |
| Scarb | 2.20.1 | WSL Ubuntu-24.04 |
| Starknet Foundry (snforge / sncast) | 0.63.0 | WSL Ubuntu-24.04 |
| starknet.js | 10.5.0 | apps/web (pinned; STRK20-capable) |
| Cairo edition | 2024_07 | contracts |

## Development commands

```bash
# Frontend (Windows, native)
pnpm install
pnpm build:web          # Next.js production build of apps/web

# Contracts (inside WSL Ubuntu-24.04)
wsl -d Ubuntu-24.04 -- bash -lc 'export PATH="$HOME/.local/bin:$PATH" && cd /mnt/c/Users/User/Documents/Verity && scarb build && snforge test'
```

## Implemented phases

| Phase | Status | Evidence |
| --- | --- | --- |
| Phase 0 — Foundation | ✅ Complete | `scarb build` + `snforge test` + `pnpm build` at `8180cb9` |
| Phase 1 — Independent STRK20 proof | ✅ Complete (Sepolia) | Wallet `Ready X` `0xdc46…420ca5` shield/balance/transfer/withdraw via `wallet_strk20*` on Sepolia pool `0x0254…0d91` |
| Phase 2 — VerityAnonymizer proof | ✅ Complete (local + Sepolia) | `VerityAnonymizer` `0x04b93a86…0ae4b` (class `0x495c6e8f…b090`) `pool-only` `privacy_invoke` → `Span<OpenNoteDeposit>`, `snforge` 9 tests |
| Phase 3 — Private bounty funding | ✅ Complete | `BountyManager` `0x07e239e…ec56da1` `fund_bounty` via `VerityAnonymizer` `FUND_BOUNTY`, Sepolia tx `0x02d6ec…83072` + `0x0347…385e7`, local e2e `test_full_bounty_lifecycle` (now `V2` with creator selection) |
| Phase 4 — Bounty mechanics | 🔄 Evolved — V2 (no verifiers) | **Old:** `7/13` voting → **New:** creator selects winner, `INVESTIGATOR_STAKE=1 STRK`, `minimum_reputation=60`, `submit_investigation` with stake+reputation gate, `report/slash` with `-20` reputation, `refund_bounty` with `5%` protocol fee, `snforge` 9 new tests (`test_report_and_slash`, `test_reputation_threshold`, etc.) — `18` total |
| Phase 5 — Private payout | ✅ Complete | `VerityAnonymizer` `RELEASE` → `BountyManager.claim_payout` → `OpenNoteDeposit`, `Paid` (unchanged, now winner is creator-selected) |
| Phase 6 — Frontend | ✅ Evolved | No verifier UI; `/` (Create→Fund→Investigate→Review→Reward), `/bounties` premium cards, `/create` (reward `1,550 STRK` persisted via `verity_bounty_<id>` + `felt` fallback), `/bounty/[id]` (funding `Amount to fund` pre-filled, eligibility `Reputation 60/ Stake 1 STRK`, staking, `Submit investigation`, creator `Select winner`/`Report`/`Reclaim funds` with fee, anonymous `#A7F3` profiles) — `pnpm build` 7 routes |
| Reputation | ✅ `VerityNative` live, `IReputationProvider` abstraction ready | `BountyManager` internal `0–100` (stake→60, win +10 cap 100, slash -20 floor 0), `docs/REPUTATION.md` research: Ethos not natively Starknet-compatible without oracle/ZK, `EthosReputationProvider` pluggable via `set_reputation_provider` |
| Phase 7 — Mainnet | ⏳ Pending (Sepolia V2 deployment pending faucet) | `BountyManager V2` built, dry-run fee `34.65 STRK` > `ready-sepolia` `19.8 STRK` — needs faucet then `declare` + `deploy` + wiring, then `strk20.json` mainnet |

## License

MIT — see [LICENSE](./LICENSE).
