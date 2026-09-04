# VERITY — Technical Specification

**Document:** `VERITY_SPEC.md`  
**Status:** Canonical Architecture Specification  
**Project:** VERITY — Private Bounty & Truth Marketplace  
**Blockchain:** Starknet  
**Privacy Layer:** STRK20  
**Primary Asset:** STRK  

---

## 1. Purpose

VERITY is a decentralized bounty marketplace for investigations, research, and truth-finding.

A requester creates a bounty describing a question, claim, investigation, or task that requires evidence.

Investigators submit evidence or findings. A predefined verifier set evaluates submissions and votes on the winning result.

The winning investigator becomes eligible for a private STRK20 payout.

The defining feature of VERITY is that **bounty funding and winner payout use genuine STRK20 privacy flows** rather than simulated privacy or ordinary public ERC20 transfers.

---

# 2. Core Product Principle

VERITY does not implement its own privacy system.

VERITY uses the official STRK20 privacy infrastructure for:

- shielded balances
- private transfers
- private application interactions
- privacy-pool operations
- private payout delivery

VERITY's smart contracts implement the **application/business logic**.

STRK20 implements the **privacy layer**.

The application must never recreate STRK20 primitives locally.

---

# 3. Non-Negotiable Requirements

The following requirements are mandatory.

### 3.1 Genuine STRK20 Integration

VERITY must interact with the real STRK20 privacy pool.

Interface compatibility alone does not constitute integration.

Compilation alone does not constitute integration.

A local simulation of STRK20 does not constitute integration.

---

### 3.2 Private Bounty Funding

Requester funding must ultimately pass through the real STRK20 privacy pool and reach the VERITY application through the STRK20 application-invocation mechanism.

Conceptually:

```text
Requester
    │
    ▼
STRK20
    │
    ▼
Privacy Pool
    │
    ▼
privacy_invoke
    │
    ▼
VerityAnonymizer
    │
    ▼
BountyManager
    │
    ▼
Bounty Credit
```

A normal public:

```text
ERC20.transfer()
```

must not be presented as private bounty funding.

---

### 3.3 Private Winner Payout

Winner payout must use a genuine STRK20 privacy flow.

Conceptually:

```text
BountyManager
    │
    ▼
Winner becomes claimable
    │
    ▼
STRK20 private transaction
    │
    ▼
Privacy Pool
    │
    ▼
privacy_invoke
    │
    ▼
VerityAnonymizer
    │
    ▼
ReleaseToOpenNote
    │
    ▼
real OpenNoteDeposit
    │
    ▼
STRK20 privacy pool
    │
    ▼
Winner's private STRK20 balance/note
```

A public transfer directly to the winner must not be presented as a private payout.

---

### 3.4 Real OpenNoteDeposit

Where VERITY uses `OpenNoteDeposit`, it must use the actual STRK20 type:

```cairo
privacy::objects::OpenNoteDeposit
```

VERITY must not recreate or mirror this structure locally.

---

### 3.5 No Fake Privacy Layer

The following patterns are prohibited:

```cairo
struct OpenNoteDeposit {
    ...
}
```

when used as a replacement for the STRK20 type.

Likewise prohibited:

```text
private_balance[user] += amount
```

as a replacement for actual STRK20 shielded balances.

Likewise prohibited:

```text
public ERC20 transfer
        ↓
VERITY contract
```

being described as private.

---

# 4. STRK20 Integration Strategy

VERITY should use the official STRK20 application integration route appropriate for a private dapp.

The preferred application-layer integration is:

```text
VERITY Frontend
      │
      ▼
Starknet Wallet API
      │
      ▼
STRK20 Privacy Infrastructure
```

The direct Privacy SDK should only be used where VERITY genuinely requires low-level privacy-wallet/backend capabilities.

VERITY must not unnecessarily recreate wallet, proving, note discovery, viewing-key, or private-transfer infrastructure that STRK20 already provides.

---

