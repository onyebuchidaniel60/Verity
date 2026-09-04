# VERITY — Cline Phased Implementation Plan

## 1. Purpose

This document defines the implementation process for VERITY.

The canonical product and architecture specification is:

```text
VERITY_SPEC.md
```

`VERITY_SPEC.md` defines **what VERITY must be**.

This document defines **how Cline must build and verify it**.

The project must be implemented incrementally, with explicit verification gates after every significant STRK20 milestone.

The primary development principle is:

> **Implement the smallest real piece of functionality, prove it works, then proceed.**

Compilation is not proof of integration.

A passing unit test is not proof of mainnet STRK20 integration.

A mocked or simulated privacy flow is not acceptable as evidence of STRK20 functionality.

---

# 2. NON-NEGOTIABLE RULES

## 2.1 Read the specification first

Before writing implementation code, Cline MUST read:

```text
VERITY_SPEC.md
```

Cline must understand:

- product purpose
- architecture
- bounty lifecycle
- STRK20 integration model
- anonymizer responsibilities
- BountyManager responsibilities
- privacy boundaries
- funding flow
- payout flow
- security requirements
- definition of done

If implementation appears to conflict with the specification, STOP and ask rather than silently changing the architecture.

---

# 3. STRK20 MUST BE GENUINE

VERITY must integrate with genuine STRK20 infrastructure.

The following do NOT qualify as STRK20 integration:

- fake/private local balances
- local `OpenNoteDeposit` implementations
- custom structs pretending to be STRK20 protocol types
- encrypted database balances
- frontend-only privacy
- simulated ZK proofs
- mocked STRK20 pool calls
- fake `privacy_invoke`
- standard ERC20 transfers represented as private
- local accounting presented as shielded funds

If a genuine STRK20 capability cannot be implemented or verified, Cline MUST STOP and report the limitation.

Cline must never substitute a simulation simply to make a phase pass.

---

# 4. OFFICIAL STRK20 RESOURCES

Before implementing STRK20 functionality, Cline MUST inspect the current official STRK20 resources.

At minimum, investigate the currently applicable:

- STRK20 builder documentation
- STRK20 by Example
- official starter kit
- relevant official examples
- STRK20 Privacy SDK documentation where applicable
- official STRK20 agent skill, if available

Determine the currently supported integration path before writing integration code.

Do not rely on guessed APIs or outdated examples.

---

# 5. STRK20 INTEGRATION STRATEGY

Use the highest-level official integration mechanism appropriate for VERITY.

Preferred order:

```text
1. STRK20 Wallet API
2. Wallet API + VERITY anonymizer
3. Privacy SDK where genuinely required
4. Custom prover only if genuinely necessary
```

Do not implement lower-level protocol functionality unnecessarily.

Before selecting an approach, document:

- selected integration route
- why it is appropriate
- required SDK/package versions
- required Starknet contracts
- required STRK20 contracts
- required wallet capabilities
- required APIs
- known limitations

Create/update:

```text
docs/STRK20_INTEGRATION.md
```

---

# 6. DEVELOPMENT GATE SYSTEM

Every major phase follows this exact workflow:

```text
IMPLEMENT
    ↓
TEST
    ↓
VERIFY
    ↓
CAPTURE EVIDENCE
    ↓
STOP
    ↓
USER APPROVAL
    ↓
NEXT PHASE
```

Cline MUST NOT automatically continue after a gate.

The purpose of the gates is to ensure that STRK20 integration is proven before application complexity is layered on top.

---

# 7. PHASE 0 — PROJECT FOUNDATION

## Objective

Create the clean VERITY project foundation and establish the development environment.

---

## 7.1 Repository structure

Create:

```text
verity/
├── VERITY_SPEC.md
├── CLINE_IMPLEMENTATION_PLAN.md
├── README.md
├── LICENSE
│
├── apps/
│   └── web/
│
├── contracts/
│   ├── Scarb.toml
│   ├── bounty_manager/
│   └── verity_anonymizer/
│
├── tests/
│   ├── bounty_manager/
│   └── integration/
│
├── scripts/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── STRK20_INTEGRATION.md
│   ├── PRIVACY_MODEL.md
│   └── DEMO.md
│
├── package.json
├── pnpm-workspace.yaml
├── Scarb.toml
└── strk20.json
```

