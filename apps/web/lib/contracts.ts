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
    process.env.NEXT_PUBLIC_BOUNTY_MANAGER_ADDRESS || "0x04315e84d96b7d0e4daf4d0ee0382d3951a4963a85d6b7572520cb4155135807",
  verityAnonymizer:
    process.env.NEXT_PUBLIC_VERITY_ANONYMIZER_ADDRESS || "0x03602dc4f3a8bd209d47fca442c87f22151536e6ed7387b7025e92c4ebcf9682",
};

// Sepolia VerityAnonymizer history:
// - Gate2 3-arg version 0x0149c9333c62d976c8232907536fe29df683d8ffb98fa3278bdf4e9dc84d9c88 (superseded)
// - Phase3-5 5-arg FUND/RELEASE 0x04b93a8628d6f905854f54bf3f5a1098cc41273b7dc54d56815e4dda62c0ae4b
//   (structurally broken: unbacked OpenNoteDeposit, helper balance 0 — see docs/PHASE3_FUNDING_AUDIT.md)
// - Phase3 secret-bound 6-arg (locks+escrow) 0x07aa84798ca642a90cc8094c1743dbcd5b9606b36bded3d6297cc1ecf49ad4f3,
//   class 0x77e082e590a4dd6ef5bcb950811e178c82f34d90952b512e7747e1979817722 (superseded by private-staking deploy below)
// - Private staking + creator alias (6-arg STAKE/SUBMIT/REG_PAYOUT/UNSTAKE/CREATE, 2026-09-07):
//   BountyManager 0x04315e84d96b7d0e4daf4d0ee0382d3951a4963a85d6b7572520cb4155135807,
//   class 0x448d50706a4bf5a0d9d1812ad114ba2e1a540b6092d5a58715c8ed2021e06cd +
//   VerityAnonymizer 0x03602dc4f3a8bd209d47fca442c87f22151536e6ed7387b7025e92c4ebcf9682,
//   class 0x07977502e7870198401a84e86e876df781cf37082685b3a2ab1c513d8e1e65b6.