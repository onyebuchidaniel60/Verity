# VERITY Demo

**Status:** placeholder — the demo cannot exist until the STRK20 gates pass.

Per `CLINE_IMPLEMENTATION_PLAN.md`, the demo is produced only after:

- **GATE 3** — private bounty funding proven on-chain (real pool →
  `privacy_invoke` → VerityAnonymizer → FundBounty → BountyManager → FUNDED).
- **GATE 5** — private winner payout proven on-chain (`ReleaseToOpenNote` →
  real `OpenNoteDeposit` → winner private note).
- **GATE 6** — a fresh end-to-end flow: connect → STRK20 setup → create →
  private funding → submission → verifier voting → winner → claimable →
  private payout. No manual state modification; evidence = tx hashes, contract
  addresses, bounty transitions, STRK20 evidence, payout evidence.

## Required demo assets (later phases)

- Live frontend URL (`demo_url` in `strk20.json`).
- 3-minute demo video (`demo_video` in `strk20.json`).
- >=3 successful mainnet transaction hashes touching the STRK20 pool
  (`transactions` in `strk20.json`), each independently verifiable.
- Evidence docs: `docs/evidence/phase-*.md` per plan §24.

## What the demo must show honestly

- The private path visibly running through the real STRK20 pool.
- What remains public (deposits, bounty state, voting) alongside what is
  private (in-pool sender/amount relationships).
- Any known limitations.