The exact structure may be adjusted if required by the selected STRK20 integration architecture, but architectural changes must be justified.

---

## 7.2 Environment verification

Determine and record the exact versions of:

- Node.js
- package manager
- Scarb
- Starknet Foundry / snforge
- starknet.js
- STRK20-related packages
- Cairo edition
- other critical dependencies

Pin compatible versions.

Do not perform unnecessary dependency upgrades.

---

## 7.3 Contract foundation

Create the initial contract packages:

```text
contracts/bounty_manager/
contracts/verity_anonymizer/
```

At this stage, implement only the minimal project scaffolding required to establish the architecture.

Do not implement the complete bounty marketplace yet.

---

## 7.4 Frontend foundation

Create the Next.js/React/TypeScript application.

Establish:

- wallet connection foundation
- Starknet configuration
- environment configuration
- contract configuration
- basic application shell

Do not build the complete UI yet.

---

## GATE 0 — FOUNDATION VERIFY

### Cline MUST STOP HERE.

Report:

```text
PHASE 0 COMPLETE

Project:
Environment:

Node:
Package manager:
Scarb:
snforge:
starknet.js:

STRK20 resources inspected:
Selected integration route:

Contracts:
Frontend:

Compilation:
Tests:

Known issues:
```

### Gate 0 passes only if:

- project builds
- contracts compile
- frontend builds
- dependency versions are known
- STRK20 integration route has been identified
- no major architectural uncertainty remains

Cline MUST WAIT for approval before Phase 1.

---

# 8. PHASE 1 — INDEPENDENT STRK20 PROOF

## Objective

Prove that the project can successfully perform a genuine STRK20 operation before connecting STRK20 to VERITY application logic.

This phase is intentionally independent of the bounty system.

---

## 8.1 Implement the smallest official STRK20 flow

Depending on the currently supported STRK20 integration route, implement the minimum useful flow.

Potential flow:

```text
Wallet
  ↓
STRK20 setup/registration
  ↓
Shield/deposit
  ↓
Private balance
  ↓
Private operation/transfer
  ↓
Withdraw/unshield
```

Only implement operations actually supported by the current official STRK20 stack.

---

## 8.2 Verify actual STRK20 state

Cline must establish that the operation actually interacted with the STRK20 system.

Evidence should include, where applicable:

- transaction hash
- STRK20 pool address
- successful transaction status
- private balance/state
- relevant protocol state
- wallet/API response
- logs proving the actual protocol path

---

# GATE 1 — STRK20 VERIFY

### STOP.

Cline must provide:

```text
PHASE 1 COMPLETE

STRK20 integration route:

STRK20 pool:
STRK20 contracts:

Operation performed:

Transaction hash(es):

Private state produced:

How the result was verified:

Public information:

Private information:

Mocks/simulations used:
```

Cline must explicitly answer:

### Did the operation use the real STRK20 system?

```text
YES / NO
```

If NO:

```text
PHASE 1 FAILED.
STOP.
```

Do not proceed to VERITY integration.

---

# 9. PHASE 2 — VERITY ANONYMIZER

## Objective

Connect the real STRK20 system to a minimal VERITY anonymizer.

The target architecture is:

```text
STRK20 Pool
      │
      │ privacy_invoke
      ▼
VerityAnonymizer
      │
      ▼
VERITY application logic
```

---

## 9.1 VerityAnonymizer responsibilities

The anonymizer should handle the STRK20/application boundary.

It must include the appropriate mechanisms for:

- recognizing the configured STRK20 pool
- authorization
- supported operation validation
- replay protection
- parameter validation
- forwarding the intended application action

Do not place bounty marketplace logic unnecessarily inside the anonymizer.

---

## 9.2 First integration operation

Implement the smallest operation capable of proving:

```text
real STRK20 pool
      ↓
real privacy_invoke
      ↓
VerityAnonymizer
      ↓
VERITY contract logic
```

The goal is not to build the entire application.

The goal is to prove the integration boundary.

---

## 9.3 Protocol types

Use the actual STRK20 protocol types.

In particular, if the STRK20 integration requires:

```text
privacy::objects::OpenNoteDeposit
```

use the actual protocol type.

Do NOT recreate it locally.

