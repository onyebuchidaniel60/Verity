# VERITY

**A private market for verified intelligence.**

VERITY is a decentralized bounty marketplace for investigations, research, and
truth-finding on **Starknet**, where bounty funding and winner payouts use
**genuine STRK20 privacy flows** — real shielded balances, the real privacy
pool, `privacy_invoke`, and real `privacy::objects::OpenNoteDeposit` — rather
than simulated privacy or ordinary public ERC20 transfers.

> **Status: Phases 0–6 complete, verified on Sepolia.** Development follows the gates in
> [`CLINE_IMPLEMENTATION_PLAN.md`](./CLINE_IMPLEMENTATION_PLAN.md). STRK20 integration is proven via real Sepolia pool
> `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` (`Ready X` `0xdc46…420ca5`) and local `snforge` 12 tests. Mainnet `strk20.json` pending.

## Canonical documents

| Document | Purpose |
| --- | --- |
| [`VERITY_SPEC.md`](./VERITY_SPEC.md) | **What VERITY must be** — the canonical architecture specification. |
| [`CLINE_IMPLEMENTATION_PLAN.md`](./CLINE_IMPLEMENTATION_PLAN.md) | **How VERITY is built & verified** — phases, gates, evidence and failure policy. |
| [`docs/STRK20_INTEGRATION.md`](./docs/STRK20_INTEGRATION.md) | Selected STRK20 integration route, pinned versions, addresses, required APIs and known limitations. |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | High-level architecture (application / STRK20 / anonymizer / pool). |
| [`docs/PRIVACY_MODEL.md`](./docs/PRIVACY_MODEL.md) | What STRK20 hides and what stays public. |

## What VERITY is (short version)

- A requester creates a bounty (question / claim / investigation task).
- Investigators submit off-chain evidence plus an on-chain reference.
- A fixed set of **13 verifiers** evaluates submissions and votes; a submission
  wins at **7 / 13**.
- The winning investigator becomes eligible for a **claimable payout**.
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
| Phase 3 — Private bounty funding | ✅ Complete | `BountyManager` `0x07e239e…ec56da1` `fund_bounty` via `VerityAnonymizer` `FUND_BOUNTY`, Sepolia tx `0x02d6ec…83072` + `0x0347…385e7`, local e2e `test_full_bounty_lifecycle` |
| Phase 4 — Bounty mechanics | ✅ Complete | `7/13` voting, `submit`/`vote`/`winner`/`claimable`, `snforge` `test_full_bounty_lifecycle` + `test_double_vote_rejected` |
| Phase 5 — Private payout | ✅ Complete | `VerityAnonymizer` `RELEASE` → `BountyManager.claim_payout` → `OpenNoteDeposit`, `Paid` |
| Phase 6 — Frontend | ✅ Complete | `/`, `/bounties`, `/create`, `/bounty/[id]`, `/phase1-proof`, `/phase2-deploy` — `pnpm build` 7 routes |
| Phase 7 — Mainnet | ⏳ Pending (Sepolia verified, mainnet `strk20.json` to be filled) |

## License

MIT — see [LICENSE](./LICENSE).
