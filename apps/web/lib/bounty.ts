/**
 * Bounty domain model (Phase 0 scaffold).
 *
 * BountyManager owns the canonical lifecycle (VERITY_SPEC.md §7). These types
 * mirror the spec for the frontend shell and will be tied to on-chain contract
 * state after the Phase 3 private-funding gate passes.
 */

export type BountyStatus =
  | "CREATED"
  | "FUNDED"
  | "OPEN"
  | "VOTING"
  | "WINNER_SELECTED"
  | "CLAIMABLE"
  | "PAID"
  | "REFUNDED";

export const BOUNTY_LIFECYCLE: BountyStatus[] = [
  "CREATED",
  "FUNDED",
  "OPEN",
  "VOTING",
  "WINNER_SELECTED",
  "CLAIMABLE",
  "PAID",
];

export const VERIFIER_SET_SIZE = 13;
export const WINNER_THRESHOLD = 7;

/** A submission wins when it reaches 7 / 13 votes (VERITY_SPEC.md §14). */
export function thresholdMet(votes: number): boolean {
  return votes >= WINNER_THRESHOLD;
}