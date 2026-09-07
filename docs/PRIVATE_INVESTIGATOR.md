# Private Investigator Identity, Staking & Reputation

**Status:** implemented + locally verified (snforge 96 pass, node 50 pass,
tsc 0, next build 7/7). Sepolia redeploy pending (deployer short on STRK ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â
see ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§11).
**Scope:** STRK20 Wallet API route only (`starknet@10.5.0`, Wallet API
`0.10.3`). No invented protocol APIs.

---

## 1. What this is

An investigator participates under a **private identity commitment** instead
of their wallet address:

```text
PUBLIC WALLET
    ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“  STRK20 private flow (withdraw + invoke, pool hides the origin)
PRIVATE INVESTIGATOR IDENTITY  (Poseidon hash-chain tip, felt252)
    ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“
PRIVATE STAKE  (real STRK escrowed in VerityAnonymizer, keyed by identity)
    ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“
PRIVATE REPUTATION  (keyed by identity: 60 baseline, +10 win, ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¹ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢20 slash)
    ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“
ELIGIBLE / NOT ELIGIBLE  (the only thing the public app learns)
```

No stake record, reputation record, or submission record for a private
identity contains a wallet address. There is deliberately **no**
`wallet ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ reputation` mapping anywhere for private identities.

A plain hash of the wallet address is NOT used as the identity (it would be
trivially linkable). The identity is the genesis tip of a fresh random
Poseidon hash chain whose seed never leaves the investigator's device.

---

## 2. STRK20 components actually used

| Component | Use |
| --- | --- |
| `wallet_strk20InvokeTransaction` (`withdraw` + `invoke`) | Private stake: shielded STRK moves to the helper, then `STAKE_IDENTITY` escrows it under the commitment |
| `wallet_strk20InvokeTransaction` (`invoke` only) | Private submit (`SUBMIT_PRIVATE`) and payout-lock registration (`REGISTER_PAYOUT`) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â bare-invoke pattern proven by Gate 2 |
| `wallet_strk20InvokeTransaction` (`transfer OPEN` + `invoke`) | Private unstake (`UNSTAKE_IDENTITY`) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â same shape as the payout claim |
| `privacy_invoke` (pool ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ helper) | All four identity ops; pool-only auth + nonce replay protection, unchanged from funding |
| `privacy::objects::OpenNoteDeposit` (real type) | `UNSTAKE_IDENTITY` returns an exact-backed deposit (same pattern as `RELEASE`) |
| Poseidon (`poseidon_hash_span` / `computePoseidonHashOnElements`) | Hash chains; JSÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂCairo parity proven by shared vectors (snforge + node tests) |

The 6-argument `privacy_invoke` shape is **unchanged**: FUND/REFUND/RELEASE
calldata is byte-identical. Per-op slot semantics:

| op | bounty_id | amount | note_id slot | secret slot |
| --- | --- | --- | --- | --- |
| `STAKE_IDENTITY` | 0 | stake | 0 | identity commitment |
| `SUBMIT_PRIVATE` | bid | 0 | evidence hash | chain preimage |
| `REGISTER_PAYOUT` | bid | 0 | payout lock | chain preimage |
| `UNSTAKE_IDENTITY` | 0 | 0 | return note id | chain preimage |

The identity itself never travels in submit/register/unstake calldata: BM
resolves it via its tip index (`tip = Poseidon(preimage) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ owner`).

---

## 3. Hash-chain authorization

At stake time the device picks a random seed and registers
`identity = c_64` where `c_{k+1} = Poseidon(c_k)`, chain length 64. Each
submit / challenge / payout-register / unstake reveals the next unrevealed
preimage (`c_63`, `c_62`, ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦), which the contract verifies (`Poseidon(pre) ==
tip`) and consumes atomically by advancing the tip. Properties:

- The long-term seed is **never** on-chain; revealed preimages are single-use.
- Stealing requires the seed (or an unrevealed preimage) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â observing settled
  transactions gives an attacker nothing usable.
- Front-running a `STAKE_IDENTITY` commitment locks only the attacker's own
  funds under an identity they can never use (no seed ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ no auth).
