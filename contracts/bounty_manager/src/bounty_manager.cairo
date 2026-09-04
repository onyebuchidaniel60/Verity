//! BountyManager — VERITY's application/business-logic contract.
//!
//! Phase 0 scaffolding only. Per VERITY_SPEC.md §6.1, BountyManager must NOT
//! implement ZK proofs, STRK20 notes, viewing keys, private balances, note
//! discovery, private transfer construction, or STRK20 proof generation.
//!
//! The full bounty lifecycle
//! (CREATED → FUNDED → OPEN → VOTING → WINNER_SELECTED → CLAIMABLE → PAID,
//! plus REFUNDED) and the STRK20 funding/payout wiring land in later phases:
//!   Phase 3 — private funding credits through VerityAnonymizer::FundBounty
//!   Phase 4 — core bounty mechanics
//!   Phase 5 — private winner payout through VerityAnonymizer::ReleaseToOpenNote

/// Interface for the Phase 0 scaffolding marker. Real functionality (bounty
/// lifecycle, funding credits, submissions, 13-verifier voting, winner
/// selection, claimable payout) is implemented in later phases per
/// CLINE_IMPLEMENTATION_PLAN.md. An explicit #[starknet::interface] trait is
/// required because under Cairo 2.20 an embedded impl must implement a trait
/// marked with #[starknet::interface].
#[starknet::interface]
pub trait IBountyManager<T> {
    /// Placeholder entrypoint: identity marker proving this Phase 0 scaffold
    /// compiles and deploys. Replaced by real functionality in later phases.
    fn version(self: @T) -> felt252;
}

#[starknet::contract]
pub mod BountyManager {
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl BountyManagerImpl of super::IBountyManager<ContractState> {
        fn version(self: @ContractState) -> felt252 {
            'VERITY_BOUNTY_MANAGER_V0'
        }
    }
}