---

# GATE 2 — ANONYMIZER VERIFY

### STOP.

Cline must provide:

```text
PHASE 2 COMPLETE

VerityAnonymizer:
STRK20 pool:

Operation:

Pool authorization:
Replay protection:
Parameter validation:

privacy_invoke evidence:

Transaction hash:

Transaction status:

VERITY contract reached:
Yes / No

Real STRK20 types used:
Yes / No

Mocks:
```

The following sequence must be demonstrably real:

```text
actual STRK20 pool
        ↓
actual privacy_invoke
        ↓
actual VerityAnonymizer
        ↓
actual VERITY logic
```

Compilation alone does not pass this gate.

If this sequence cannot be proven:

```text
STOP.
DO NOT IMPLEMENT PRIVATE FUNDING.
```

---

# 10. PHASE 3 — PRIVATE BOUNTY FUNDING

## Objective

Connect genuine STRK20 private value movement to a VERITY bounty.

Required conceptual flow:

```text
Requester
    ↓
STRK20 private operation
    ↓
STRK20 Pool
    ↓
VerityAnonymizer
    ↓
FundBounty
    ↓
BountyManager
    ↓
Funding credited
    ↓
FUNDED
```

---

# 11. BOUNTY MANAGER — INITIAL IMPLEMENTATION

Implement:

- bounty creation
- bounty ID
- requester
- bounty metadata/reference
- required funding amount
- bounty state
- authorized funding credit
- transition to `FUNDED`

BountyManager must NOT implement:

- ZK proof generation
- note discovery
- viewing keys
- private balance management
- private transfer construction
- STRK20 protocol internals

Its responsibility is application state and entitlement.

---

# 12. FUNDING INVARIANT

A bounty is not considered privately funded merely because:

```text
ERC20 balance increased
```

or:

```text
a local balance variable increased
```

or:

```text
the frontend displays "Funded"
```

The funding must be demonstrably connected to genuine STRK20 execution.

---

# GATE 3 — PRIVATE FUNDING VERIFY

### STOP.

Cline must prove:

```text
Bounty created
      ↓
STRK20 funding operation
      ↓
real STRK20 pool
      ↓
privacy_invoke
      ↓
VerityAnonymizer
      ↓
FundBounty
      ↓
BountyManager
      ↓
FUNDED
```

Provide:

```text
Bounty ID:

Required funding amount:

STRK20 transaction hash:

STRK20 pool:

VerityAnonymizer:

BountyManager:

Relevant events:

Final bounty state:

STRK20 evidence:

VERITY evidence:

Public information:

Private information:
```

If the complete flow cannot be proven:

```text
STOP.
DO NOT CONTINUE TO PHASE 4.
```

---

# 13. PHASE 4 — CORE BOUNTY MECHANICS

Only begin after Gate 3 passes.

Implement the application mechanics that do not require additional STRK20 integration.

---

## 13.1 Bounty lifecycle

Implement:

```text
CREATED
   ↓
FUNDED
   ↓
OPEN
   ↓
VOTING
   ↓
WINNER_SELECTED
   ↓
CLAIMABLE
   ↓
PAID
```

Optional refund path:

```text
CREATED/FUNDED
       ↓
REFUNDED
```

---

# 14. EVIDENCE SUBMISSIONS

Implement:

- submission creation
- bounty association
- investigator identity
- evidence reference/metadata
- timestamp
- submission state

Sensitive evidence should not automatically be stored directly onchain.

---

# 15. VERIFIER SYSTEM

Use the specification's verifier model:

```text
13 verifiers
```

Winner threshold:

```text
7 / 13
```

Implement:

- verifier authorization
- one vote per verifier per bounty
- vote recording
- vote counting
- winner determination
- double-vote prevention

---

# GATE 4 — BOUNTY MECHANICS VERIFY

### STOP.

Demonstrate:

```text
CREATE
  ↓
FUNDED
  ↓
OPEN
  ↓
SUBMISSION
  ↓
VOTING
  ↓
7/13
  ↓
WINNER_SELECTED
  ↓
CLAIMABLE
```

Provide:

- transaction/test evidence
- state transitions
- vote evidence
- winner selection evidence
- authorization evidence
- double-vote protection evidence

No private payout implementation should be hidden inside this phase.

