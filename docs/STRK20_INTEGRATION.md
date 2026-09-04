# STRK20 Integration — VERITY Findings (Phase 0)

**Status:** Phase 0 findings, recorded 2026-09-03.
**Authoritative sources:** official STRK20 resources only; verified against the live Starknet network where noted.

---

## 1. STRK20 resources inspected

| Resource | URL | What was verified |
| --- | --- | --- |
| STRK20 Build hub | https://strk20.starknet.io/build | Four official routes: private dapp (anonymizer + Wallet API), privacy wallet (Privacy SDK), own prover, private sub-accounts (coming soon). |
| STRK20 by Example | https://strk20-by-example.org/ (+ `/llms.txt`, `/llms-full.txt`, raw `.md` pages) | Pool / notes / viewing-keys model, `privacy_invoke` anatomy, Wallet API + SDK docs, agent skill. |
| Anonymizer Contract Anatomy | https://strk20-by-example.org/helpers/privacy-invoke.md | `privacy_invoke` sandwich (pool withdraws → helper acts → approve pool → return `Span<OpenNoteDeposit>`), `INVOKE_SELECTOR`, one invoke/tx. |
| Starknet Wallet API | https://strk20-by-example.org/starknet-wallet-api/overview.md | Recommended route for private dapps; needs `starknet@^10.4.0` (ships on npm `next`; `latest` is 10.0.x without STRK20 APIs). |
| Agent skill | https://strk20-by-example.org/agent-skill.md | `npx skills add starkience/strk20-agent-skills`; never writes Cairo, never touches key material, testnet-first. |
| Privacy SDK (official monorepo) | https://github.com/starkware-libs/starknet-privacy | SDK `@starkware-libs/starknet-privacy-sdk` `0.14.3-rc.6`, depends on `starknet@10.5.0`; `packages/privacy` = pool contract (Apache-2.0). Workspace: edition `2024_07`, corelib `2.17.0`, `snforge_std 0.63.0`, `openzeppelin 3.0.0`. |
| Real `OpenNoteDeposit` | `packages/privacy/src/objects.cairo` | `#[derive(Serde, Copy, Drop, PartialEq, Debug)] struct OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }` — import it, never mirror it. |
| STRK20 Starter Kit | https://github.com/Akashneelesh/strk20-starter-kit | Next.js 16 / React 19 / TS / starknet.js 10 / zustand; `WalletAccountV6` + `get-starknet-discovery` v6; shield/unshield/private transfer/echo `privacy_invoke`. |
| Official mainnet example | https://github.com/starkience/strk20-tipjar-example | Real mainnet Wallet API integration; pool fee ~4 STRK, note maturity ~10 blocks, private actions emit no events (TUTORIAL.md). |
| Shadow-account starter | https://github.com/starkience/strk20-shadow-account-starter | Pinned Sepolia stack (SDK route + paymaster/prover/discovery), Sepolia gate passed 2026-09-02. |
| Hackathon repo | https://github.com/starkience/strk20-hackathon | `strk20.json` manifest rules; **verified mainnet pool address**; public/private facts table; private txs are relayer-submitted. |
| Releases | software-mansion/scarb, foundry-rs/starknet-foundry | Scarb **2.20.1** stable (has Windows msvc); snforge **0.63.0** stable (**no Windows binaries** → WSL). |

---

## 2. Selected integration route

**Route: `Starknet Wallet API` + a VERITY-owned anonymizer contract (`VerityAnonymizer`).**

This is the official "Build a private dapp" route (`Anonymizer contracts + the
Starknet Wallet API`), the one VERITY_SPEC.md §4 prefers
(`VERITY Frontend → Starknet Wallet API → STRK20 Privacy Infrastructure`).

**Why it is appropriate for VERITY**
1. VERITY is a *private dapp*, not a privacy wallet or prover operator.
2. The frontend never touches viewing keys, notes, or proofs — the user's
   STRK20-capable wallet handles proving/submission. VERITY must not rebuild
   wallet/proving/note infra STRK20 already provides.
3. Anonymizer contracts are the official mechanism for application-level
   STRK20 ops: the pool calls `privacy_invoke` on `VerityAnonymizer`
   atomically, the anonymizer calls `BountyManager`, and the pool credits real
   open notes via `Span<OpenNoteDeposit>`.
4. For plain private transfers (user→user), the same route's
   `strk20InvokeTransaction` flow is used with zero custom Cairo.

**Routes considered and rejected (for now)**
- *Privacy SDK direct (own keys/backend):* only if VERITY later needs a
  server-held key headless flow; not needed for core funding/payout (the
  wallet does it). Noted for Phase 1 probes (SDK is GitHub-Packages-only).
- *Own prover:* not needed; wallets reach the shared proving service.
- *Private sub-accounts:* "coming soon" per the hub; not a Phase 0 blocker.

---

## 3. Compatibility baseline (pinned, verified 2026-09-03)