- Chain exhaustion (64 actions) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ the investigator starts a new identity
  (reputation is non-transferable by design ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â that is what makes it
  unforgeable).

---

## 4. Reputation

| Event | Change | Bound |
| --- | --- | --- |
| private stake registration | `0 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ 60` | init |
| winner selected | `+10` | cap 100 |
| slash resolved | `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¹ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢20` | floor 0, identity flagged, escrow slashed to treasury |
| `set_minimum_reputation` | threshold (default 60, owner, ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤ 100) | enforced on every private submit |

`IReputationProvider` (`get_score` / `meets_threshold`) is **preserved** as
the integration boundary. Native identity reputation is the default (provider
address zero); when a provider is set, identities resolve through it with the
commitment cast as the key ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â so a future external provider (e.g. an Ethos
oracle attesting **commitments**, never wallets) plugs in via
`set_reputation_provider` with no contract changes.

---

## 5. What is public vs private (honest accounting)

**Public / observable:** the private transaction exists; its timing; the
fixed stake amount landing on the helper (1 STRK ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â no information); identity
commitments, evidence hashes, consumed preimages and reputation numbers in
settled calldata; tx senders of *direct* calls (challenge, creator/owner
actions).

**Private (pool-provided):** which wallet funded a stake; shielded balances;
in-pool movement. Pool-routed invokes (`STAKE`/`SUBMIT`/`REGISTER_PAYOUT`/
`UNSTAKE`) carry no wallet identity and are relayer-submitted, so no
walletÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢identity record exists anywhere to read.

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
- Official Starknet blog (2026-07-15): *"Coming next: private sub-accounts ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦
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
0ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“2800 default 1200 neutral). No Starknet contract, no production ZK
anonymous credential. Therefore:

1. No direct on-chain Ethos call exists to integrate (Cairo cannot HTTP).
2. `IReputationProvider` stays the seam; Verity-native runs now.
3. The documented future is an oracle attesting **commitments**
   (`commitment ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ score`), which the existing trait already supports
   (commitment cast as key). A direct `wallet ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ score` oracle would defeat the
   purpose and is explicitly rejected.

---

## 8. Threat model (what the tests prove)

- Observer cannot derive any wallet from stake/reputation/submission records
  (records hold commitments only; tests assert inequality with all wallets).
- Stake cannot be forged: pool-only entry + exact-amount rule + helper-side
  solvency check (`balance ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ held + amount`) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â unbacked stakes revert.
- Stake cannot be stolen: every movement needs an unrevealed chain preimage.
- Reputation cannot be copied: submitting/challenging as an identity needs its
  preimages; forgeries resolve to unknown tips and revert.
- Slashing is precise: dispute flow (report ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ optional challenge ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ resolve)
  touches exactly one identity; siblings verified unaffected.
- Creator cannot edit reputation except through reportÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢resolve (no direct
  write path exists; threshold changes are owner-only).
- Replay is dead: pool nonces + single-use preimages (both tested).
- Slashed identities can never re-stake, withdraw, or submit again.

---

## 9. Wallet / network support

Same as private funding: Ready (Wallet API ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ 0.10.3) on Sepolia
(pool `0x0254ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦`); pool fee (~2 STRK Sepolia) applies to every private
transaction including bare invokes ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â the UI says "a small privacy fee
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

~~BM + helper interfaces both changed — both must be redeclared/redeployed and
rewired (`set_anonymizer` / `set_bounty_manager`), then `CONTRACTS` +
`strk20.json` updated. Deployer `ready-sepolia` held **~20.69 STRK** at build
time — below the last observed declare cost (~34 STRK) — so the redeploy
needs a faucet top-up first. Old deployments stay live but are superseded
(new BM starts empty), following the established pattern.~~

**DEPLOYED 2026-09-07 (V3, Sepolia).** After the user topped up `ready-sepolia`
to ~113.17 STRK, the full sequence was executed and verified on-chain:

- BountyManager V3 `0x04315e84d96b7d0e4daf4d0ee0382d3951a4963a85d6b7572520cb4155135807`
  (class `0x448d50706a4bf5a0d9d1812ad114ba2e1a540b6092d5a58715c8ed2021e06cd`,
  declare `0x026191caae33f45de9a9d1fd9700045c2060c8a7a0a6fd1b640e8d280b043d7b`
  block 14704461 fee ~64.08 STRK; deploy
  `0x012250b3e36aa7a4ebe011d85cf976a4c611e7d4f94126f6659e4c49ce9edf05`
  block 14704479 fee ~0.106 STRK; constructor owner = deployer).
- VerityAnonymizer V3 `0x03602dc4f3a8bd209d47fca442c87f22151536e6ed7387b7025e92c4ebcf9682`
  (class `0x07977502e7870198401a84e86e876df781cf37082685b3a2ab1c513d8e1e65b6`,
  declare `0x039265ac7f350b744755b791342433f29caf57c51209214c0be5f4bf8076d532`
  block 14704506 fee ~22.71 STRK; deploy
  `0x061b7864144fb87a2021ee220964ce247b9b7859641c5c12c2985278c2367c37`
  block 14704524 fee ~0.094 STRK; constructor
  `(pool 0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91,
  new BM, owner 0xdc46...ca5, 0x0 = protocol STRK)`).
- Wiring: `set_anonymizer` (`0x04bacc91d9f9c6aa45521283abfb37c47e7ea9806205e74dcabe6923158a4357`,
  block 14704536) + `set_bounty_manager`
  (`0x050d60385f7c191d80cf58ad48f94c427a1350a1623a46747443fee49e8ebc1b`,
  block 14704552); all 6 txs ACCEPTED_ON_L2 + Succeeded.
- Verified reads: `get_anonymizer` = helper, `get_bounty_manager` = BM,
  `get_pool` = `0x0254...`, `get_strk_token` = `0x04718...` (the `0x0`
  constructor arg correctly resolved to the protocol STRK constant),
  versions `VERITY_BOUNTY_MANAGER_V2` / `VERITY_ANONYMIZER_V2`.
- `CONTRACTS` + `strk20.json` updated to V3. Total spend ~87.07 STRK;
  deployer remainder ~26.10 STRK. Old V2 deployments stay live but are
  superseded (new BM starts empty), following the established pattern.

---

## 12. Creator edge audit (per-edge answers)

Scope: alias bounties on the new deployment. Legacy bounties keep the
wallet-linked behavior below marked LEGACY.

1. create bounty: pool-routed CREATE invoke carries (reward, metadata,
   alias). Public: tx existence, timing, reward, metadata hash, alias
   commitment. Wallet link: NONE - no wallet field anywhere; tx is
   relayer-submitted. STRK20 breaks it: yes (origin hidden by the
   private tx). Frontend: shows no wallet (alias only). Events:
   PrivateBountyCreated carries alias, never a wallet.
2. creator identity: Poseidon chain genesis, random 251-bit seed,
   device-held. NOT derived from the wallet (crypto.getRandomValues).
   Cannot be regenerated by others; hash of wallet is never used.
3. fund: withdraw leg (sender hidden) + FUND invoke (bounty, amount,
   secret). Public: helper receives fixed reward (amount is public but
   fixed), timing. Wallet link: only via timing heuristics. Funding
   secret is bearer auth, single-use, consumed atomically.
4. open/select/report/resolve: direct calls from ANY account with a
   consuming preimage. Public: tx sender address (irrelevant - anyone
   may relay), alias, action. Wallet link: NONE by protocol; a creator
   relaying from their main wallet links it by their own choice
   (documented; use a fresh/relayed account for full unlinkability).
5. review/select: same as (4). Winner recorded as investigator
   commitment-cast, never a wallet.
6. refund: helper REFUND op (refund_secret bearer auth) transfers escrow
   to the bound payout_address on a PUBLIC transfer. Wallet link: the
   payout address is creator-chosen and public by necessity (withdraw
   edges are inherently public in STRK20). Use a fresh address.