Cline MUST WAIT for approval.

---

# 16. PHASE 5 — PRIVATE WINNER PAYOUT

## Objective

Implement genuine private payout through STRK20.

Required conceptual architecture:

```text
CLAIMABLE
    ↓
Winner initiates STRK20 operation
    ↓
STRK20 Pool
    ↓
privacy_invoke
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

---

# 17. SETTLEMENT VS PRIVATE VALUE MOVEMENT

This distinction is mandatory.

BountyManager determines:

```text
WHO is entitled to WHAT.
```

STRK20 determines:

```text
HOW private value moves.
```

Therefore:

```text
BountyManager
    ↓
winner entitlement
    ↓
CLAIMABLE
```

does NOT automatically mean:

```text
winner received private STRK20 funds
```

The actual STRK20 payout operation must separately occur.

---

# 18. RELEASE TO OPEN NOTE

Implement the STRK20/anonymizer operation required to release the bounty payout into the STRK20 privacy system.

Use the actual protocol type:

```text
privacy::objects::OpenNoteDeposit
```

where required by the real integration.

Do not create a local equivalent.

---

# 19. DOUBLE PAYOUT PROTECTION

The payout system must prevent:

```text
claim
claim again
```

Implement appropriate state and replay protections.

The bounty must not be capable of paying more than its authorized payout amount.

---

# GATE 5 — PRIVATE PAYOUT VERIFY

### STOP.

This is a critical STRK20 gate.

Cline must prove:

```text
Winner selected
      ↓
Claimable payout
      ↓
Winner STRK20 operation
      ↓
real STRK20 pool
      ↓
privacy_invoke
      ↓
VerityAnonymizer
      ↓
ReleaseToOpenNote
      ↓
real OpenNoteDeposit
      ↓
STRK20 private balance/note
```

Provide:

```text
Winner:

Bounty ID:

Payout amount:

Payout transaction hash:

STRK20 pool:

VerityAnonymizer:

ReleaseToOpenNote evidence:

OpenNoteDeposit evidence:

Final STRK20 private state:

Bounty final state:

Double-payout protection:

Public information:

Private information:
```

### Critical pass condition

Cline must be able to demonstrate that the winner received the value through genuine STRK20 privacy infrastructure.

If the only result is:

```text
Winner → public ERC20
```

the gate FAILS.

If the only result is:

```text
Winner → fake/local OpenNoteDeposit
```

the gate FAILS.

If the result cannot be independently verified:

```text
STOP.
```

---

# 20. PHASE 6 — FRONTEND

Only begin after:

```text
Gate 3 — Private Funding
Gate 5 — Private Payout
```

have passed.

The frontend should expose the proven backend capabilities rather than drive unverified protocol assumptions.

---

## Recommended structure

```text
apps/web/
├── app/
│   ├── page.tsx
│   ├── create/
│   ├── bounties/
│   ├── bounty/[id]/
│   ├── submit/
│   └── profile/
│
├── components/
├── hooks/
└── lib/
    ├── starknet.ts
    ├── strk20.ts
    ├── bounty.ts
    └── contracts.ts
```

---

## UI capabilities

Implement:

1. Wallet connection
2. STRK20 setup where required
3. Private balance display where supported
4. Bounty creation
5. Private bounty funding
6. Bounty status
7. Evidence submission
8. Verifier voting
9. Winner selection
10. Payout claim
11. Private payout confirmation

The UI must accurately explain the privacy model.

Do not make absolute privacy claims such as:

> "Nobody can see anything."

Explain what STRK20 actually hides and what remains publicly observable.

---

# GATE 6 — END-TO-END VERIFY

### STOP.

Perform a fresh complete end-to-end flow:

```text
CONNECT
   ↓
STRK20 SETUP
   ↓
CREATE BOUNTY
   ↓
PRIVATE FUNDING
   ↓
SUBMISSION
   ↓
VERIFIER VOTING
   ↓
WINNER
   ↓
CLAIMABLE
   ↓
