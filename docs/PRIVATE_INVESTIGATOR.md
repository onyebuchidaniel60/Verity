# Private Investigator Identity, Staking & Reputation

**Status:** implemented + locally verified (snforge 96 pass, node 50 pass,
tsc 0, next build 7/7). Sepolia redeploy pending (deployer short on STRK Ã¢â‚¬â€
see Ã‚Â§11).
**Scope:** STRK20 Wallet API route only (`starknet@10.5.0`, Wallet API
`0.10.3`). No invented protocol APIs.

---

## 1. What this is

An investigator participates under a **private identity commitment** instead
of their wallet address:

```text
PUBLIC WALLET
    Ã¢â€ â€œ  STRK20 private flow (withdraw + invoke, pool hides the origin)
PRIVATE INVESTIGATOR IDENTITY  (Poseidon hash-chain tip, felt252)
    Ã¢â€ â€œ
PRIVATE STAKE  (real STRK escrowed in VerityAnonymizer, keyed by identity)
    Ã¢â€ â€œ
PRIVATE REPUTATION  (keyed by identity: 60 baseline, +10 win, Ã¢Ë†â€™20 slash)
    Ã¢â€ â€œ
ELIGIBLE / NOT ELIGIBLE  (the only thing the public app learns)
```

No stake record, reputation record, or submission record for a private
identity contains a wallet address. There is deliberately **no**
`wallet Ã¢â€ â€™ reputation` mapping anywhere for private identities.

A plain hash of the wallet address is NOT used as the identity (it would be
trivially linkable). The identity is the genesis tip of a fresh random
Poseidon hash chain whose seed never leaves the investigator's device.

---

## 2. STRK20 components actually used

| Component | Use |
| --- | --- |
| `wallet_strk20InvokeTransaction` (`withdraw` + `invoke`) | Private stake: shielded STRK moves to the helper, then `STAKE_IDENTITY` escrows it under the commitment |
| `wallet_strk20InvokeTransaction` (`invoke` only) | Private submit (`SUBMIT_PRIVATE`) and payout-lock registration (`REGISTER_PAYOUT`) Ã¢â‚¬â€ bare-invoke pattern proven by Gate 2 |
| `wallet_strk20InvokeTransaction` (`transfer OPEN` + `invoke`) | Private unstake (`UNSTAKE_IDENTITY`) Ã¢â‚¬â€ same shape as the payout claim |
| `privacy_invoke` (pool Ã¢â€ â€™ helper) | All four identity ops; pool-only auth + nonce replay protection, unchanged from funding |
| `privacy::objects::OpenNoteDeposit` (real type) | `UNSTAKE_IDENTITY` returns an exact-backed deposit (same pattern as `RELEASE`) |
| Poseidon (`poseidon_hash_span` / `computePoseidonHashOnElements`) | Hash chains; JSÃ¢â€ â€Cairo parity proven by shared vectors (snforge + node tests) |

The 6-argument `privacy_invoke` shape is **unchanged**: FUND/REFUND/RELEASE
calldata is byte-identical. Per-op slot semantics:

| op | bounty_id | amount | note_id slot | secret slot |
| --- | --- | --- | --- | --- |
| `STAKE_IDENTITY` | 0 | stake | 0 | identity commitment |
| `SUBMIT_PRIVATE` | bid | 0 | evidence hash | chain preimage |
| `REGISTER_PAYOUT` | bid | 0 | payout lock | chain preimage |
| `UNSTAKE_IDENTITY` | 0 | 0 | return note id | chain preimage |

The identity itself never travels in submit/register/unstake calldata: BM
resolves it via its tip index (`tip = Poseidon(preimage) Ã¢â€ â€™ owner`).

---

## 3. Hash-chain authorization

At stake time the device picks a random seed and registers
`identity = c_64` where `c_{k+1} = Poseidon(c_k)`, chain length 64. Each
submit / challenge / payout-register / unstake reveals the next unrevealed
preimage (`c_63`, `c_62`, Ã¢â‚¬Â¦), which the contract verifies (`Poseidon(pre) ==
tip`) and consumes atomically by advancing the tip. Properties:

- The long-term seed is **never** on-chain; revealed preimages are single-use.
- Stealing requires the seed (or an unrevealed preimage) Ã¢â‚¬â€ observing settled
  transactions gives an attacker nothing usable.
