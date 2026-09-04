# tests/integration — planned STRK20 integration suites

Reserved for the end-to-end STRK20 integration tests required by
`CLINE_IMPLEMENTATION_PLAN.md`:

```text
STRK20 pool → privacy_invoke → VerityAnonymizer → BountyManager
```

The official testing levels (VERITY_SPEC.md §36) are:

1. Unit tests (inside each contract package, later phases).
2. Integration tests — STRK20 → VerityAnonymizer → BountyManager.
3. End-to-end STRK20 tests — real private funding (`FundBounty`) and real
   private payout (`ReleaseToOpenNote`) against the real STRK20 pool.

Rule: no mocks, no local `OpenNoteDeposit` mirrors, no simulated privacy. A
compiling test is not integration evidence.