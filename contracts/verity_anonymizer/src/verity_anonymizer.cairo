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
//! Private investigator identity operations (docs/PRIVATE_INVESTIGATOR.md).
//! Per-op `privacy_invoke(operation, bounty_id, amount, nonce, note_id, secret)`
//! slot semantics — the 6-argument shape is unchanged so FUND/REFUND/RELEASE
//! calldata is byte-identical:
//! - STAKE_IDENTITY:  bounty_id=0, amount=stake, note_id=0, secret=identity.
//!   Value arrives via the private `withdraw` leg first (Phase 3 FUND pattern).
//! - SUBMIT_PRIVATE:  bounty_id=bid, amount=0, note_id=evidence_hash,
//!   secret=chain preimage. Identity resolved helper-side via BM tip index.
//! - REGISTER_PAYOUT: bounty_id=bid, amount=0, note_id=payout_lock,
//!   secret=chain preimage. Verified lock lands in `payout_locks`, so the
//!   existing RELEASE op works unchanged for private winners.
//! - UNSTAKE_IDENTITY: bounty_id=0, amount=0, note_id=return note,
//!   secret=chain preimage. Returns an exact-backed OpenNoteDeposit.
pub const ALLOWED_OP_STAKE: felt252 = 'STAKE_IDENTITY';
pub const ALLOWED_OP_SUBMIT: felt252 = 'SUBMIT_PRIVATE';
pub const ALLOWED_OP_REG_PAYOUT: felt252 = 'REGISTER_PAYOUT';
pub const ALLOWED_OP_UNSTAKE: felt252 = 'UNSTAKE_IDENTITY';
//! Private creator identity (docs/PRIVATE_INVESTIGATOR.md, creator alias).
//! - CREATE_BOUNTY: bounty_id=0, amount=reward, note_id=metadata_hash,
//!   secret=creator alias. Pool-routed bare invoke; assigns the next id.
pub const ALLOWED_OP_CREATE: felt252 = 'CREATE_BOUNTY';

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
    /// Commit funding locks. DIRECT call.
    /// Legacy bounties: caller must be the BM-recorded creator
    /// (`creator_preimage` ignored, pass 0). Alias bounties: caller check is
    /// replaced by preimage auth against the alias tip (non-consuming — lock
    /// setup is idempotent); the direct caller is then irrelevant and no
    /// wallet is linked to the alias.
    /// Allowed only while the bounty is Created with zero escrow (also permits
    /// creator lock rotation before funding, e.g. lost-secret recovery).
    fn set_locks(ref self: T, bounty_id: u64, fund_lock: felt252, refund_lock: felt252, creator_preimage: felt252);
    /// Commit a payout lock. DIRECT call: caller must be the BM-recorded winner
    /// of a Claimable bounty. Re-registration (rotation) allowed pre-release.
    fn register_payout_lock(ref self: T, bounty_id: u64, payout_lock: felt252);
    fn has_fund_lock(self: @T, bounty_id: u64) -> bool;
    fn has_refund_lock(self: @T, bounty_id: u64) -> bool;
    fn has_payout_lock(self: @T, bounty_id: u64) -> bool;
    fn get_escrow(self: @T, bounty_id: u64) -> u128;
    /// Live STRK escrow backing a private investigator identity.
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    /// Slash an identity's escrow to the protocol treasury (owner). DIRECT
    /// call, BountyManager only — invoked by `resolve_report` after the
    /// dispute window resolves to slash.
    fn slash_stake(ref self: T, identity: felt252);
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
    // Private-identity callbacks (must match BountyManager exactly; the
    // callback-shape test in the bounty_manager package pins them).
    fn register_stake_identity(ref self: T, identity: felt252, amount: u128);
    fn submit_private(ref self: T, bounty_id: u64, evidence_hash: felt252, preimage: felt252) -> u64;
    fn register_private_payout_lock(ref self: T, bounty_id: u64, payout_lock: felt252, preimage: felt252);
    fn consume_preimage_by_tip(ref self: T, preimage: felt252) -> felt252;
    fn is_identity_slashed(self: @T, identity: felt252) -> bool;
    // Private-creator callbacks.
    fn create_bounty_private(ref self: T, reward_amount: u128, metadata_hash: felt252, creator_alias: felt252) -> u64;
    fn verify_creator_preimage(self: @T, alias: felt252, preimage: felt252) -> bool;
    fn get_payout_recipient(self: @T, bounty_id: u64) -> ContractAddress;
}

