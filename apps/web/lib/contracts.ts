/**
 * VERITY contract registry (Phase 0 scaffold).
 *
 * Addresses are intentionally unset until deployment:
 *  - verityAnonymizer -> after GATE 2 (anonymizer proof)
 *  - bountyManager    -> after GATE 3 (private funding proof)
 *
 * See docs/STRK20_INTEGRATION.md §5.
 */
export interface VerityContractRegistry {
  bountyManager?: string;
  verityAnonymizer?: string;
}

export const CONTRACTS: VerityContractRegistry = {
  bountyManager: process.env.NEXT_PUBLIC_BOUNTY_MANAGER_ADDRESS || undefined,
  verityAnonymizer: process.env.NEXT_PUBLIC_VERITY_ANONYMIZER_ADDRESS || undefined,
};