7. frontend/URL: no wallet shown for alias bounties (alias #xxxx only);
   URLs carry bounty ids only; console diagnostics log public tx data
   (never seeds/preimages).
8. explorer: direct creator calls show SOME sender address (public
   chain), but it is unattributed - any account relays the same call.
   The link sender->alias forms only if the creator reuses one wallet
   everywhere (operational, not protocol).

---

## 13. Payout privacy audit (investigator reward path)

winner (commitment-cast, public pseudonym)
  -> payout lock = Poseidon(payout_secret): NO address inside
  -> RELEASE invoke carries (bounty, amount, note_id, secret): the note
     is fresh, created by the winner's own shielded transfer-OPEN leg;
     observer sees deposit(N, X) with N unattributed (relayer-submitted)
  -> winner spends note N later via viewing key: private until they
     withdraw to a public address (their choice, inherently public).

Linkage verdict: payout destination (the eventual public withdraw
address) CAN be linked to amount/timing, and the winner pseudonym to
its submission/reputation/stake history (by design: reputation must
attach to SOMETHING). What it can NOT be linked to by protocol is the
winner's main wallet - unless the winner reuses one address for the
OPEN leg, the withdraw, and other activity (operational choice).
Legacy direct register/claim calls DO link the winner wallet publicly;
private winners must use the pool-routed REGISTER_PAYOUT + RELEASE path
(the UI branches on this). No full-anonymity claim is made.

Future path preserved: a private-subaccount/ZK payout rail plugs in
behind the same payout-lock boundary (lock commits to a secret, not an
address), with no BM redesign.

---

## 14. Identity security checklist (hash-chain implementation)

- Seed never on-chain: chain holds tips/commitments/locks (hashes) and
  consumed single-use preimages only. Verified by code inspection +
  tests asserting records contain no wallet data.
- Seed not wallet-derived: crypto.getRandomValues 251-bit; integrity
  check recomputes genesis on load.
- No wallet persisted alongside identity: StoredIdentity/StoredCreator =
  {seed, commitment, nextK} only.
- Unregenerable by others: 2^251 seed space; preimage knowledge required
  for every state change.
- Continuity: localStorage + chain-tip views resync; out-of-sync surfaces
  as BAD_PREIMAGE with guidance (never silent).
- No impersonation: every protected entry verifies Poseidon(pre)==tip.
- No reuse: tip advances atomically per use; helper nonces are
  replay-protected; both proven by snforge replay tests.
- New identity restarts reputation: YES (see 15 - economic rate limit,
  not cryptographic prevention).
- Stake bound to identity: escrow map keyed by commitment; exact-amount
  + solvency checks; slash zeroes exactly one identity.
- Slash history sticks: slashed flag + rep persist; re-stake refused.
- Custody limitation (documented): seed loss strands the stake/alias
  control (same class as lost funding secrets). No recovery backdoor.

---

## 15. Sybil resistance (honest accounting)

Current protection is ECONOMIC, not cryptographic:
- Each identity costs a real 1 STRK stake + pool fees per private action
  (~2 STRK on Sepolia) + wallet registration + shielding costs.
- Slashed stake is forfeited to treasury; a new identity pays full cost
  again and restarts at 60 with no history.
- New-identity submissions are Pending like any other; winning requires
  fooling the creator, who can report/slash within the dispute flow.

NOT prevented: 60 -> misbehave -> slash -> discard -> fresh 60, at
~3+ STRK per cycle. This is documented, not hidden. No Sybil-resistance
claim is made for anonymous reputation.

Future path: ZK credentials / stake-weighted reputation / external
attestations via IReputationProvider (commitment-keyed), and
private sub-accounts when the wallet stack supports them.

---

## 16. STRK20 vs Verity responsibilities

STRK20 provides: shielded balances, private transfers, private
application flows, encrypted notes, ZK-backed private transactions,
scoped viewing/disclosure. It does NOT provide: anonymous Verity
identities, anonymous reputation, Sybil-resistant anonymous
credentials, arbitrary private application state. Those are Verity
protocol responsibilities, implemented above with no-homemade
cryptography (Poseidon hash chains over the pool's private flows) and
explicitly documented limitations.