# 5. High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         VERITY APP                          │
│                                                             │
│  Next.js / React / TypeScript                               │
│                                                             │
│  • Create bounty                                             │
│  • Fund bounty                                               │
│  • View bounty                                               │
│  • Submit evidence                                           │
│  • Vote                                                      │
│  • Select winner                                              │
│  • Claim payout                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Starknet Wallet API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         STRK20                              │
│                                                             │
│  • Shielded balances                                        │
│  • Private transfers                                         │
│  • Private application actions                               │
│  • Privacy pool                                              │
│  • Notes                                                     │
│  • ZK proofs                                                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ privacy_invoke
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     VERITY CONTRACTS                        │
│                                                             │
│  ┌──────────────────────┐    ┌───────────────────────────┐ │
│  │   VerityAnonymizer   │───▶│      BountyManager        │ │
│  │                      │    │                           │ │
│  │ STRK20 boundary      │    │ Application/business      │ │
│  │ Pool authorization    │    │ logic                     │ │
│  │ FundBounty            │    │                           │ │
│  │ ReleaseToOpenNote     │    │ Bounty lifecycle          │ │
│  └──────────────────────┘    │ Submissions               │ │
│                              │ Voting                    │ │
│                              │ Winner                    │ │
│                              │ Claimable payout          │ │
│                              └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

# 6. Contract Architecture

VERITY initially consists of two application contracts.

## 6.1 BountyManager

`BountyManager` contains VERITY's business logic.

### Responsibilities

- create bounty
- store bounty state
- track bounty amount
- receive authorized funding credits
- register submissions
- track investigators
- manage verifier voting
- determine winner
- make payout claimable
- record payout completion
- process refunds where applicable

### BountyManager must NOT

Implement:

- ZK proofs
- STRK20 notes
- viewing keys
- private balances
- note discovery
- private transfer construction
- STRK20 proof generation

Those responsibilities belong to STRK20.

---

# 7. Bounty Lifecycle

The canonical bounty state machine is:

```text
CREATED
   │
   ▼
FUNDED
   │
   ▼
OPEN
   │
   ▼
VOTING
   │
   ▼
WINNER_SELECTED
   │
   ▼
CLAIMABLE
   │
   ▼
PAID
```

Possible refund path:

```text
CREATED / FUNDED
        │
        ▼
     REFUNDED
```

The exact refund conditions must be defined by the final implementation.

---

# 8. Bounty Creation

A requester creates a bounty.

Conceptually:

```text
Requester
    │
    ▼
create_bounty()
    │
    ▼
BountyManager
    │
    ▼
Bounty = CREATED
```

A bounty should contain, at minimum:

```text
bounty_id
creator
reward_amount
status
creation_timestamp
metadata_hash/reference
```

The complete bounty description does not need to be stored directly on-chain.

---

# 9. Private Funding Architecture

## 9.1 Funding Requirement

Funding is considered successful only when the STRK20 flow results in a valid bounty credit recognized by `BountyManager`.

The application must be able to demonstrate that:

1. STRK20 was involved.
2. The privacy pool processed the operation.
3. `VerityAnonymizer` was invoked by the authorized pool.
4. The anonymizer validated the operation.
5. The bounty received the appropriate credit.
6. The bounty transitioned to `FUNDED`.

---

## 9.2 Funding Flow

```text
Requester
    │
    │ STRK20 operation
    ▼
STRK20 Privacy Pool
    │
    │ Withdraw / application invocation
    ▼
VerityAnonymizer
    │
    │ FundBounty
    ▼
BountyManager
    │
    ▼
Credit bounty
    │
    ▼
FUNDED
```

The precise STRK20 transaction construction must follow the official STRK20 integration mechanism and current SDK/Wallet API behavior.

VERITY must not invent a substitute mechanism.

---

# 10. VerityAnonymizer

`VerityAnonymizer` is VERITY's STRK20 application boundary.

It exists to bridge the STRK20 privacy pool and VERITY's application contracts.

It must be deliberately small.

---

## 10.1 Responsibilities

`VerityAnonymizer` must:

- recognize the configured STRK20 privacy pool
- reject unauthorized callers
- process supported privacy operations
- enforce operation replay protection
- process `FundBounty`
- track/forward bounty funding credits
- process `ReleaseToOpenNote`
- validate payout conditions
- debit the appropriate bounty credit
- approve the STRK20 pool where required
- return the actual STRK20 `OpenNoteDeposit`

---

## 10.2 Pool-Only Authorization

Only the configured STRK20 privacy pool may invoke the anonymizer's privacy entry point.

Conceptually:

```text
privacy_invoke()
       │
       ▼
caller == configured privacy pool?
       │
    ┌──┴──┐
   NO     YES
   │       │
REJECT   continue
```

---

## 10.3 Replay Protection

Every privacy operation that can mutate state must have replay protection.

