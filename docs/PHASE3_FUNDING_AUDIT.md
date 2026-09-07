# VERITY Phase 3 — Private Funding Architecture Audit

**Status:** protocol-design checkpoint. NO code changed in this audit.
**Pinned revision:** `starknet-privacy bc75e4b` (the exact rev VERITY compiles
against). **Deployed Sepolia pool:**
`0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`.
**BountyManager V2:** `0x03643a1e507bc076e6831b31be17f08bc9c1487583c55af313bc17958e9c4b54`
(unchanged by this proposal). **Helper:** `0x04b93a…` (to be superseded).

Sources read at the pinned rev: `packages/privacy/src/privacy.cairo`
(`_apply_invoke_and_deposits`, `_deposit_to_open_note`, screening, fees),
`packages/privacy/src/objects.cairo` (`OpenNoteDeposit`, screening default),
`packages/ekubo_swap_anonymizer` + `packages/vesu_lending_anonymizer`
(canonical helper pattern), starknet-js WalletAccount docs (invoke-helper
convention, OPEN semantics, fee behavior). Live Sepolia reads: pool
`get_version`/`get_fee_amount`/`get_open_note_screening_policy`, helper
STRK balance/allowance, BM wiring, bounty states.

**Version consistency: PASS.** Pinned rev declares
`CONTRACT_VERSION = '2.1'`; deployed pool `get_version` returns `3288625`
= felt `'2.1'`. `INVOKE_SELECTOR = selector!("privacy_invoke")` matches our
entrypoint; `OpenNoteDeposit { note_id, token, amount }` layout is the same
type our helper imports (same package rev). No upgrade needed or performed.

---

## A. CURRENT FLOW (as implemented)

`fundPrivate` submits ONE wallet signing with 2 actions:

1. `transfer { STRK, amount "OPEN", recipient: creator-self }` → pool creates
   an EMPTY open note (amount 0) for the creator.
2. `invoke { contract: VerityAnonymizer, calldata:
   [FUND_BOUNTY, bounty_id, amount, nonce, ${openNoteIds[0]}] }` → pool calls
   `helper.privacy_invoke(...)` (caller = pool ✓), helper runs
   `BountyManager.fund_bounty` bookkeeping, returns
   `[OpenNoteDeposit { note_id, STRK, amount }]`.

No action sends any STRK to the helper; the helper holds nothing and approves
nothing.

## B. ROOT FAILURE (why it cannot work)

The pool applies helper output in `_deposit_to_open_note` with
`checked_transfer_from(STRK, sender = helper, recipient = pool, amount)`.
The canonical pattern (Ekubo/Vesu, stated as a **precondition**: "the contract
must have sufficient input token balance", plus `approve(spender: pool)`)
funds the helper first via a `withdraw` input leg. Our flow skips both, so the
pull reverts — live reads confirm **helper balance = 0, allowance = 0**.
Deterministic `INSUFFICIENT_BALANCE`/`INSUFFICIENT_ALLOWANCE` on every attempt;
inner bookkeeping rolls back atomically (bounty stays CREATED); the outer
paymaster-sponsored tx surfaces `PaymasterV2Error 156`. The paymaster is only
the messenger. Latent second failure: helper screening policy reads
`Required` (pool default) — custom helpers need operator exemption (see §I).

## C. CORRECTED FLOW (smallest protocol-correct funding)

Principle (from the reference helpers): **value first, bookkeeping second,
exact approve, no unbacked notes, no empty notes left behind.**

Prerequisite (unchanged): creator's shielded STRK ≥ reward. Shielding itself
is the only pre-step (Q8/Q9: yes — the `withdraw` leg spends a shielded note;
a never-shielded wallet fails with `INSUFFICIENT_PRIVATE_BALANCE`).

**Step 0 — commit locks (once per bounty, public, creator direct calls,
batchable into ONE multicall signing):**
`helper.set_locks(bounty_id, fund_lock, refund_lock)` where each lock =
`hash(secret)`; secrets generated client-side at creation and backed up in
the UI. The helper authenticates `caller == BM.creator(bounty_id)` (direct
call ⇒ caller IS the creator — enforceable, unlike pool-routed calls where
caller is always the pool). Rejects for unknown bounties; creator-may-update
only while unfunded. (Secrets in later invoke calldata are public on-chain,
hence single-use: separate fund vs refund locks.)

**Step 1 — FUND (ONE wallet signing, 2 actions, atomic):**

| # | Action / call | Caller → contract | Token/amount | Balances/allowance | Note/state |
|---|---|---|---|---|---|
| 1 | `withdraw {STRK, reward → helper}` | wallet-assembled (pool executes) | STRK, exact reward wei | creator shielded −reward; helper public +reward | private note burned |
| 2 | `invoke FUND {op, bounty_id, amount, nonce, secret_S1}` | pool → `helper.privacy_invoke` | — | helper asserts `hash(S1)==fund_lock`, clears it, `escrow[b]+=amount`, asserts `== BM.funded_amount` | BM: CREATED→FUNDED; NO open note created, NO deposit returned |

`fund_bounty`'s existing checks (anonymizer-only caller, CREATED, exact
amount) all still hold; replay covered by pool nullifiers + helper nonce map
+ BM state machine (second fund reverts `NOT_CREATED`). No `approve` needed
(no pull occurs). No screening attestation needed (policy check only runs
when deposits are returned — none are).

