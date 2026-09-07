//! VerityAnonymizer — VERITY's STRK20 application boundary (Phase 3 secret-bound funding).
//!
//! Responsibilities (SPEC §10, PLAN §9-10, docs/PHASE3_FUNDING_AUDIT.md):
//!   - recognize the configured STRK20 privacy pool (constructor arg)
//!   - store BountyManager address (set via set_bounty_manager, owner-only)
//!   - pool-only authorization for privacy_invoke (caller must be pool)
//!   - replay protection (nonce → used)
//!   - operation validation (VERITY_PROOF for Gate2, FUND_BOUNTY / REFUND_BOUNTY / RELEASE)
//!   - secret-bound funding: creator-committed Poseidon locks, helper STRK escrow,
//!     exact-amount enforcement, BountyManager state machine as authority
//!   - FundBounty: verify fund secret, consume lock, call BountyManager.fund_bounty,
//!                 record exact escrow, return EMPTY deposits (no unbacked notes)
//!   - RefundBounty: verify refund secret, return escrow to the FIXED BM creator,
//!                   call BountyManager.refund_bounty, return EMPTY deposits
//!   - ReleaseToOpenNote: verify winner-registered payout secret, exact-approve the
//!                        pool (never unlimited), call BountyManager.claim_payout,
//!                        return the real OpenNoteDeposit for the winner's note
//!   - return the real `privacy::objects::OpenNoteDeposit` type (never a mirror)
//!
//! Funding model (audit §C): value reaches the helper through a private `withdraw`
//! leg BEFORE the invoke. The helper never manufactures deposits: FUND/REFUND
//! return empty spans; only RELEASE returns a deposit, backed 1:1 by escrowed
//! STRK the pool pulls via the exact approve.
//!
//! Authorization model: pool-routed calls always see caller == pool, so user
//! authorization uses hash-committed secrets. Locks are set through DIRECT
//! (non-pool) calls where the real caller IS authenticated against the
//! BountyManager record (creator for set_locks, winner for payout lock).
//! Secrets are single-use (consumed on success) and live in calldata, hence
//! fund vs refund vs payout locks are separate.
//!
//! Pinned to starkware-libs/starknet-privacy bc75e4b (2024_07, 2.17.0).

use core::num::traits::Zero;
use starknet::ContractAddress;
use privacy::objects::OpenNoteDeposit;
use bounty_manager::types::Bounty;

pub const ALLOWED_OP_PROOF: felt252 = 'VERITY_PROOF';
pub const ALLOWED_OP_FUND: felt252 = 'FUND_BOUNTY';
pub const ALLOWED_OP_REFUND: felt252 = 'REFUND_BOUNTY';
pub const ALLOWED_OP_RELEASE: felt252 = 'RELEASE';

/// Poseidon lock for a secret: must equal `computePoseidonHashOnElements([secret])`
/// as computed by starknet.js (see parity test). Single-use; cleared on success.
fn check_secret(lock: felt252, secret: felt252, no_lock_err: felt252, bad_secret_err: felt252) {
    assert(secret.is_non_zero(), 'SECRET_ZERO');
    assert(lock.is_non_zero(), no_lock_err);
    let digest = core::poseidon::poseidon_hash_span(array![secret].span());
    assert(digest == lock, bad_secret_err);
}