The implementation may use an operation nonce or another mechanism supported by the STRK20 integration architecture.

A previously processed operation must not be executable again.

---

# 11. FundBounty Operation

`FundBounty` is the STRK20-to-VERITY funding operation.

Conceptually:

```text
STRK20 Pool
     │
     ▼
privacy_invoke(FundBounty)
     │
     ▼
VerityAnonymizer
     │
     ├── authenticate pool
     ├── validate operation
     ├── validate bounty
     ├── validate received funds
     └── prevent replay
     │
     ▼
BountyManager
     │
     ▼
funding credit
```

The resulting credit must be associated with the correct bounty.

---

# 12. BountyManager / Anonymizer Boundary

The boundary between the two contracts must remain explicit.

```text
VerityAnonymizer
        │
        │ authorized application interaction
        ▼
BountyManager
```

`BountyManager` should not contain STRK20-specific implementation details unless absolutely required by the protocol.

`VerityAnonymizer` should not contain bounty voting or evidence-management logic.

This separation makes the privacy boundary auditable.

---

# 13. Evidence Submission

Investigators submit evidence against an open bounty.

The complete evidence should normally remain off-chain.

Conceptually:

```text
Investigator
     │
     ▼
Upload evidence
     │
     ▼
Off-chain storage
     │
     ▼
Evidence hash / reference
     │
     ▼
BountyManager
```

A submission should contain at minimum:

```text
submission_id
bounty_id
investigator
evidence_hash/reference
timestamp
```

The actual evidence storage mechanism may be selected during implementation.

---

# 14. Verifier System

The initial implementation uses a fixed verifier set of **13 verifiers**.

The winning threshold is:

```text
7 / 13
```

The initial implementation does not require a sophisticated verifier-selection protocol.

The purpose is to provide a functional decentralized adjudication mechanism while keeping the hackathon implementation small.

---

# 15. Voting Lifecycle

```text
Bounty
   │
   ▼
VOTING
   │
   ├── Verifier 1
   ├── Verifier 2
   ├── ...
   └── Verifier 13
            │
            ▼
        Vote count
            │
            ▼
        ≥ 7 votes
            │
            ▼
      Winner selected
```

The implementation must prevent unauthorized accounts from voting as verifiers.

The exact anti-double-voting mechanism must be enforced on-chain.

---

# 16. Winner Selection

Once the required voting threshold is reached:

```text
select_winner()
       │
       ▼
WINNER_SELECTED
```

The winning investigator becomes the authorized payout beneficiary for the bounty.

The payout should then transition into a separate claimable stage.

---

# 17. Claimable Payout Architecture

Winner selection does not necessarily execute the STRK20 privacy transaction.

Instead:

```text
WINNER_SELECTED
       │
       ▼
CLAIMABLE
       │
       │ Winner initiates STRK20 operation
       ▼
STRK20 private payout
       │
       ▼
ReleaseToOpenNote
       │
       ▼
PAID
```

This separation is intentional.

`BountyManager` establishes **who is entitled to receive the reward**.

STRK20 performs the **private value movement**.

---

# 18. ReleaseToOpenNote

`ReleaseToOpenNote` is the payout-side STRK20 application operation.

Conceptually:

```text
STRK20 Pool
      │
      ▼
privacy_invoke(ReleaseToOpenNote)
      │
      ▼
VerityAnonymizer
      │
      ├── authenticate pool
      ├── validate bounty
      ├── validate winner/payout authorization
      ├── validate amount
      ├── prevent replay
      ├── debit bounty credit
      └── approve pool where required
      │
      ▼
real OpenNoteDeposit
      │
      ▼
STRK20 pool
      │
      ▼
winner private note/balance
```

The returned deposit object must be:

```cairo
privacy::objects::OpenNoteDeposit
```

from the actual STRK20 dependency.

---

# 19. Settlement vs Payout

The application must not falsely represent `settle()` as directly executing the STRK20 privacy transaction unless the implementation genuinely does so.

The preferred conceptual relationship is:

```text
BountyManager
      │
      │ select winner
      ▼
authorized payout amount/state
      │
      │
      ▼
STRK20 Wallet API / integration
      │
      ▼
private payout transaction
      │
      ▼
VerityAnonymizer
      │
      ▼
ReleaseToOpenNote
      │
      ▼
winner private note
```

This is the authoritative relationship between bounty settlement and private payout.

---

# 20. Public vs Private Information