| Component | Version | Source / note |
| --- | --- | --- |
| Node.js | **>=24** (dev: 24.20.0) | spec baseline; SDK/starter engines |
| pnpm | **10.34.5** | shadow-account starter pin |
| Scarb | **2.20.1** | current stable; satisfies snforge minimum |
| Starknet Foundry (snforge/sncast) | **0.63.0** | current stable; matches `snforge_std` pin in official privacy workspace |
| starknet.js | **10.5.0** (pinned, STRK20-capable) | official SDK dependency; never `latest` (10.0.x has no STRK20 API) |
| Privacy SDK `@starkware-libs/starknet-privacy-sdk` | **0.14.3-rc.6** | official monorepo `main`; GitHub Packages registry (not public npm) |
| Cairo corelib `starknet` | **2.17.0** | official privacy workspace pin (avoids skew when `privacy` dep is added in Phase 2) |
| `snforge_std` / `assert_macros` | **0.63.0 / 2.17.0** | official privacy workspace pins |
| OpenZeppelin Cairo | **3.0.0** | official privacy workspace pin; added when actually required |
| Cairo edition | **2024_07** | this workspace + official privacy workspace |
| get-starknet network | `@starknet-io/get-starknet-discovery@6.0.2`, `@starknet-io/get-starknet-wallet-standard@6.0.2`, `@starknet-io/types-js@0.10.3` | official starter kit pins |

---

## 4. Verified protocol addresses

| Network | Chain ID | Pool address | STRK token | RPC |
| --- | --- | --- | --- | --- |
| Mainnet | `SN_MAIN` `0x534e5f4d41494e` | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` (Day-0 verified) | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | `https://rpc.starknet.lava.build` |
| Sepolia | `SN_SEPOLIA` | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` (official starter pinned row) | same STRK address | `https://starknet-sepolia-rpc.publicnode.com` |

---

## 5. Required Starknet contracts (VERITY-owned)

- **`BountyManager`** — application/business logic: bounty lifecycle, funding
  credits, submissions, 13-verifier voting (7/13 winner), claimable payout.
  Must NOT contain STRK20 internals (VERITY_SPEC.md §6.1).
- **`VerityAnonymizer`** — STRK20/application boundary. Pool-only
  `privacy_invoke`, replay protection, `FundBounty` (Phase 3),
  `ReleaseToOpenNote` (Phase 5) returning real `privacy::objects::OpenNoteDeposit`.
- Users hold standard Starknet accounts (Wallet API route).

## 6. Required STRK20 contracts

- The live **STRK20 privacy pool** (addresses in §4). No other STRK20 protocol
  contract is required by VERITY. The anonymizer approves the pool for output
  tokens and the pool executes the pull. VERITY must NOT deploy or recreate
  pool-like primitives.

## 7. Required wallet capabilities

- STRK20 Wallet API support. Detect with `walletV6.supportedSpecs(...)`, never
  with a balance read (`wallet_strk20Balances` is probe-safe).
- Current support (official facts): **Ready (formerly Argent) works today**;
  Xverse in progress; **Braavos does not support STRK20**. Feature-gate the
  private path; BRAVOS users get the public path with honest copy.
- `Wallet API >= 0.10.3` capability set (tip-jar facts table).

## 8. Required APIs

- `starknet.js` v10: `WalletAccountV6`, `walletV6` (`requestAccounts`,
  `supportedSpecs`), `strk20InvokeTransaction`, STRK20 action types.
- `@starknet-io/get-starknet-discovery` (`createStore`, `Store`) + wallet-
  standard types for wallet discovery/picker.
- Cairo: `privacy_invoke` entrypoint; import `privacy::objects::OpenNoteDeposit`;
  return exactly `Span<OpenNoteDeposit>`; `INVOKE_SELECTOR` dispatch comes from
  the pool. Identity params (`app_name`, `nonce`) apply to hidden-caller
  (shadow) flows considered only if a headless path is needed later.

## 9. Known issues / limitations / blockers

1. **Pool economics:** flat pool fee per private op (~4 STRK mainnet at
   writing; read with `get_fee_amount`, never hardcode); notes mature ~10
   blocks (~20s mainnet). UI must reserve fee in MAX and show a countdown.
2. **No Windows snforge:** Cairo toolchain lives in WSL Ubuntu-24.04
   (pinned script: `scripts/setup-wsl-toolchain.sh`).
3. **Privacy SDK not on public npm** (GitHub Packages). The Wallet API route
   avoids it; any SDK probes (Phase 1) must vendor the SDK like the official
   shadow-account starter.
4. **Wallet-route dependence on third-party wallets;** Braavos users only get
   the public path. Honest copy required.
5. **starknet.js `latest` trap:** must stay pinned at >= 10.4 (VERITY: 10.5.0).
6. **Edges stay public:** deposits/withdrawals are public legs; deposit
   screening (FPI) is mandatory and signs every deposit. VERITY claims
   in-pool identity/amount privacy, never total invisibility.
7. **strk20.json obligations (hackathon):** >=3 successful mainnet txs that
   touched the pool; check `execution_status` (accepted != successful);
   never fabricate tx evidence.
8. **Sepolia pool values** come from the official starter's pinned row; Phase 1
   must reconfirm them live on-chain before any testnet evidence is claimed.