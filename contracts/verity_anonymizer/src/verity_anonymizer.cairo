//! VerityAnonymizer — VERITY's STRK20 application boundary (Phase 3-5).
//!
//! Responsibilities (SPEC §10, PLAN §9-10):
//!   - recognize the configured STRK20 privacy pool (constructor arg)
//!   - store BountyManager address (set via set_bounty_manager, owner-only)
//!   - pool-only authorization (caller must be pool)
//!   - replay protection (nonce → used)
//!   - operation validation (VERITY_PROOF for Gate2, FUND_BOUNTY for Phase3, RELEASE for Phase5)
//!   - FundBounty: validate bounty, amount, prevent replay, call BountyManager.fund_bounty,
//!                 and return real OpenNoteDeposit span
//!   - ReleaseToOpenNote: validate winner claim, call BountyManager.claim_payout/mark_paid,
//!                        and return real OpenNoteDeposit for winner's private note
//!   - return the real `privacy::objects::OpenNoteDeposit` type (never a mirror)
//!
//! Pinned to starkware-libs/starknet-privacy bc75e4b (2024_07, 2.17.0).

use starknet::ContractAddress;
use privacy::objects::OpenNoteDeposit;

pub const ALLOWED_OP_PROOF: felt252 = 'VERITY_PROOF';
pub const ALLOWED_OP_FUND: felt252 = 'FUND_BOUNTY';
pub const ALLOWED_OP_RELEASE: felt252 = 'RELEASE';

#[starknet::interface]
pub trait IVerityAnonymizer<T> {
    fn version(self: @T) -> felt252;
    fn get_pool(self: @T) -> ContractAddress;
    fn get_bounty_manager(self: @T) -> ContractAddress;
    fn set_bounty_manager(ref self: T, bounty_manager: ContractAddress);
    fn privacy_invoke(
        ref self: T, operation: felt252, bounty_id: u64, amount: u128, nonce: felt252, note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::interface]
pub trait IBountyManagerForAnonymizer<T> {
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn claim_payout(ref self: T, bounty_id: u64);
}

#[starknet::contract]
pub mod VerityAnonymizer {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use privacy::objects::OpenNoteDeposit;
    use privacy::utils::constants::STRK_TOKEN_ADDRESS;
    use super::{ALLOWED_OP_FUND, ALLOWED_OP_PROOF, ALLOWED_OP_RELEASE, IBountyManagerForAnonymizerDispatcher, IBountyManagerForAnonymizerDispatcherTrait};

    #[storage]
    struct Storage {
        pool: ContractAddress,
        bounty_manager: ContractAddress,
        owner: ContractAddress,
        used_nonces: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BountyManagerUpdated: BountyManagerUpdated,
        FundBountyProcessed: FundBountyProcessed,
        ReleaseProcessed: ReleaseProcessed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BountyManagerUpdated {
        pub old: ContractAddress,
        pub new: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FundBountyProcessed {
        #[key]
        pub bounty_id: u64,
        pub amount: u128,
        pub nonce: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReleaseProcessed {
        #[key]
        pub bounty_id: u64,
        pub amount: u128,
        pub nonce: felt252,
        pub note_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress, bounty_manager: ContractAddress, owner: ContractAddress) {
        assert(pool.is_non_zero(), 'POOL_ZERO');
        self.pool.write(pool);
        // bounty_manager may be zero at deploy and set later via set_bounty_manager (owner only)
        if bounty_manager.is_non_zero() {
            self.bounty_manager.write(bounty_manager);
        }
        let owner_addr = if owner.is_zero() { get_caller_address() } else { owner };
        self.owner.write(owner_addr);
    }

    #[abi(embed_v0)]
    impl VerityAnonymizerImpl of super::IVerityAnonymizer<ContractState> {
        fn version(self: @ContractState) -> felt252 {
            'VERITY_ANONYMIZER_V1'
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_bounty_manager(self: @ContractState) -> ContractAddress {
            self.bounty_manager.read()
        }

        fn set_bounty_manager(ref self: ContractState, bounty_manager: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(bounty_manager.is_non_zero(), 'BM_ZERO');
            let old = self.bounty_manager.read();
            self.bounty_manager.write(bounty_manager);
            self.emit(BountyManagerUpdated { old, new: bounty_manager });
        }

        fn privacy_invoke(
            ref self: ContractState, operation: felt252, bounty_id: u64, amount: u128, nonce: felt252, note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // 1. Pool-only
            let caller = get_caller_address();
            let pool = self.pool.read();
            assert(caller == pool, 'NOT_POOL');

            // 2. Nonce replay protection (common to all ops)
            assert(nonce.is_non_zero(), 'NONCE_ZERO');
            assert(!self.used_nonces.read(nonce), 'REPLAY');
            self.used_nonces.write(nonce, true);

            // 3. Dispatch by operation
            if operation == ALLOWED_OP_PROOF {
                // Gate2 proof — no bounty logic, just return empty or one deposit
                let mut out: Array<OpenNoteDeposit> = array![];
                if note_id.is_non_zero() {
                    out.append(OpenNoteDeposit { note_id, token: STRK_TOKEN_ADDRESS, amount: 1 });
                }
                return out.span();
            } else if operation == ALLOWED_OP_FUND {
                // Phase3 FundBounty
                assert(bounty_id.is_non_zero(), 'BOUNTY_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                bm.fund_bounty(bounty_id, amount);
                self.emit(FundBountyProcessed { bounty_id, amount, nonce });
                let mut out: Array<OpenNoteDeposit> = array![];
                if note_id.is_non_zero() {
                    out.append(OpenNoteDeposit { note_id, token: STRK_TOKEN_ADDRESS, amount });
                }
                return out.span();
            } else if operation == ALLOWED_OP_RELEASE {
                // Phase5 ReleaseToOpenNote — private payout
                assert(bounty_id.is_non_zero(), 'BOUNTY_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                assert(note_id.is_non_zero(), 'NOTE_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                // This will revert if bounty not Claimable, wrong winner, double payout, amount mismatch etc.
                // The BountyManager's claim_payout is pool-authorized via anonymizer, so it checks caller == anonymizer
                bm.claim_payout(bounty_id);
                self.emit(ReleaseProcessed { bounty_id, amount, nonce, note_id });
                // Return the real OpenNoteDeposit that the pool will use to create the winner's private note
                let mut out: Array<OpenNoteDeposit> = array![];
                out.append(OpenNoteDeposit { note_id, token: STRK_TOKEN_ADDRESS, amount });
                return out.span();
            } else {
                assert(false, 'INVALID_OP');
                let mut out: Array<OpenNoteDeposit> = array![];
                out.span()
            }
        }
    }
}