VERITY must accurately describe STRK20's privacy properties.

## Public / potentially observable

Depending on the specific transaction:

- public blockchain transaction existence
- transaction timing
- public interaction with the STRK20 pool
- public deposit/withdrawal legs
- application-level information deliberately exposed by VERITY

## Private inside STRK20

STRK20 is responsible for protecting information such as:

- private sender
- private recipient
- private amount
- token information within the shielded transfer context
- notes
- private balance relationships

VERITY must not claim that the entire transaction is invisible.

---

# 21. Frontend Architecture

The frontend should be implemented as a lightweight Next.js application.

Recommended structure:

```text
apps/
└── web/
    ├── app/
    │   ├── page.tsx
    │   ├── create/
    │   ├── bounties/
    │   ├── bounty/[id]/
    │   ├── submit/
    │   └── profile/
    │
    ├── components/
    │
    ├── hooks/
    │
    └── lib/
        ├── starknet.ts
        ├── strk20.ts
        ├── bounty.ts
        └── contracts.ts
```

The frontend should use the official STRK20 wallet/application integration rather than implementing its own private transaction system.

---

# 22. Backend

VERITY does not require a complex backend.

The backend may provide:

- bounty metadata
- evidence metadata
- evidence storage
- submission indexing
- verifier configuration
- UI data aggregation
- application API endpoints

The blockchain remains authoritative for:

- bounty state
- funding state
- reward amount
- submissions/hashes where stored on-chain
- votes
- winner
- payout authorization
- payout completion

---

# 23. Data Architecture

## On-chain

```text
bounty_id
creator
reward_amount
status
submission records / hashes
verifier votes
winner
payout authorization
payout completion
```

## Off-chain

```text
bounty description
full evidence
evidence files
UI metadata
optional application indexes
```

## STRK20

```text
private notes
shielded balances
viewing/privacy data
ZK proofs
private transfer state
```

---

# 24. Repository Structure

The clean repository should initially follow this structure:

```text
verity/
│
├── apps/
│   └── web/
│
├── contracts/
│   ├── Scarb.toml
│   │
│   ├── bounty_manager/
│   │   ├── Scarb.toml
│   │   └── src/
│   │       ├── lib.cairo
│   │       ├── bounty_manager.cairo
│   │       └── types.cairo
│   │
│   └── verity_anonymizer/
│       ├── Scarb.toml
│       └── src/
│           ├── lib.cairo
│           └── verity_anonymizer.cairo
│
├── tests/
│   ├── bounty_manager/
│   └── integration/
│
├── scripts/
│   ├── deploy.ts
│   ├── fund.ts
│   ├── payout.ts
│   └── verify.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── STRK20_INTEGRATION.md
│   ├── PRIVACY_MODEL.md
│   └── DEMO.md
│
├── .env.example
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── Scarb.toml
└── strk20.json
```

The exact package manager and workspace configuration may be adjusted during implementation.

---

# 25. Dependency Policy

The implementation must use versions compatible with the selected STRK20 integration route.

The previous project established the following compatibility baseline:

```text
Privacy SDK:       PRIVACY-0.14.3-RC.5
Scarb:             2.20.1
snforge:           0.63.0
starknet.js:       10.5.0
Node:              >=24
OpenZeppelin:      3.0.0
Cairo edition:     2024_07
```

These versions are a starting compatibility baseline, not an instruction to blindly preserve them if the current official STRK20 resources require different versions.

Before implementation, the agent must verify the current official STRK20 starter kit and integration documentation.

---

# 26. Official Resource Policy

The implementation must use official STRK20 resources as the primary technical authority.

The agent must consult:

- STRK20 Builder Resources
- STRK20 Build / integration documentation
- STRK20 by Example
- official STRK20 starter kit
- official Privacy SDK documentation
- official STRK20 agent resources/skills where available

Third-party examples may be used for supplemental understanding but must not override official protocol documentation.

---

# 27. Implementation Phases

The implementation must proceed in controlled phases.

## Phase 0 — Foundation

Deliver:

- clean repository
- dependency setup
- Cairo contracts
- frontend skeleton
- official STRK20 integration dependencies
- environment configuration
- successful compilation

### STOP GATE

Do not proceed until the clean foundation works.

---

# 28. Phase 1 — Independent STRK20 Proof

Before integrating bounty logic, prove that the selected STRK20 integration route works independently.