**Q10:** funding a CREATED bounty = set-locks (first time only, batchable
with creation UX) + ONE private signing. **Q11:** bundling is REQUIRED for
atomicity (withdraw without invoke strands public funds at the helper;
invoke without withdraw has no backing) — the public correlation
(amount/helper/timing, and calldata including bounty linkage) matches every
helper flow and is documented in §H, not a defect.

## D. RELEASE FLOW (audited, not implemented)

**Problem with the current RELEASE:** identical unbacked-mint defect, plus a
worse one — anyone could submit `[transfer OPEN→self, invoke RELEASE]` and
the helper cannot see note recipients, so first-come theft is possible. A
naive fix is REJECTED.

**Corrected RELEASE (two phases):**

- **Phase 1 — winner registers payout lock (one cheap public tx):**
  `helper.register_payout_lock(bounty_id, lock)` with
  `caller == BM.winner(bounty_id)` (direct call ⇒ enforceable). Only the
  recorded winner can register.
- **Phase 2 — release (ONE wallet signing, 2 actions, atomic):**
  1. `transfer {STRK, OPEN, recipient: winner-viewing-identity}` → empty note.
  2. `invoke RELEASE {bounty_id, amount, nonce, secret_S3}` → helper verifies
     `hash(S3)==payout_lock`, clears it, asserts BM `Claimable` +
     `escrow[b] ≥ amount`, `escrow[b] −= amount`, `approve(pool, amount)`
     (EXACT, consumed by the pull — never unlimited), returns
     `[OpenNoteDeposit{note_id, STRK, amount}]` → pool pulls escrow into
     itself, fills the winner's private note. BM: CLAIMABLE→PAID.

Attacker's release (own note, no secret) fails closed in the helper → pool
gets no deposit → `UNDEPOSITED_OPEN_NOTES` revert; nothing moves.
Double-release blocked by BM `Paid` + zero escrow. Failed tx: fully atomic
(spent notes not nullified on revert).

**REFUND (same machinery):** creator sets `refund_lock` (batched in Step 0);
refund tx = single `invoke REFUND {bounty_id, nonce, secret_S2}` (no notes) →
helper verifies secret, asserts BM refundable + `escrow[b]==funded`,
transfers escrowed STRK publicly back to the FIXED creator address, zeroes
escrow/locks, calls `BM.refund_bounty`. Refund-to-creator-fixed means a
forced trigger can only benefit the creator — but the secret requirement
still blocks grief-triggering (which would cost the creator the protocol
fee). Unfunded cancel stays pure bookkeeping (no escrow).

**Residual risk (documented, not hidden):** secrets are backed up in UI
localStorage + shown once; a creator who loses a funded bounty secret strands
escrow. Mitigation at implementation: export/rotate affordances; no owner
backdoor (would break the trust model).

## E. REQUIRED CONTRACT CHANGES

**`BountyManager`: NONE.** All state/amount/role checks it already enforces
(creator-gated open/select/refund via direct-call `caller`, exact-amount
funding, claimable/paid machine) are exactly what the corrected flows rely
on. Bounties #1–#10 persist untouched.

**`VerityAnonymizer` (only contract touched — redeploy, version bump):**

| Change | Detail |
|---|---|
| Storage += | `fund_locks: Map<bounty_id, felt>`, `refund_locks`, `payout_locks`, `escrowed: Map<bounty_id, u128>` |
| `set_locks(bounty_id, fund_lock, refund_lock)` (new, direct) | `caller == BM.creator`, bounty exists, escrow zero; emits event |
| `register_payout_lock(bounty_id, lock)` (new, direct) | `caller == BM.winner`, BM `Claimable`; emits event |
| FUND path (rewrite) | verify secret vs `fund_lock`, clear it; call `fund_bounty`; `escrowed += amount`, assert equals BM funded; **return empty deposits**; NO approve |
| REFUND path (new op) | verify secret vs `refund_lock`; assert BM refundable + amounts; public STRK transfer escrow→creator; zero escrow/locks; call `refund_bounty`; return empty |
| RELEASE path (rewrite) | verify secret vs `payout_lock`, clear it; assert BM claimable; `escrowed −= amount`; `approve(pool, amount)` EXACT; call `claim_payout`; return 1 deposit |
| Events += | lock set/registered, escrow funded/released/refunded (amounts on helper legs are public by protocol nature) |