- Front-running a `STAKE_IDENTITY` commitment locks only the attacker's own
  funds under an identity they can never use (no seed Ã¢â€ â€™ no auth).
- Chain exhaustion (64 actions) Ã¢â€ â€™ the investigator starts a new identity
  (reputation is non-transferable by design Ã¢â‚¬â€ that is what makes it
  unforgeable).

---

## 4. Reputation

| Event | Change | Bound |
| --- | --- | --- |
| private stake registration | `0 Ã¢â€ â€™ 60` | init |
| winner selected | `+10` | cap 100 |
| slash resolved | `Ã¢Ë†â€™20` | floor 0, identity flagged, escrow slashed to treasury |
| `set_minimum_reputation` | threshold (default 60, owner, Ã¢â€°Â¤ 100) | enforced on every private submit |

`IReputationProvider` (`get_score` / `meets_threshold`) is **preserved** as
the integration boundary. Native identity reputation is the default (provider
address zero); when a provider is set, identities resolve through it with the
commitment cast as the key Ã¢â‚¬â€ so a future external provider (e.g. an Ethos
oracle attesting **commitments**, never wallets) plugs in via
`set_reputation_provider` with no contract changes.

---

## 5. What is public vs private (honest accounting)

**Public / observable:** the private transaction exists; its timing; the
fixed stake amount landing on the helper (1 STRK Ã¢â‚¬â€ no information); identity
commitments, evidence hashes, consumed preimages and reputation numbers in
settled calldata; tx senders of *direct* calls (challenge, creator/owner
actions).

**Private (pool-provided):** which wallet funded a stake; shielded balances;
in-pool movement. Pool-routed invokes (`STAKE`/`SUBMIT`/`REGISTER_PAYOUT`/
`UNSTAKE`) carry no wallet identity and are relayer-submitted, so no
walletÃ¢â€ â€™identity record exists anywhere to read.

**NOT claimed:** absolute unlinkability. Timing/amount correlation heuristics
remain possible (same as funding). Challenge calls are direct (any account may
relay; preimage is the auth) so disputing investigators who care about
unlinkability should relay from a fresh account. Creator self-submission via a
private identity cannot be excluded on-chain without breaking investigator
privacy; it is economically irrational (stake + pool fees exceed any gain).

---

## 6. Why not shadow / sub-accounts (verified 2026-09-07)

- Installed Wallet API `0.10.3` + `starknet@10.5.0` expose only
  `deposit | withdraw | transfer | invoke`. No sub-account primitive exists in
  the SDK (verified by source inspection).
- Official Starknet blog (2026-07-15): *"Coming next: private sub-accounts Ã¢â‚¬Â¦
  Not live yet; wallet and SDK support are still landing."*
- The pinned pool source (`bc75e4b`) DOES contain
  `privacy_invoke_with_computation` + a `shadow_account_anonymizer` package,
  but nothing in the current wallet/SDK stack can drive it, and deployed-pool
  support is unverified. Building on it now would be dead, unaudited code.
- **Upgrade path:** when a compute-capable wallet/SDK lands, add a
  `privacy_invoke_with_computation` helper that binds shadow-account
  interactions to these same identity commitments. No BM redesign needed: the
  commitment is already the stable pseudonym.

---

## 7. Ethos / external reputation (verified 2026-09-07)

Ethos is EVM/Base-only (REST `api.ethos.network`, EVM-address keys, scores
0Ã¢â‚¬â€œ2800 default 1200 neutral). No Starknet contract, no production ZK
anonymous credential. Therefore:

1. No direct on-chain Ethos call exists to integrate (Cairo cannot HTTP).
2. `IReputationProvider` stays the seam; Verity-native runs now.
3. The documented future is an oracle attesting **commitments**
   (`commitment Ã¢â€ â€™ score`), which the existing trait already supports
   (commitment cast as key). A direct `wallet Ã¢â€ â€™ score` oracle would defeat the
   purpose and is explicitly rejected.

---

## 8. Threat model (what the tests prove)

- Observer cannot derive any wallet from stake/reputation/submission records
  (records hold commitments only; tests assert inequality with all wallets).
- Stake cannot be forged: pool-only entry + exact-amount rule + helper-side
  solvency check (`balance Ã¢â€°Â¥ held + amount`) Ã¢â‚¬â€ unbacked stakes revert.
- Stake cannot be stolen: every movement needs an unrevealed chain preimage.
- Reputation cannot be copied: submitting/challenging as an identity needs its
  preimages; forgeries resolve to unknown tips and revert.