At minimum demonstrate the appropriate basic STRK20 operation for the chosen route.

Examples may include:

```text
wallet connection
shield
private balance
unshield
```

### STOP GATE

Do not build VERITY-specific privacy logic until the underlying STRK20 integration has been proven.

---

# 29. Phase 2 — VerityAnonymizer Proof

Implement the smallest possible anonymizer.

Prove:

```text
STRK20 pool
      ↓
privacy_invoke
      ↓
VerityAnonymizer
```

Verify:

- pool authentication
- operation validation
- replay protection
- actual STRK20 invocation
- no fake OpenNoteDeposit

### STOP GATE

Do not add bounty voting or application complexity until the anonymizer works.

---

# 30. Phase 3 — Private Funding

Implement:

```text
Requester
    ↓
STRK20
    ↓
Privacy Pool
    ↓
VerityAnonymizer
    ↓
FundBounty
    ↓
BountyManager
    ↓
FUNDED
```

Capture evidence of the complete flow.

Required evidence:

- transaction hash
- STRK20 pool interaction
- anonymizer invocation
- bounty credit
- bounty state transition

### STOP GATE

Private funding must work before payout development becomes the priority.

---

# 31. Phase 4 — Bounty Mechanics

Implement:

```text
create
   ↓
fund
   ↓
open
   ↓
submit
   ↓
vote
   ↓
winner
```

Implement:

- bounty creation
- submissions
- verifier authorization
- voting
- 7/13 threshold
- winner selection
- claimable state

No complex additional features should be introduced during this phase.

---

# 32. Phase 5 — Private Payout

Implement:

```text
CLAIMABLE
    ↓
Winner initiates STRK20 operation
    ↓
Privacy Pool
    ↓
VerityAnonymizer
    ↓
ReleaseToOpenNote
    ↓
real OpenNoteDeposit
    ↓
STRK20
    ↓
Winner private balance/note
```

Capture:

- transaction hash
- privacy pool interaction
- anonymizer invocation
- payout debit
- OpenNoteDeposit evidence
- winner private-balance/note evidence

### STOP GATE

The payout is not considered complete until the resulting STRK20 private state can be demonstrated.

---

# 33. Phase 6 — Mainnet

Only after the complete application works through the appropriate development/test environment should the project move to mainnet.

Mainnet deployment must use:

- real STRK20 pool
- real STRK token
- deployed VerityAnonymizer
- deployed BountyManager
- real wallet interaction
- real STRK

No mock token or fake privacy layer may be used in the final demonstration.

---

# 34. Mainnet Evidence

The final project must capture real mainnet evidence.

At minimum, capture:

```text
transaction hashes
contract addresses
STRK20 pool interaction
bounty funding
bounty payout
successful application invocation
```

The hackathon submission requires the relevant mainnet transactions to be included in:

```text
strk20.json
```

The transactions must be genuine successful transactions touching the STRK20 pool.

---

# 35. Security Requirements

The implementation must include, at minimum:

### Access control

Only authorized callers may:

- invoke STRK20 application operations
- modify bounty state
- vote as verifiers
- select/confirm winners where authorization is required

### Replay protection

Privacy operations must not be executable more than once.

### Double voting protection

A verifier must not vote multiple times for the same bounty unless the protocol explicitly allows it.

### Payout protection

A bounty must not be paid twice.

### Amount validation

Payout amounts must not exceed the bounty's available credited balance.

### State validation

Invalid lifecycle transitions must revert.

---

# 36. Testing Strategy

Testing must occur at three levels.

## Unit tests

Test:

- bounty lifecycle
- voting
- access control
- replay protection
- payout accounting
- invalid state transitions

## Integration tests

Test:

```text
STRK20
   ↓
VerityAnonymizer
   ↓
BountyManager
```

## End-to-end STRK20 tests

Prove:

### Funding

```text
STRK20 private funding
        ↓
FundBounty
        ↓
bounty funded
```

### Payout

```text
claimable bounty
        ↓
STRK20 private payout
        ↓
ReleaseToOpenNote
        ↓
winner private balance/note
```

Compilation is not sufficient evidence of integration.

---

# 37. Evidence-First Development

Every STRK20 milestone must produce observable evidence.

For each integration operation record:

```text
operation
transaction hash
pool address
anonymizer address
bounty ID
amount
result
events/logs
resulting state
```

If an operation cannot be demonstrated, it must not be described as working.

---