#[starknet::contract]
pub mod VerityAnonymizer {
    use core::num::traits::Zero;
    use openzeppelin::interfaces::token::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use privacy::objects::OpenNoteDeposit;
    use privacy::utils::constants::STRK_TOKEN_ADDRESS;
    use bounty_manager::types::BountyStatus;
    use super::{
        ALLOWED_OP_FUND, ALLOWED_OP_PROOF, ALLOWED_OP_REFUND, ALLOWED_OP_RELEASE,
        ALLOWED_OP_STAKE, ALLOWED_OP_SUBMIT, ALLOWED_OP_REG_PAYOUT, ALLOWED_OP_UNSTAKE,
        ALLOWED_OP_CREATE,
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
        // Private investigator stake escrow: identity commitment → STRK held.
        // Backed 1:1 by the private withdraw legs that precede STAKE ops;
        // `total_stake_held` lets STAKE assert real backing on every op.
        stake_escrow: Map<felt252, u128>,
        total_stake_held: u128,
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
        IdentityStaked: IdentityStaked,
        IdentityUnstaked: IdentityUnstaked,
        IdentitySlashed: IdentitySlashed,
        PrivateSubmissionRelayed: PrivateSubmissionRelayed,
        PrivatePayoutLockRelayed: PrivatePayoutLockRelayed,
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

    #[derive(Drop, starknet::Event)]
    pub struct IdentityStaked {
        #[key]
        pub identity: felt252,
        pub amount: u128,
        pub nonce: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IdentityUnstaked {
        #[key]
        pub identity: felt252,
        pub amount: u128,
        pub nonce: felt252,
        pub note_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IdentitySlashed {
        #[key]
        pub identity: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateSubmissionRelayed {
        #[key]
        pub bounty_id: u64,
        pub submission_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivatePayoutLockRelayed {
        #[key]
        pub bounty_id: u64,
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

        fn set_locks(ref self: ContractState, bounty_id: u64, fund_lock: felt252, refund_lock: felt252, creator_preimage: felt252) {
            let bm_addr = self.bounty_manager.read();
            assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
            let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
            // Reverts BOUNTY_NOT_FOUND for unknown bounties.
            let bounty = bm.get_bounty(bounty_id);
            if bounty.creator_alias.is_non_zero() {
                // Alias bounty: preimage auth replaces the caller check, so no
                // wallet is linked to the alias. Non-consuming (idempotent).
                assert(creator_preimage.is_non_zero(), 'PREIMAGE_ZERO');
                assert(bm.verify_creator_preimage(bounty.creator_alias, creator_preimage), 'BAD_PREIMAGE');
            } else {
                let caller = get_caller_address();
                assert(caller == bounty.creator, 'NOT_CREATOR');
                assert(creator_preimage.is_zero(), 'PREIMAGE_NOT_NEEDED');
            }
            assert(bounty.status == BountyStatus::Created, 'NOT_CREATED');
            assert(self.escrowed.read(bounty_id) == 0, 'ESCROW_NONZERO');
            assert(fund_lock.is_non_zero(), 'LOCK_ZERO');
            assert(refund_lock.is_non_zero(), 'LOCK_ZERO');
            self.fund_locks.write(bounty_id, fund_lock);
            self.refund_locks.write(bounty_id, refund_lock);
            self.emit(LocksSet { bounty_id, setter: get_caller_address() });
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

        fn get_stake_escrow(self: @ContractState, identity: felt252) -> u128 {
            self.stake_escrow.read(identity)
        }

        fn slash_stake(ref self: ContractState, identity: felt252) {
            let bm_addr = self.bounty_manager.read();
            assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
            assert(get_caller_address() == bm_addr, 'NOT_BOUNTY_MANAGER');
            let escrow = self.stake_escrow.read(identity);
            self.stake_escrow.write(identity, 0);
            if escrow.is_non_zero() {
                self.total_stake_held.write(self.total_stake_held.read() - escrow);
                // Slashed funds go to the protocol treasury (owner). Fixed rule.
                let token = IERC20Dispatcher { contract_address: self.strk_token.read() };
                assert(token.transfer(self.owner.read(), escrow.into()), 'TRANSFER_FAILED');
            }
            self.emit(IdentitySlashed { identity, amount: escrow });
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
                // Refunds land on the payout recipient: the explicit payout
                // address for alias bounties, else the legacy creator
                // (identical behavior for legacy bounties).
                let to = bm.get_payout_recipient(bounty_id);
                if escrow.is_non_zero() {
                    let token = IERC20Dispatcher { contract_address: self.strk_token.read() };
                    assert(token.transfer(to, escrow.into()), 'TRANSFER_FAILED');
                }
                self.escrowed.write(bounty_id, 0);
                self.refund_locks.write(bounty_id, 0);
                self.fund_locks.write(bounty_id, 0);
                self.emit(EscrowRefunded { bounty_id, amount: escrow, to });
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
            } else if operation == ALLOWED_OP_STAKE {
                // Private investigator stake. Value arrives via the private
                // `withdraw` leg BEFORE this invoke (same pattern as FUND);
                // the helper escrows it under the identity commitment. The
                // record contains NO wallet address: origin is hidden by the
                // pool, the fixed amount is public, timing is observable.
                assert(bounty_id == 0, 'BOUNTY_MUST_BE_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                assert(note_id.is_zero(), 'NOTE_MUST_BE_ZERO');
                // `secret` slot carries the identity (genesis tip). No prior
                // lock: first claim wins. Front-running a commitment locks only
                // the attacker's own funds (unusable without the seed).
                assert(secret.is_non_zero(), 'IDENTITY_ZERO');
                let identity = secret;
                assert(self.stake_escrow.read(identity) == 0, 'STAKE_ACTIVE');
                // Solvency: the withdraw leg must have actually delivered.
                let token_addr = self.strk_token.read();
                let token = IERC20Dispatcher { contract_address: token_addr };
                let balance: u256 = token.balance_of(get_contract_address());
                let held: u256 = self.total_stake_held.read().into();
                assert(balance >= held + amount.into(), 'STAKE_NOT_BACKED');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                bm.register_stake_identity(identity, amount);
                self.stake_escrow.write(identity, amount);
                self.total_stake_held.write(self.total_stake_held.read() + amount);
                self.emit(IdentityStaked { identity, amount, nonce });
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else if operation == ALLOWED_OP_SUBMIT {
                // Pool-routed private submission. `note_id` slot carries the
                // evidence hash, `secret` slot the chain preimage; the BM tip
                // index resolves the identity (never in calldata).
                assert(amount == 0, 'AMOUNT_MUST_BE_ZERO');
                assert(note_id.is_non_zero(), 'EVIDENCE_ZERO');
                assert(secret.is_non_zero(), 'PREIMAGE_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let submission_id = bm.submit_private(bounty_id, note_id, secret);
                self.emit(PrivateSubmissionRelayed { bounty_id, submission_id });
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else if operation == ALLOWED_OP_REG_PAYOUT {
                // Pool-routed payout-lock registration for a private winner.
                // `note_id` slot carries the payout lock, `secret` the chain
                // preimage. The verified lock lands in `payout_locks`, so the
                // existing RELEASE op works unchanged.
                assert(amount == 0, 'AMOUNT_MUST_BE_ZERO');
                assert(note_id.is_non_zero(), 'LOCK_ZERO');
                assert(secret.is_non_zero(), 'PREIMAGE_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                bm.register_private_payout_lock(bounty_id, note_id, secret);
                self.payout_locks.write(bounty_id, note_id);
                self.emit(PrivatePayoutLockRelayed { bounty_id });
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else if operation == ALLOWED_OP_UNSTAKE {
                // Private unstake: returns the full escrow as an exact-backed
                // open note (same backing pattern as RELEASE). Auth is the
                // chain preimage, verified+consumed by BM; slashed identities
                // cannot withdraw.
                assert(bounty_id == 0, 'BOUNTY_MUST_BE_ZERO');
                assert(amount == 0, 'AMOUNT_MUST_BE_ZERO');
                assert(note_id.is_non_zero(), 'NOTE_ZERO');
                assert(secret.is_non_zero(), 'PREIMAGE_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let identity = bm.consume_preimage_by_tip(secret);
                assert(!bm.is_identity_slashed(identity), 'IS_SLASHED_CANNOT_WITHDRAW');
                let escrow = self.stake_escrow.read(identity);
                assert(escrow.is_non_zero(), 'NO_STAKE');
                let token_addr = self.strk_token.read();
                let token = IERC20Dispatcher { contract_address: token_addr };
                assert(token.approve(pool, escrow.into()), 'APPROVE_FAILED');
                self.stake_escrow.write(identity, 0);
                self.total_stake_held.write(self.total_stake_held.read() - escrow);
                self.emit(IdentityUnstaked { identity, amount: escrow, nonce, note_id });
                let mut out: Array<OpenNoteDeposit> = array![];
                out.append(OpenNoteDeposit { note_id, token: token_addr, amount: escrow });
                return out.span();
            } else if operation == ALLOWED_OP_CREATE {
                // Private bounty creation. Bare invoke (no value leg): assigns
                // the next bounty id to the creator alias. The frontend reads
                // the id back via get_bounty_count after confirmation.
                assert(bounty_id == 0, 'BOUNTY_MUST_BE_ZERO');
                assert(amount.is_non_zero(), 'AMOUNT_ZERO');
                assert(note_id.is_non_zero(), 'METADATA_ZERO');
                assert(secret.is_non_zero(), 'ALIAS_ZERO');
                let bm_addr = self.bounty_manager.read();
                assert(bm_addr.is_non_zero(), 'BM_NOT_SET');
                let bm = IBountyManagerForAnonymizerDispatcher { contract_address: bm_addr };
                let _bid = bm.create_bounty_private(amount, note_id, secret);
                let out: Array<OpenNoteDeposit> = array![];
                return out.span();
            } else {
                assert(false, 'INVALID_OP');
                let mut out: Array<OpenNoteDeposit> = array![];
                out.span()
            }
        }
    }
}
