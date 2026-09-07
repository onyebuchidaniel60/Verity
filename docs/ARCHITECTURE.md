# VERITY Architecture

Canonical architecture source: [`VERITY_SPEC.md`](../VERITY_SPEC.md). This
document is the working summary; when in doubt, the spec wins.

## 1. System diagram

```text
                    VERITY
                       │
          ┌────────────┴────────────┐
     APPLICATION                 PRIVACY
          │                         │
          ▼                         ▼
  BountyManager                 STRK20
          │                         │
          │                         │
          ▼                         ▼
 VerityAnonymizer ◀──── privacy_invoke ──── Privacy Pool
```

The fundamental loop:

```text
REQUESTER → STRK20 (private funding) → VERITY BOUNTY → INVESTIGATORS
  → (private stake + private reputation → eligible) → EVIDENCE
  → CREATOR review → WINNER → CLAIMABLE → STRK20 (private payout)
```

There are no verifiers and no voting: the creator reviews and selects the
winner. (Earlier revisions of this file described a 13-verifier / 7-of-13
model; that was removed — see docs/AI_HANDOFF.md §§28–29.)

## 2. Contracts

| Contract | Role | STRK20 responsibility |
| --- | --- | --- |
| `BountyManager` | All bounty *business logic* (create, credits, submissions, winner, claimable state, staking + reputation eligibility). | None — no ZK, notes, viewing keys, private balances, proof generation (SPEC §6.1). |
| `VerityAnonymizer` | The STRK20/application boundary; deliberately small (SPEC §10). | Pool-only authorization, replay protection, `FundBounty`, `ReleaseToOpenNote`, investigator-identity ops (`STAKE_IDENTITY`, `SUBMIT_PRIVATE`, `REGISTER_PAYOUT`, `UNSTAKE_IDENTITY`), per-identity STRK escrow, approve pool, return real `privacy::objects::OpenNoteDeposit`. |

## 2.1 Private investigator identity (docs/PRIVATE_INVESTIGATOR.md)

```text
PUBLIC WALLET → STRK20 private flow → IDENTITY COMMITMENT (felt252)
  → private stake (real STRK escrow, helper-held, identity-keyed)
  → private reputation (60 / +10 / −20, identity-keyed)
  → eligibility proof → private submit / challenge / payout-register / unstake
```

- Identity = genesis tip of a Poseidon hash chain (seed device-only);
  per-action preimages are single-use auth. No wallet→identity record exists.
- BM owns identity auth/reputation/eligibility; the helper owns STRK escrow.
  They call each other over the established pool-routed callback pattern.
- `IReputationProvider` remains the external-reputation seam (commitment-keyed
  when a provider is set). Legacy wallet-keyed staking/submission paths are
  frozen for compatibility.

## 3. Private funding flow (Phase 3 target)

```text
Requester
  → STRK20 private operation (wallet)
  → Privacy Pool
  → privacy_invoke
  → VerityAnonymizer (pool-only auth, validate, replay-proof)
  → FundBounty
  → BountyManager credit → FUNDED
```

## 4. Private payout flow (Phase 5 target)

```text
BountyManager: winner selected → CLAIMABLE (entitlement)
  → Winner STRK20 private op
  → Privacy Pool
  → privacy_invoke
  → VerityAnonymizer ReleaseToOpenNote
     (validate winner + amount, replay-proof, debit credit, approve pool)
  → real OpenNoteDeposit
  → pool credits open note
  → Winner private STRK20 note/balance → PAID
```

**Settlement vs value movement is kept separate** (SPEC §17): BountyManager
decides WHO is entitled; STRK20 moves value privately.

## 4.1 Structural note (Phase 0)

The plan/spec layout listed both a root `Scarb.toml` and `contracts/Scarb.toml`.
Scarb (like Cargo) forbids a package in two workspaces / nested workspaces over
same members, so Phase 0 uses a **single workspace at the repository root**.
Contract packages remain `contracts/bounty_manager` and `contracts/verity_anonymizer`.
No architecture change — layout only.

## 5. Privacy boundary rules

- STRK20 owns privacy; the app never substitutes local structures for STRK20
  protocol objects.
- Private funding/payout must actually traverse the real pool; public ERC20
  transfers are never described as private.
- Compilation/tests/frontend displays are never evidence of integration.