# 38. Failure Policy

If a STRK20 operation fails, the implementation agent must:

1. capture the exact error;
2. identify which layer failed;
3. inspect the official STRK20 documentation/examples;
4. inspect the relevant SDK/API implementation;
5. make one targeted change;
6. rerun the smallest reproducer.

The agent must not repeatedly execute the same failing command without changing the diagnosis or implementation.

The agent must not replace a failing real integration with a mock implementation merely to make tests pass.

---

# 39. Scope Control

The following features are explicitly lower priority than genuine STRK20 integration:

- elaborate UI animations
- advanced verifier selection
- reputation systems
- token incentives
- complex DAO governance
- sophisticated evidence storage
- social features
- notifications
- analytics
- custom privacy infrastructure

The core product is:

```text
PRIVATE FUNDING
       +
BOUNTY
       +
EVIDENCE
       +
VERIFICATION
       +
PRIVATE PAYOUT
```

A smaller functioning product is preferable to a larger product with simulated STRK20 integration.

---

# 40. Definition of Done

VERITY is considered technically complete only when all of the following are true:

### Application

- [ ] User can connect a Starknet wallet.
- [ ] User can create a bounty.
- [ ] User can fund a bounty.
- [ ] Investigator can submit evidence.
- [ ] Verifiers can vote.
- [ ] Winner can be selected.
- [ ] Winner can claim payout.

### STRK20

- [ ] Real STRK20 dependency/integration is used.
- [ ] Real STRK20 privacy pool is used.
- [ ] Private funding works.
- [ ] Private payout works.
- [ ] `privacy_invoke` reaches the real VerityAnonymizer.
- [ ] `FundBounty` works.
- [ ] `ReleaseToOpenNote` works.
- [ ] Real `privacy::objects::OpenNoteDeposit` is used.
- [ ] No local STRK20 type mirrors exist.

### Security

- [ ] Pool-only authorization works.
- [ ] Replay protection works.
- [ ] Double-voting protection works.
- [ ] Double-payout protection works.
- [ ] Invalid lifecycle transitions revert.

### Evidence

- [ ] Funding transaction is recorded.
- [ ] Payout transaction is recorded.
- [ ] STRK20 pool interaction is demonstrable.
- [ ] Bounty credit is demonstrable.
- [ ] Winner payout is demonstrable.
- [ ] Resulting private STRK20 state is demonstrable.

### Mainnet

- [ ] Contracts deployed to Starknet mainnet.
- [ ] Real STRK is used.
- [ ] Real STRK20 pool is used.
- [ ] Required mainnet transactions are recorded in `strk20.json`.
- [ ] Public demo is available.
- [ ] Demo clearly demonstrates genuine STRK20 integration.

---

# 41. Architectural Invariants

The following statements must remain true throughout development:

1. **STRK20 owns privacy.**
2. **BountyManager owns bounty business logic.**
3. **VerityAnonymizer is the STRK20/application boundary.**
4. **The privacy pool is the authoritative STRK20 execution environment.**
5. **The application never substitutes local structures for STRK20 protocol objects.**
6. **Private funding must actually use STRK20.**
7. **Private payout must actually use STRK20.**
8. **Public ERC20 transfers are never described as private.**
9. **Compilation is never treated as proof of STRK20 integration.**
10. **A successful runtime transaction is required to claim an integration flow works.**
11. **The winner's payout authorization and the actual private STRK20 transaction are distinct concepts.**
12. **The system must remain minimal until both private funding and private payout are proven.**

---

# 42. Guiding Architecture

The entire VERITY architecture can be reduced to:

```text
                    VERITY
                       │
          ┌────────────┴────────────┐
          │                         │
     APPLICATION                 PRIVACY
          │                         │
          ▼                         ▼
  BountyManager                 STRK20
          │                         │
          │                         │
          ▼                         ▼
 VerityAnonymizer ◀──── privacy_invoke ──── Privacy Pool
          │
          │
          ▼
     Application
       Funding
       & Payout
```

The fundamental product loop is:

```text
        REQUESTER
            │
            │ private funding
            ▼
         STRK20
            │
            ▼
      VERITY BOUNTY
            │
            ▼
      INVESTIGATORS
            │
            ▼
         EVIDENCE
            │
            ▼
        VERIFIERS
            │
            ▼
         WINNER
            │
            │ private payout
            ▼
         STRK20
```

**This is VERITY.**