#[starknet::interface]
pub trait IVerityAnonymizer<T> {
    fn version(self: @T) -> felt252;
    fn get_pool(self: @T) -> ContractAddress;
    fn get_bounty_manager(self: @T) -> ContractAddress;
    fn get_strk_token(self: @T) -> ContractAddress;
    fn set_bounty_manager(ref self: T, bounty_manager: ContractAddress);
    /// Commit funding locks. DIRECT call: caller must be the BM-recorded creator.
    /// Allowed only while the bounty is Created with zero escrow (also permits
    /// creator lock rotation before funding, e.g. lost-secret recovery).
    fn set_locks(ref self: T, bounty_id: u64, fund_lock: felt252, refund_lock: felt252);
    /// Commit a payout lock. DIRECT call: caller must be the BM-recorded winner
    /// of a Claimable bounty. Re-registration (rotation) allowed pre-release.
    fn register_payout_lock(ref self: T, bounty_id: u64, payout_lock: felt252);
    fn has_fund_lock(self: @T, bounty_id: u64) -> bool;
    fn has_refund_lock(self: @T, bounty_id: u64) -> bool;
    fn has_payout_lock(self: @T, bounty_id: u64) -> bool;
    fn get_escrow(self: @T, bounty_id: u64) -> u128;
    /// Pool-routed private entrypoint.
    /// `note_id` slot: FUND/REFUND must pass 0 (no notes involved); RELEASE passes
    /// the winner open-note id. `secret`: single-use authorization secret for
    /// FUND/REFUND/RELEASE (0 where unused, e.g. PROOF).
    fn privacy_invoke(
        ref self: T,
        operation: felt252,
        bounty_id: u64,
        amount: u128,
        nonce: felt252,
        note_id: felt252,
        secret: felt252,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::interface]
pub trait IBountyManagerForAnonymizer<T> {
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn claim_payout(ref self: T, bounty_id: u64);
    fn refund_bounty(ref self: T, bounty_id: u64);
    fn get_bounty(self: @T, bounty_id: u64) -> Bounty;
}

#[starknet::contract]
pub mod VerityAnonymizer {
    use core::num::traits::Zero;
    use openzeppelin::interfaces::token::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use privacy::objects::OpenNoteDeposit;
    use privacy::utils::constants::STRK_TOKEN_ADDRESS;
    use bounty_manager::types::BountyStatus;
    use super::{
        ALLOWED_OP_FUND, ALLOWED_OP_PROOF, ALLOWED_OP_REFUND, ALLOWED_OP_RELEASE,
        IBountyManagerForAnonymizerDispatcher, IBountyManagerForAnonymizerDispatcherTrait,
        check_secret,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        bounty_manager: ContractAddress,
        strk_token: ContractAddress,
        owner: ContractAddress,
        used_nonces: Map<felt252, bool>,
        fund_locks: Map<u64, felt252>,
        refund_locks: Map<u64, felt252>,
        payout_locks: Map<u64, felt252>,
        escrowed: Map<u64, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BountyManagerUpdated: BountyManagerUpdated,
        FundBountyProcessed: FundBountyProcessed,
        ReleaseProcessed: ReleaseProcessed,
        LocksSet: LocksSet,
        PayoutLockRegistered: PayoutLockRegistered,
        EscrowFunded: EscrowFunded,
        EscrowRefunded: EscrowRefunded,
        EscrowReleased: EscrowReleased,
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

    #[derive(Drop, starknet::Event)]
    pub struct LocksSet {
        #[key]
        pub bounty_id: u64,
        pub setter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutLockRegistered {
        #[key]
        pub bounty_id: u64,
        pub setter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowFunded {
        #[key]
        pub bounty_id: u64,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowRefunded {
        #[key]
        pub bounty_id: u64,
        pub amount: u128,
        pub to: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowReleased {
        #[key]
        pub bounty_id: u64,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        bounty_manager: ContractAddress,
        owner: ContractAddress,
        strk_token: ContractAddress,
    ) {
        assert(pool.is_non_zero(), 'POOL_ZERO');
        self.pool.write(pool);
        // bounty_manager may be zero at deploy and set later via set_bounty_manager (owner only)
        if bounty_manager.is_non_zero() {
            self.bounty_manager.write(bounty_manager);
        }
        let owner_addr = if owner.is_zero() { get_caller_address() } else { owner };
        self.owner.write(owner_addr);
        // strk_token zero resolves to the protocol STRK constant (same token the
        // pool pulls). Tests pass a mock token address instead.
        if strk_token.is_non_zero() {
            self.strk_token.write(strk_token);
        } else {
            self.strk_token.write(STRK_TOKEN_ADDRESS);
        }
    }

    #[abi(embed_v0)]
    impl VerityAnonymizerImpl of super::IVerityAnonymizer<ContractState> {
        fn version(self: @ContractState) -> felt252 {
            'VERITY_ANONYMIZER_V2'
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_bounty_manager(self: @ContractState) -> ContractAddress {
            self.bounty_manager.read()
        }

        fn get_strk_token(self: @ContractState) -> ContractAddress {
            self.strk_token.read()
        }

        fn set_bounty_manager(ref self: ContractState, bounty_manager: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(bounty_manager.is_non_zero(), 'BM_ZERO');
            let old = self.bounty_manager.read();
            self.bounty_manager.write(bounty_manager);
            self.emit(BountyManagerUpdated { old, new: bounty_manager });
        }

        fn set_locks(ref self: ContractState, bounty_id: u64, fund_lock: felt252, refund_lock: felt252) {
            let bm_addr = self.bounty_manager.read();
            assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
            let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
            // Reverts BOUNTY_NOT_FOUND for unknown bounties.
            let bounty = bm.get_bounty(bounty_id);
            let caller = get_caller_address();
            assert(caller == bounty.creator, 'NOT_CREATOR');
            assert(bounty.status == BountyStatus::Created, 'NOT_CREATED');
            assert(self.escrowed.read(bounty_id) == 0, 'ESCROW_NONZERO');
            assert(fund_lock.is_non_zero(), 'LOCK_ZERO');
            assert(refund_lock.is_non_zero(), 'LOCK_ZERO');
            self.fund_locks.write(bounty_id, fund_lock);
            self.refund_locks.write(bounty_id, refund_lock);
            self.emit(LocksSet { bounty_id, setter: caller });
        }

        fn register_payout_lock(ref self: ContractState, bounty_id: u64, payout_lock: felt252) {
            let bm_addr = self.bounty_manager.read();
            assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
            let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
            let bounty = bm.get_bounty(bounty_id);
            assert(bounty.winner.is_non_zero(), 'NO_WINNER');
            let caller = get_caller_address();
            assert(caller == bounty.winner, 'NOT_WINNER');
            assert(bounty.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
            assert(payout_lock.is_non_zero(), 'LOCK_ZERO');
            self.payout_locks.write(bounty_id, payout_lock);
            self.emit(PayoutLockRegistered { bounty_id, setter: caller });
        }

        fn has_fund_lock(self: @ContractState, bounty_id: u64) -> bool {
            self.fund_locks.read(bounty_id).is_non_zero()
        }

        fn has_refund_lock(self: @ContractState, bounty_id: u64) -> bool {
            self.refund_locks.read(bounty_id).is_non_zero()
        }

        fn has_payout_lock(self: @ContractState, bounty_id: u64) -> bool {
            self.payout_locks.read(bounty_id).is_non_zero()
        }

        fn get_escrow(self: @ContractState, bounty_id: u64) -> u128 {
            self.escrowed.read(bounty_id)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: felt252,
            bounty_id: u64,
            amount: u128,
            nonce: felt252,
            note_id: felt252,
            secret: felt252,
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
                // Phase3 secret-bound FundBounty. Value arrives via the private
                // `withdraw` leg BEFORE this invoke; the helper escrows it
                // implicitly (withdraw recipient == this contract). No open
                // note is created, so no deposit is returned.
                assert(note_id.is_zero(), 'NOTE_MUST_BE_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                check_secret(self.fund_locks.read(bounty_id), secret, 'NO_FUND_LOCK', 'BAD_SECRET');
                self.fund_locks.write(bounty_id, 0);
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let bounty = bm.get_bounty(bounty_id);
                assert(bounty.status == BountyStatus::Created, 'NOT_CREATED');
                assert(amount == bounty.reward_amount, 'AMOUNT_MISMATCH');
                bm.fund_bounty(bounty_id, amount);
                assert(self.escrowed.read(bounty_id) == 0, 'ESCROW_NONZERO');
                self.escrowed.write(bounty_id, amount);
                self.emit(FundBountyProcessed { bounty_id, amount, nonce });
                self.emit(EscrowFunded { bounty_id, amount });
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else if operation == ALLOWED_OP_REFUND {
                // Refund: return escrow to the FIXED BM creator. No notes involved.
                assert(note_id.is_zero(), 'NOTE_MUST_BE_ZERO');
                check_secret(self.refund_locks.read(bounty_id), secret, 'NO_REFUND_LOCK', 'BAD_SECRET');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let bounty = bm.get_bounty(bounty_id);
                assert(
                    bounty.status == BountyStatus::Created
                        || bounty.status == BountyStatus::Funded
                        || bounty.status == BountyStatus::Open,
                    'NOT_REFUNDABLE',
                );
                let escrow = self.escrowed.read(bounty_id);
                // The declared amount must equal the recorded escrow exactly
                // (0 for an unfunded cancel); the transfer below uses escrow.
                assert(amount == escrow, 'AMOUNT_MISMATCH');
                // Authoritative state transition first; reverts for winner/paid/refunded.
                bm.refund_bounty(bounty_id);
                if escrow.is_non_zero() {
                    let token = IERC20Dispatcher { contract_address: self.strk_token.read() };
                    assert(token.transfer(bounty.creator, escrow.into()), 'TRANSFER_FAILED');
                }
                self.escrowed.write(bounty_id, 0);
                self.refund_locks.write(bounty_id, 0);
                self.fund_locks.write(bounty_id, 0);
                self.emit(EscrowRefunded { bounty_id, amount: escrow, to: bounty.creator });
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else if operation == ALLOWED_OP_RELEASE {
                // Phase5 ReleaseToOpenNote — private payout of the full escrow.
                assert(note_id.is_non_zero(), 'NOTE_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                check_secret(self.payout_locks.read(bounty_id), secret, 'NO_PAYOUT_LOCK', 'BAD_SECRET');
                self.payout_locks.write(bounty_id, 0);
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let bounty = bm.get_bounty(bounty_id);
                assert(bounty.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
                let escrow = self.escrowed.read(bounty_id);
                assert(escrow.is_non_zero(), 'NO_ESCROW');
                assert(amount == escrow, 'AMOUNT_MISMATCH');
                // Exact, single-use approval: the pool pulls exactly `amount`.
                // (The pull itself is the pool's `_deposit_to_open_note`; after
                // it, residual allowance is zero.)
                let token_addr = self.strk_token.read();
                let token = IERC20Dispatcher { contract_address: token_addr };
                assert(token.approve(pool, amount.into()), 'APPROVE_FAILED');
                bm.claim_payout(bounty_id);
                self.escrowed.write(bounty_id, 0);
                self.emit(ReleaseProcessed { bounty_id, amount, nonce, note_id });
                self.emit(EscrowReleased { bounty_id, amount });
                let mut out: Array<OpenNoteDeposit> = array![];
                out.append(OpenNoteDeposit { note_id, token: token_addr, amount });
                return out.span();
            } else {
                assert(false, 'INVALID_OP');
                let mut out: Array<OpenNoteDeposit> = array![];
                out.span()
            }
        }
    }
}