PRIVATE PAYOUT
```

No manual contract-state modification should be used to make the demonstration succeed.

Provide:

- transaction hashes
- contract addresses
- bounty state transitions
- STRK20 evidence
- payout evidence
- screenshots/logs where useful
- known limitations

---

# 21. PHASE 7 — MAINNET

Only begin after the complete end-to-end flow passes.

Deploy the production contracts.

Verify:

- network
- contract addresses
- STRK20 pool configuration
- anonymizer authorization
- frontend configuration
- environment variables
- wallet configuration
- deployment transactions

---

# GATE 7 — MAINNET VERIFY

### STOP.

Provide:

```text
MAINNET VERIFICATION

Network:

BountyManager:
VerityAnonymizer:
STRK20 pool:

Deployment transaction:

Private funding transaction:

Private payout transaction:

Additional STRK20 transaction(s):

Frontend URL:
```

For the hackathon submission, ensure the required mainnet transaction hashes are:

- real
- successful
- on the correct network
- connected to STRK20
- connected to the VERITY application where required
- independently verifiable

Never fabricate transaction evidence.

---

# 22. PHASE 8 — SECURITY REVIEW

Perform a dedicated security review.

---

## Access control

Test:

- unauthorized funding
- unauthorized payout
- unauthorized verifier actions
- unauthorized anonymizer calls
- unauthorized administrative operations

---

## Replay protection

Test:

- duplicate privacy invocation
- duplicate funding
- duplicate payout
- repeated claim

---

## State protection

Test:

- funding twice
- voting after voting closes
- double voting
- payout before winner selection
- payout before claimable state
- double payout
- refund after payout

---

## Amount protection

Test:

- incorrect funding amount
- insufficient funding
- excessive payout
- zero-value operations
- underflow
- overflow
- balance exhaustion

---

# GATE 8 — SECURITY VERIFY

### STOP.

Produce:

```text
ATTACK:
PROTECTION:
TEST:
RESULT:
```

for every important security case.

Any unresolved critical vulnerability blocks release.

---

# 23. PHASE 9 — DOCUMENTATION AND DEMO

Create/finalize:

```text
README.md
docs/ARCHITECTURE.md
docs/STRK20_INTEGRATION.md
docs/PRIVACY_MODEL.md
docs/DEMO.md
```

Documentation must explain:

### What VERITY does

A private bounty marketplace connecting requesters, investigators, verifiers, and winners.

### Why privacy matters

The requester should not need to publicly expose the funding relationship and private value movement associated with the bounty.

### How STRK20 is used

Explain the actual integration path.

### What remains public

For example:

- public blockchain transactions
- pool interactions
- timing
- public application state
- app-level metadata where applicable

### What STRK20 keeps private

Where applicable:

- private sender/receiver relationships
- private value movement within the privacy system
- shielded notes/balances
- private transfer relationships

Do not exaggerate the privacy guarantees.

---

# 24. EVIDENCE DIRECTORY

Maintain:

```text
docs/evidence/
├── phase-1-strk20.md
├── phase-2-anonymizer.md
├── phase-3-funding.md
├── phase-5-payout.md
├── phase-6-end-to-end.md
├── phase-7-mainnet.md
└── phase-8-security.md
```

Each evidence document should contain:

```text
Objective
Environment
Contracts
Versions
Transaction hashes
Expected behavior
Observed behavior
Privacy behavior
Verification method
Screenshots/logs where useful
Known limitations
Conclusion
```

---

# 25. FAILURE PROTOCOL

If an STRK20 operation fails:

## DO NOT

- introduce a mock
- create a fake protocol type
- bypass the STRK20 pool
- replace private value movement with public ERC20
- fake a proof
- fake a note
- silently change the architecture
- mark the milestone complete because compilation succeeds

## DO

1. Capture the exact error.
2. Preserve the complete error output.
3. Identify the failing layer.
4. Compare the implementation against the current official STRK20 documentation/example.
5. Create the smallest reproducible test.
6. Determine whether the issue is:
   - wallet
   - Wallet API
   - SDK
   - prover
   - contract
   - pool
   - Cairo
   - dependency
   - version mismatch
   - environment
7. Fix the smallest failing component.
8. Re-run the gate.

---

# 26. NO SPECULATIVE DEBUGGING LOOPS

If the same error persists after multiple attempts, stop making unrelated changes.

Report:

```text
ERROR:

FIRST OCCURRENCE:

ATTEMPTS:

CHANGES MADE:

RESULT OF EACH ATTEMPT:

