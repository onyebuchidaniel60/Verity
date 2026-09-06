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
  bountyManager:
    process.env.NEXT_PUBLIC_BOUNTY_MANAGER_ADDRESS || "0x03643a1e507bc076e6831b31be17f08bc9c1487583c55af313bc17958e9c4b54",
  verityAnonymizer:
    process.env.NEXT_PUBLIC_VERITY_ANONYMIZER_ADDRESS || "0x04b93a8628d6f905854f54bf3f5a1098cc41273b7dc54d56815e4dda62c0ae4b",
};

// Sepolia VerityAnonymizer (Phase 2 Gate 2 proof, old 3-arg version) at 0x0149c9333c62d976c8232907536fe29df683d8ffb98fa3278bdf4e9dc84d9c88
// is superseded by the Phase 3-5 Anonymizer above (new class 0x495c6e8f... with FUND/RELEASE).