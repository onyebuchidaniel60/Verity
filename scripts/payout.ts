/**
 * VERITY private payout script — Phase 0 placeholder.
 *
 * Will implement the GATE 5 payout flow:
 *
 *   Winner STRK20 private op → privacy pool → privacy_invoke → VerityAnonymizer
 *     → ReleaseToOpenNote → real privacy::objects::OpenNoteDeposit
 *     → winner private STRK20 note
 *
 * A payout is only complete when the winner's private STRK20 state is
 * demonstrable (VERITY_SPEC.md §32). Public ERC20 transfers to the winner are
 * never presented as a private payout.
 */
export {};