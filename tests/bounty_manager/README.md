# tests/bounty_manager — planned test suites (Phase 4)

Reserved for the bounty-mechanics unit tests required by `CLINE_IMPLEMENTATION_PLAN.md`
GATE 4 (bounty lifecycle, voting, access control, replay protection, payout
accounting, invalid state transitions).

Until Phase 4, the only tests that exist are the per-package snforge smoke
tests under `contracts/*/tests/`. They prove the toolchain, not the product.

Nothing in this directory may fake STRK20 behavior. When integration with the
real STRK20 pool is exercised (Phases 3/5), the suites will live under
`tests/integration/` and will assert real protocol effects with transaction
hashes as evidence.