- Slashing is precise: dispute flow (report Ã¢â€ â€™ optional challenge Ã¢â€ â€™ resolve)
  touches exactly one identity; siblings verified unaffected.
- Creator cannot edit reputation except through reportÃ¢â€ â€™resolve (no direct
  write path exists; threshold changes are owner-only).
- Replay is dead: pool nonces + single-use preimages (both tested).
- Slashed identities can never re-stake, withdraw, or submit again.

---

## 9. Wallet / network support

Same as private funding: Ready (Wallet API Ã¢â€°Â¥ 0.10.3) on Sepolia
(pool `0x0254Ã¢â‚¬Â¦`); pool fee (~2 STRK Sepolia) applies to every private
transaction including bare invokes Ã¢â‚¬â€ the UI says "a small privacy fee
applies" instead of quoting internals. Braavos and non-STRK20 wallets keep
the public (legacy) staking path, which is frozen but functional.

---

## 10. Private creator identity (creator alias)

Creators get the same hash-chain architecture in a separate namespace
(creators carry no reputation score, only control auth):

- Creation is pool-routed: CREATE_BOUNTY bare invoke
  (reward, metadata_hash, creator_alias) assigns the next id. The bounty
  records NO creator wallet: `creator` holds the alias cast as an address
  (pseudonym), shown as Anonymous Creator #xxxx on the bounty page and list.
  Legacy create_bounty is frozen for legacy bounties.
- Control auth is per-action preimages: open_bounty_private,
  select_winner_private, report_private, resolve_report_private (direct
  calls from any account, sender irrelevant). Setup ops (set_payout_address,
  the set_locks alias branch) verify non-consumingly.
- Value still needs a real address: the creator binds a self-chosen
  payout_address pre-funding (refunds land there; withdraw edges are
  inherently public, so the UI recommends a fresh address). Helper REFUND
  pays get_payout_recipient (payout or legacy creator: identical behavior
  for legacy bounties).
- Creator-exclusion preserved: legacy submit_investigation reverts on alias
  bounties (USE_PRIVATE_SUBMIT). Legacy report/select/resolve are
  unreachable there (caller can never be the cast address); the owner
  backstop is retained on both paths.
- Known footgun (documented): direct non-helper refunds on FUNDED bounties
  strand escrow in the helper. The UI only offers helper-routed refunds;
  no direct refund_bounty_private entry exists for this reason.

Latent bug found and fixed during this work: refund_bounty previously
accepted only creator-or-owner as caller, but the pool-routed helper REFUND
op calls it with caller == helper, so EVERY real wallet-signed refund would
have reverted NOT_CREATOR on-chain. Proven by a new regression test
(test_refund_via_helper_caller_succeeds); fixed by accepting the helper
caller (which verified the single-use refund secret first) on both paths.

---

## 11. Files (updated)

- Contracts: BM (identity + creator-alias entries, shared lifecycle
  internals, Submission.identity, Bounty creator_alias/payout_address),
  helper (STAKE/SUBMIT/REGISTER_PAYOUT/UNSTAKE/CREATE ops, stake escrow,
  slash_stake, payout-recipient REFUND, 4-arg set_locks).
- Tests: BM private_identity_test (19) + creator_alias_test (16) + e2e
  (+1 helper-refund regression) + callback-shape (+2); helper stake_test
  (24) + creator_test (12) + funding_test (4-arg locks, payout MockBM).
- Frontend: identity-pure (investigator + creator chains, CREATE builder,
  submitGate), identity.regression.test (23), bounty detail (eligibility
  gate, private investigator + creator flows, alias display), bounties
  list (alias byline), create page (private creation, payout address,
- Economics unchanged: stake 1 STRK, min rep 60, +10/-20, fee 500 bps.

---

## 11. Deployment note

BM + helper interfaces both changed Ã¢â€ â€™ both must be redeclared/redeployed and
rewired (`set_anonymizer` / `set_bounty_manager`), then `CONTRACTS` +
`strk20.json` updated. Deployer `ready-sepolia` held **~20.69 STRK** at build
time Ã¢â‚¬â€ below the last observed declare cost (~34 STRK) Ã¢â‚¬â€ so the redeploy
needs a faucet top-up first. Old deployments stay live but are superseded
(new BM starts empty), following the established pattern.
