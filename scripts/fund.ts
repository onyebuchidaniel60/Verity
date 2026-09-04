/**
 * VERITY private funding script — Phase 0 placeholder.
 *
 * Will implement the GATE 3 funding flow once the anonymizer gate (GATE 2)
 * passes:
 *
 *   Requester STRK20 private op → privacy pool → privacy_invoke → VerityAnonymizer
 *     → FundBounty → BountyManager credit → FUNDED
 *
 * This script must never fall back to a public ERC20 transfer presented as
 * private funding (VERITY_SPEC.md §3.2 / §12).
 */
export {};