LIKELY FAILURE LAYER:

OFFICIAL DOCUMENTATION/EXAMPLE CHECKED:

CURRENT HYPOTHESIS:

NEXT INVESTIGATION:
```

Do not repeatedly modify working components without evidence that they are related to the failure.

---

# 27. CLINE STATUS FORMAT

At the beginning of every phase, Cline must report:

```text
CURRENT PHASE:
OBJECTIVE:

RELEVANT VERITY_SPEC REQUIREMENTS:

FILES TO CREATE/MODIFY:

STRK20 COMPONENTS INVOLVED:

IMPLEMENTATION APPROACH:

EXPECTED EVIDENCE:

GATE CONDITION:
```

At the end of every phase:

```text
PHASE:
STATUS:

IMPLEMENTED:

TESTED:

VERIFIED:

EVIDENCE:

KNOWN LIMITATIONS:

GATE RESULT:

NEXT PHASE:
```

Then Cline MUST STOP.

---

# 28. ARCHITECTURAL CHANGE POLICY

Cline must not silently alter the architecture defined in `VERITY_SPEC.md`.

If implementation reveals that an architectural change is necessary, Cline must report:

```text
PROPOSED ARCHITECTURAL CHANGE

Current architecture:

Problem:

Evidence:

Proposed change:

Why it is necessary:

Impact on STRK20 privacy:

Impact on contracts:

Impact on frontend:

Impact on security:

Recommendation:
```

Then STOP and wait for approval.

---

# 29. IMPLEMENTATION ORDER

The required implementation sequence is:

```text
PHASE 0
Foundation
    ↓
GATE 0
    ↓
PHASE 1
Independent STRK20 proof
    ↓
GATE 1
    ↓
PHASE 2
STRK20 → VerityAnonymizer
    ↓
GATE 2
    ↓
PHASE 3
Private bounty funding
    ↓
GATE 3
    ↓
PHASE 4
Core bounty mechanics
    ↓
GATE 4
    ↓
PHASE 5
Private winner payout
    ↓
GATE 5
    ↓
PHASE 6
Frontend
    ↓
GATE 6
    ↓
PHASE 7
Mainnet
    ↓
GATE 7
    ↓
PHASE 8
Security
    ↓
GATE 8
    ↓
PHASE 9
Documentation + Demo
```

---

# 30. FINAL DEFINITION OF DONE

VERITY is complete only when all of the following have been proven.

## Product

- bounty creation works
- private funding works
- evidence submission works
- verifier voting works
- 7/13 winner selection works
- payout entitlement works
- private winner payout works

## STRK20

- genuine STRK20 integration
- genuine STRK20 pool interaction
- genuine private funding
- genuine `privacy_invoke`
- genuine VERITY anonymizer
- genuine private payout
- genuine `privacy::objects::OpenNoteDeposit` where required
- no fake privacy infrastructure

## Security

- access control
- replay protection
- double-vote protection
- double-payout protection
- state validation
- amount validation

## Evidence

- independent STRK20 proof
- anonymizer proof
- private funding proof
- private payout proof
- complete end-to-end proof
- mainnet proof
- required mainnet transaction hashes

## Documentation

- architecture documented
- STRK20 integration documented
- privacy model documented
- limitations documented
- demo documented

---

# 31. FINAL INSTRUCTION TO CLINE

Build VERITY as a sequence of **small, independently verifiable milestones**.

Do not optimize for the number of files written.

Optimize for:

```text
REAL STRK20
      +
REAL PRIVACY
      +
REAL VERITY LOGIC
      +
VERIFIABLE EVIDENCE
```

A small implementation with genuine STRK20 integration is preferable to a large implementation containing simulated privacy.

Never claim a STRK20 milestone is complete merely because:

- the project compiles
- a test passes
- a mock succeeds
- a local state changes
- a frontend displays the expected result

For every STRK20 milestone, prove the actual protocol interaction.

If a capability cannot be proven:

```text
STOP.
REPORT THE EVIDENCE.
DO NOT SIMULATE SUCCESS.
```

`VERITY_SPEC.md` is the canonical specification.

This document is the implementation execution plan.

**Implement → Test → Verify → Document Evidence → STOP → Await Approval.**

Repeat until VERITY is complete.