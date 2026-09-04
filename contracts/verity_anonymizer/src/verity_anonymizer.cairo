//! VerityAnonymizer — VERITY's STRK20 application boundary.
//!
//! Phase 0 scaffolding only. Per VERITY_SPEC.md §10, the anonymizer must:
//!   - recognize the configured STRK20 privacy pool,
//!   - reject unauthorized callers (pool-only authorization),
//!   - enforce replay protection,
//!   - process FundBounty and ReleaseToOpenNote,
//!   - validate payout conditions, and
//!   - return the real `privacy::objects::OpenNoteDeposit` type (never a
//!     locally mirrored struct).
//!
//! The `privacy` dependency, the pool-authorized `privacy_invoke` entrypoint,
//! and the real OpenNoteDeposit wiring are added in Phase 2 (VerityAnonymizer
//! proof), after the Phase 1 independent STRK20 gate passes.
//! Bounty voting/evidence logic deliberately does NOT belong in this contract.

/// Interface for the Phase 0 scaffolding marker. The pool-only `privacy_invoke`
/// entrypoint and the STRK20 application logic (FundBounty, ReleaseToOpenNote,
/// pool-only authorization, replay protection) land in Phase 2 using the real
/// `privacy::objects::OpenNoteDeposit` type. An explicit #[starknet::interface]
/// trait is required because under Cairo 2.20 an embedded impl must implement a
/// trait marked with #[starknet::interface].
#[starknet::interface]
pub trait IVerityAnonymizer<T> {
    /// Placeholder entrypoint: identity marker proving this Phase 0 scaffold
    /// compiles and deploys. Replaced by the real pool-authorized
    /// `privacy_invoke` in Phase 2.
    fn version(self: @T) -> felt252;
}

#[starknet::contract]
pub mod VerityAnonymizer {
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl VerityAnonymizerImpl of super::IVerityAnonymizer<ContractState> {
        fn version(self: @ContractState) -> felt252 {
            'VERITY_ANONYMIZER_V0'
        }
    }
}