## F. REQUIRED FRONTEND/WALLET CHANGES

- Create page: generate 2 secrets per bounty, show once + persist; after
  `create_bounty` confirms, submit batched `set_locks` (one signing).
- Fund form (unchanged UX, exact-amount validation kept): actions become
  `[withdraw→helper, invoke FUND+secret]`; drop the `transfer OPEN` leg.
- Claim page (winner): `register_payout_lock` tx first, then
  `[transfer OPEN→self, invoke RELEASE+secret]`.
- Refund button: single `invoke REFUND+secret` (no private-balance needed
  beyond fees).
- Keep: `waitForTransaction` gating (no optimistic FUNDED), diag payload
  logging, BigInt reward handling. No changes to Phase 1 code.

## G. TRANSACTION COUNT (real signings)

Shield (only if balance short) · create (1) · set-locks batch (1, first time)
· **fund private tx (1)** · open (1) · stake/submit/select (existing, 1 each)
· register-payout-lock (1, winner) · release private tx (1) · refund private
tx (1, if needed). Funding a CREATED bounty whose locks exist: **exactly 1
signing**. No hidden signatures (lock-hash scheme needs no wallet message
signing; no SNIP-12-in-Cairo dependency).

## H. PRIVACY IMPLICATIONS (no overclaiming)

| Step | Publicly observable | Stays private |
|---|---|---|
| set-locks | creator ↔ bounty ↔ lock hashes (linkage already public via `create_bounty`) | secrets |
| FUND tx | withdraw amount + helper recipient; helper calldata (op, bounty, amount, revealed S1); timing | source note/identity (anonymity set = all pool notes); nothing links creator's main address beyond what creation already revealed |
| escrow | helper public balance (per-tx attribution via timing/amount correlatable) | — (accepted limitation of helper-escrow; Ekubo-class flows share it) |
| RELEASE tx | open-note amount; helper involvement; timing | winner's main address (note owned by registered viewing identity); winner↔bounty link beyond the already-public `WinnerSelected` event |
| Direct calls (open/select/refund/register) | caller, args (existing behavior, unchanged) | — |

What remains publicly visible (pool interaction, timing, helper legs, calldata
args) is inherent to helper-mediated STRK20 flows. What STRK20 hides (source
note ownership, winner identity behind viewing keys, shielded balances) is
preserved. The UI must state this exactly — no "fully invisible" claims.

## I. DEPLOYMENT REQUIREMENTS

1. Deploy NEW `VerityAnonymizer` (constructor: pool 0x0254…, BM 0x03643a…,
   owner). 2. Owner tx `BM.set_anonymizer(new)` (already owner-gated).
3. Frontend `CONTRACTS.verityAnonymizer` update. 4. Request pool-operator
   screening exemption for the new helper (currently `Required`; FUND path
   avoids it, RELEASE path needs it — verify with the first release test).
5. Old helper `0x04b93a…` becomes obsolete — holds 0 STRK (verified live),
   nothing migrates. 6. `BountyManager`, pool, token untouched; fee 2 STRK
   unchanged (wallet adds fee action; paymaster sponsors outer submission).

## J. TEST PLAN

**Local (`snforge`, no wallet):** lock set auth (non-creator/non-winner
rejected, unknown bounty rejected); wrong-secret fund/refund/release
rejected; exact-amount enforcement; double-fund / double-release /
double-refund reverted; over-release beyond escrow reverted; allowance is
exact-per-op (assert zero residual); failed-path atomicity (state + escrow
unchanged); refund-to-creator-fixed (grief trigger benefits creator only);
empty-deposit FUND with no open notes accepted by construction (mirror pool
`UNDEPOSITED` accounting in-test).
**Sepolia (two wallets, real signing):** the 14-step funding checklist from
the brief (create→CREATED→fund→FUNDED→reload→second-wallet-cannot-fund),
plus: wrong-secret funding reverts & stays CREATED; refund returns exact
escrow to creator → REFUNDED; full winner path (register→release→winner
note spendable, BM PAID); release-by-attacker fails closed; reload-pinning
after every transition. Record all hashes in `strk20.json`.

## Open decisions for the owner (no code until answered)

- **D1:** secret-bound funding (recommended, compliant) vs permissionless
  exact-amount funding (simpler; economically safe — a rogue funder only
  donates — but violates the stated caller constraint; grief surface: none
  material, since progression stays creator-gated and refund returns to the
  creator).
- **D2:** approve proceeding to implementation (helper rewrite + UI wiring +
  redeploy + Sepolia matrix) on YES to this audit.
