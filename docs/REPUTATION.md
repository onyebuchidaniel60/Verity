# Verity Anonymous Reputation — Architecture & External Provider Research

**Date:** 2026-09-07  
**Status:** `VerityNativeReputationProvider` live in `BountyManager` (internal `Map<ContractAddress, u64>` 0–100); `IReputationProvider` abstraction ready for external plug-in. `EthosReputationProvider` investigated — not natively Starknet-compatible, would require oracle/attestation.

---

## 1. Requirement (spec §5–9)

Investigators build reputation **without revealing real identity**:

```
Anonymous Investigator
        ↓
Private reputation credential / proof
        ↓
Meets minimum_reputation_score ?
        ↓
YES → may submit
NO  → cannot submit
```

* Reputation must be queryable by `BountyManager` to gate `submit_investigation`.
* Must not link `wallet address → public profile` in normal UI.
* Must evolve: wins +10, slash –20, stake gives 60 baseline, external signals future.

---

## 2. Abstraction

```cairo
#[starknet::interface]
pub trait IReputationProvider<T> {
    fn get_score(self: @T, account: ContractAddress) -> u64;
    fn meets_threshold(self: @T, account: ContractAddress, threshold: u64) -> bool;
}
```

`BountyManager` storage:

```cairo
reputation: Map<ContractAddress, u64>,          // internal native (0–100)
minimum_reputation: u64,                        // configurable, default 60
reputation_provider: ContractAddress,           // 0 = use internal native
```

`_get_reputation(account)` in `bounty_manager.cairo:298`:
```cairo
if provider.is_non_zero() { IReputationProviderDispatcher{contract_address: provider}.get_score(account) }
else { self.reputation.read(account) }
```

This keeps the first deployment self-contained while an external provider can be plugged later via `set_reputation_provider(provider)` (owner only). No change to `submit_investigation` call sites.

---

## 3. VerityNativeReputationProvider (current)

Implemented **inside** `BountyManager` for the hackathon (no extra deployment, no cross-contract call overhead):

| Event | Score change | Cap/floor |
|---|---|---|
| `stake()` first time | `0 → 60` | init, `emit ReputationUpdated(0→60, 'INITIAL_STAKE')` |
| `select_winner` winner | `+10` | cap 100, `emit ReputationUpdated(old→new, 'WIN_SELECTED')` |
| `report_submission` → `slash` | `-20` | floor 0, `emit ReputationUpdated(old→new, 'SLASHED')` + `Slashed` + `is_slashed` flag |

* `get_reputation` returns `internal` when `reputation_provider == 0`.
* `minimum_reputation` defaults `60`, changeable via `set_minimum_reputation(threshold)` (owner, `<=100`).
* `get_reputation` is `view`, cheap, used in `submit_investigation`:

```cairo
assert(rep >= min_rep, 'REPUTATION_TOO_LOW');
```

Frontend shows pseudonymous `Anonymous Investigator #A7F3` (hash of address, `bounty/[id]/page.tsx:28` `normalizeAddr` → `BigInt` → `toString(16).slice(-4)`) with `Reputation 87 / 100`, `Status Eligible`, `Investigations/Wins/Slashed` — not wallet address.

Staking: fixed `stake_amount` (`1 STRK = 1000000000000000000`, `set_stake_amount` owner, `stake()` → `has_staked=true`, `stake_balances[account]=amount`, `emit Staked`). `submit_investigation` checks `has_staked` + `!is_slashed` + `rep >= threshold`. Slashed investigators cannot stake again (`IS_SLASHED_CANNOT_STAKE`).

---

## 4. External Provider Research — Ethos

### What was investigated

* Ethos docs: `docs.ethos.network`, `ethos.network`, `explorer.ethos.network`, `api.ethos.network/v1`, `Ethos` credibility scores, on-chain attestations, `Ethos` SDK (`@ethos` npm not Starknet-native).
* Ethos currently: EVM-centric (Base/Ethereum), stores protocol interactions onchain (attestations, vouches, reviews), computes credibility `0–1000`+ via signals (account age, vouches, slashes), profile via EVM address. Future docs discuss pseudonymity & ZK anonymous reviews (not yet production ZK credential).

### What information can be queried?

* **Yes, via Ethos API:** `GET /api/v1/profile/{evmAddress}` → `{ credibilityScore, vouches, reviews, attestations }` . Example: `curl https://api.ethos.network/api/v1/profile/0x...` returns JSON with `score`.
* **On-chain:** Ethos `Attestation` contracts on Base (EVM), not Starknet. No Starknet contract to call directly via `IReputationProvider` without bridge.

### Is there a wallet/profile reputation score?

* Yes, Ethos credibility score (0–~2000, tiered). Not 0–100, would need normalization `ethosScore / 20 → 0–100`.

### Can the score be proven without exposing identity?

* **Today: No.** Ethos API requires EVM address → reveals identity. Docs mention “ZK-based anonymous reviews” as future, not a current primitive where you prove `score ≥ threshold` without revealing address via ZK. Would need a ZK credential (e.g., Semaphore/issuer issues `score ≥ X` proof) — Ethos does not yet issue such ZK credentials for Starknet.

### Can a ZK proof/credential be built around the reputation?

