//! VerityAnonymizer — VERITY's STRK20 application boundary (Milestone 2.0).
//!
//! Minimal pool-authorized `privacy_invoke` wiring to prove the
//! STRK20 pool → VerityAnonymizer boundary without yet implementing
//! BountyManager business logic, FundBounty, or ReleaseToOpenNote.
//!
//! Responsibilities at this milestone (per VERITY_SPEC §10, PLAN §9):
//!   - recognize the configured STRK20 privacy pool (constructor arg)
//!   - pool-only authorization (caller must be pool)
//!   - replay protection (nonce → used)
//!   - operation validation (only the proof operation is accepted)
//!   - return the real `privacy::objects::OpenNoteDeposit` type (never a mirror)
//!
//! The `privacy` dependency is pinned to starkware-libs/starknet-privacy
//! bc75e4bac71ad0ce10c6e63effc33b5b25131a4f (same edition 2024_07 / corelib 2.17.0
//! as this workspace), so the real `OpenNoteDeposit` is imported, not recreated.
//! Selector for this entrypoint is `selector!("privacy_invoke")` via the trait
//! function name, matching `privacy::utils::constants::INVOKE_SELECTOR`.

use starknet::ContractAddress;
use privacy::objects::OpenNoteDeposit;

/// Allowed operation for the Milestone 2.0 proof boundary.
/// Only this felt is accepted; any other value reverts with `INVALID_OP`.
/// Future milestones will add FundBounty / ReleaseToOpenNote selectors.
pub const ALLOWED_OP_PROOF: felt252 = 'VERITY_PROOF';

#[starknet::interface]
pub trait IVerityAnonymizer<T> {
    /// Placeholder version marker (kept from Phase 0).
    fn version(self: @T) -> felt252;
    /// Returns the configured privacy pool address.
    fn get_pool(self: @T) -> ContractAddress;
    /// Pool-authorized entrypoint called by the STRK20 privacy contract.
    /// Selector is `privacy_invoke` (`INVOKE_SELECTOR`). Returns a span of
    /// real `OpenNoteDeposit` — empty for this proof when `note_id == 0`,
    /// or a single deposit filling the open note when `note_id != 0`.
    /// This demonstrates the real type flows end-to-end without faking a pool.
    fn privacy_invoke(
        ref self: T, operation: felt252, nonce: felt252, note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod VerityAnonymizer {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use privacy::objects::OpenNoteDeposit;
    use privacy::utils::constants::STRK_TOKEN_ADDRESS;
    use super::ALLOWED_OP_PROOF;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        used_nonces: Map<felt252, bool>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'POOL_ZERO');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl VerityAnonymizerImpl of super::IVerityAnonymizer<ContractState> {
        fn version(self: @ContractState) -> felt252 {
            'VERITY_ANONYMIZER_V0'
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn privacy_invoke(
            ref self: ContractState, operation: felt252, nonce: felt252, note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // 1. Pool-only authorization — only the configured privacy pool may call.
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, 'NOT_POOL');

            // 2. Operation validation — only the proof operation is accepted at this milestone.
            assert(operation == ALLOWED_OP_PROOF, 'INVALID_OP');

            // 3. Replay protection — nonce must be unused.
            assert(nonce.is_non_zero(), 'NONCE_ZERO');
            let already_used = self.used_nonces.read(nonce);
            assert(!already_used, 'REPLAY');
            self.used_nonces.write(nonce, true);

            // 4. Return the real OpenNoteDeposit span.
            // Empty is valid when the tx created no open notes (privacy.cairo
            // allows empty deposits when undeposited_open_notes == 0).
            // When a note_id is supplied, return a single real deposit so tests
            // can prove the type flows end-to-end.
            let mut out: Array<OpenNoteDeposit> = array![];
            if note_id.is_non_zero() {
                // Use the canonical STRK token and a minimal amount (1 fri).
                // The amount is not consensus-critical for this proof — the point
                // is that the boundary returns the *real* type, not a mirror.
                out.append(OpenNoteDeposit { note_id, token: STRK_TOKEN_ADDRESS, amount: 1 });
            }
            out.span()
        }
    }
}