* **Conceptually yes, practically not without new issuer.** You could have an issuer (Ethos or Verity) that signs `score` and the investigator proves in ZK `score ≥ threshold` via `starknet-privacy` or `Cairo` proof, but Ethos does not currently provide that issuer service for Starknet. Would need a custom `Ethos` → `Starknet` oracle that fetches Ethos score, verifies, and issues a Starknet-valid attestation (e.g., via `Herodotus` or `Lagrange` oracle, or a trusted `EthosReputationProvider` that stores a Merkle root of scores and verifies a ZK proof of inclusion). This is the “oracle/attestation layer”.

### Can the threshold be verified by a Verity contract?

* **With oracle: Yes.** `EthosReputationProvider` (Starknet contract) could hold `ethos_root` or `oracle_address`, verify a proof: `verify_ethos_proof(proof, account_commitment, threshold)`. The investigator would submit a ZK proof that their Ethos score (off-chain) meets threshold without revealing EVM address. The contract would only see the proof + commitment, not the address. This is feasible but requires building the oracle + circuit.

### Is there a practical Starknet-compatible integration?

* **No, not now without oracle.** Ethos has no Starknet deployment, no Cairo SDK, no Starknet `get_score` contract to call directly. A direct `IReputationProvider` that does `ethos_api.get_score(evmAddress)` cannot be done on-chain (no HTTP in Cairo). So the only practical path today is **off-chain oracle → on-chain attestation**.

### Would an oracle/attestation layer be required?

* **Yes.** Practical options:
  1. **Trusted oracle:** Verity backend periodically fetches Ethos scores, signs `score` per Starknet address, stores `signed_score` on `EthosReputationProvider`, which `BountyManager` reads.
  2. **ZK oracle:** Investigator fetches Ethos score, generates ZK proof `score ≥ threshold` (using e.g., `Noir`/`Cairo` circuit that verifies Ethos API signature), submits proof to `BountyManager`, which verifies via `verify_proof`.
  3. **L2 attestation:** Bridge Ethos attestations from Base to Starknet via `Starknet` messaging, then verify.

All require new development beyond the current hackathon scope.

### What are the privacy implications?

* **Direct Ethos API:** Reveals EVM address + Starknet address link → defeats anonymity.
* **Oracle with ZK:** Preserves anonymity if proof is over a commitment (e.g., `hash(EVM address, Starknet address, salt)`) — the contract learns only that *some* eligible investigator submitted, not which one. Without ZK, the oracle learns the link.

---

## 5. Decision

* **Phase 1:** Ship `VerityNativeReputationProvider` inside `BountyManager` (no external call, no oracle, no EVM dependency). This satisfies the spec’s “one meaningful fixed stake → many submissions”, `minimum_reputation_score` gate, and reputation evolution. It is Starknet-native, cheap, and testable (`snforge 18 passed`).
* **Phase 2 (plug-in):** Keep `IReputationProvider` storage + `set_reputation_provider`. A future `EthosReputationProvider` contract can be deployed that implements `get_score` via oracle/attestation as above, then `BountyManager` owner calls `set_reputation_provider(ethos_provider_address)`. No change to `BountyManager` logic, only the provider address. Documented here so the next agent knows exactly where to plug it.

---

## 6. Reputation Threshold

* `minimum_reputation_score` stored as `minimum_reputation: u64` (default 60, owner `set_minimum_reputation` ≤100, event `ReputationThresholdUpdated`).
* Frontend: `BountyManager.get_minimum_reputation()` → “Eligibility” UI: `✓ Reputation requirement met (60)`, `Your reputation 54 → You need a higher score...` (see `apps/web/app/bounty/[id]/page.tsx:380` eligibility panel). No `ABI`/`felt` exposed.

---

## 7. Reputation After Submissions

Current native model (transparent, extensible):

```
Previous wins: +10 per win (cap 100)
Rejected (not winner): 0 (no change, but could be –3 in future)
Reported → Slashed: –20 (floor 0), is_slashed=true, cannot re-stake
Stake: 0→60 initial
```

Future extensible fields already in `types.cairo:Report` and `BountyManager` storage (`reputation`, `has_staked`, `is_slashed_map`) to incorporate `Previous successful investigations`, `Bounty wins`, `Creator ratings`, `External reputation`, `Account age` without breaking the interface. `VerityNativeReputationProvider` can be upgraded to weight these via `update_reputation(account, delta, reason)`.

---

## 8. Privacy Requirement

* `BountyManager` stores `investigator: ContractAddress` privately in `submissions` map — not displayed as wallet address in normal UI. Frontend derives `Anonymous Investigator #A7F3` via `normalizeAddr(address) → BigInt → hex.slice(-4)` and shows only that + reputation, not `0x...`.
* STRK20 private funding/payout preserved via `VerityAnonymizer` (pool `0x0254…`, `privacy_invoke` → `fund_bounty`/`claim_payout` with `Span<OpenNoteDeposit>`). Staking is currently public (for hackathon simplicity) but the architecture notes that `stake()` could be made private via the same `VerityAnonymizer` pattern (private stake note) without changing the reputation interface — just change `stake()` to go through `privacy_invoke` like funding does.

---

## 9. Conclusion

* **Ethos is not directly plug-and-play for Starknet anonymous reputation today.** It can be integrated **only via an oracle/attestation + ZK layer**, which is documented here as the next step.
* **VerityNative** provides the required `“reputation while anonymous”` primitive now, with a clean `IReputationProvider` seam for Ethos later. This is the recommended hackathon submission path, honest about limitations, no fake privacy claims.
