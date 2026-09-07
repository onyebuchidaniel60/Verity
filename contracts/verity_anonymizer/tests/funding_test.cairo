//! Phase 3 secret-bound funding tests for VerityAnonymizer.
//!
//! Covers the authorization §17 matrix: lock auth, FUND, REFUND, RELEASE,
//! replay, escrow exactness, empty FUND deposits, exact allowance lifecycle,
//! atomicity (failed ops change nothing), and JS↔Cairo Poseidon parity.
//!
//! Test doubles (same-file, test-only):
//! - MockStrk: minimal ERC20 (balances/allowances) standing in for STRK. The
//!   helper is constructed with the mock as its token; on Sepolia a zero
//!   constructor arg resolves to the real protocol STRK constant.
//! - MockBM: faithful BountyManager double using the REAL
//!   `bounty_manager::types::{Bounty, BountyStatus}` (identical layout by
//!   construction). It mirrors the exact checks the helper depends on
//!   (existence, creator, status gates, exact amount) plus test-only
//!   `force_state`/`force_winner` setup backdoors. snforge cannot
//!   cross-`declare` workspace packages, so the real BM cannot be deployed
//!   from this package's tests; instead:
//!   (a) the full real-BM lifecycle is covered by bounty_manager's own e2e
//!       tests, and (b) `anonymizer_callback_shape_test` in the
//!       bounty_manager package proves the real BM accepts the exact call
//!       shapes the helper sends (see that file).
//!   Caller-auth (`caller == anonymizer`) is a BM-side property exercised on
//!   Sepolia wiring (`get_anonymizer` checks); all BM-mutating calls here go
//!   through the helper exactly as in production.

#[feature("deprecated-starknet-consts")]
use core::num::traits::Zero;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use verity_anonymizer::verity_anonymizer::{
    IVerityAnonymizerDispatcher, IVerityAnonymizerDispatcherTrait,
    ALLOWED_OP_FUND, ALLOWED_OP_REFUND, ALLOWED_OP_RELEASE,
};
use bounty_manager::types::{Bounty, BountyStatus};
use privacy::objects::OpenNoteDeposit;

// ---------------------------------------------------------------------------
// Mock STRK (test-only): open mint, OZ-style interface.
// ---------------------------------------------------------------------------

#[starknet::interface]
trait IMockStrk<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
mod MockStrk {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl MockStrkImpl of super::IMockStrk<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.read((sender, caller));
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'INSUFFICIENT_BALANCE');
            self.allowances.write((sender, caller), allowed - amount);
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.write(recipient, self.balances.read(recipient) + amount);
        }
    }
}

// ---------------------------------------------------------------------------
// Mock BountyManager (test-only double; see header for the testing strategy).
// ---------------------------------------------------------------------------

#[starknet::interface]
trait IMockBM<T> {
    fn create_bounty(ref self: T, reward_amount: u128, metadata_hash: felt252) -> u64;
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn claim_payout(ref self: T, bounty_id: u64);
    fn refund_bounty(ref self: T, bounty_id: u64);
    fn get_bounty(self: @T, bounty_id: u64) -> Bounty;
    fn force_state(ref self: T, bounty_id: u64, status: BountyStatus);
    fn force_winner(ref self: T, bounty_id: u64, winner: ContractAddress);
}

#[starknet::contract]
mod MockBM {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use bounty_manager::types::{Bounty, BountyStatus};

    #[storage]
    struct Storage {
        next_id: u64,
        bounties: Map<u64, Bounty>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl MockBMImpl of super::IMockBM<ContractState> {
        fn create_bounty(ref self: ContractState, reward_amount: u128, metadata_hash: felt252) -> u64 {
            assert(reward_amount.is_non_zero(), 'REWARD_ZERO');
            let bid = self.next_id.read();
            self.bounties.write(bid, Bounty {
                id: bid, creator: get_caller_address(), reward_amount,
                status: BountyStatus::Created, metadata_hash,
                created_at: get_block_timestamp(), funded_amount: 0,
                winner: starknet::contract_address_const::<0x0>(), winning_submission: 0,
            });
            self.next_id.write(bid + 1);
            bid
        }
        fn fund_bounty(ref self: ContractState, bounty_id: u64, amount: u128) {
            let mut b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(b.status == BountyStatus::Created, 'NOT_CREATED');
            assert(amount == b.reward_amount, 'AMOUNT_MISMATCH');
            b.funded_amount = amount;
            b.status = BountyStatus::Funded;
            self.bounties.write(bounty_id, b);
        }
        fn claim_payout(ref self: ContractState, bounty_id: u64) {
            let mut b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(b.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
            b.status = BountyStatus::Paid;
            self.bounties.write(bounty_id, b);
        }
        fn refund_bounty(ref self: ContractState, bounty_id: u64) {
            let mut b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(
                b.status == BountyStatus::Created
                    || b.status == BountyStatus::Funded
                    || b.status == BountyStatus::Open,
                'NOT_REFUNDABLE',
            );
            assert(b.winner.is_zero(), 'ALREADY_HAS_WINNER');
            b.status = BountyStatus::Refunded;
            self.bounties.write(bounty_id, b);
        }
        fn get_bounty(self: @ContractState, bounty_id: u64) -> Bounty {
            let b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            b
        }
        fn force_state(ref self: ContractState, bounty_id: u64, status: BountyStatus) {
            let mut b = self.bounties.read(bounty_id);
            b.status = status;
            self.bounties.write(bounty_id, b);
        }
        fn force_winner(ref self: ContractState, bounty_id: u64, winner: ContractAddress) {
            let mut b = self.bounties.read(bounty_id);
            b.winner = winner;
            self.bounties.write(bounty_id, b);
        }
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn investigator() -> ContractAddress { starknet::contract_address_const::<0x400>() }
fn pool_addr() -> ContractAddress { starknet::contract_address_const::<0x500>() }
fn attacker() -> ContractAddress { starknet::contract_address_const::<0x600>() }

fn lock_of(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array![secret].span())
}

#[derive(Drop, Copy)]
struct Ctx {
    bm: IMockBMDispatcher,
    anon: IVerityAnonymizerDispatcher,
    mock: IMockStrkDispatcher,
    bm_addr: ContractAddress,
    anon_addr: ContractAddress,
    mock_addr: ContractAddress,
}

fn setup() -> Ctx {
    let owner = owner();
    let creator = creator();
    // Mock BM (no auth needed: all mutating calls go through the helper).
    let bm_class = declare("MockBM").unwrap().contract_class();
    let (bm_addr, _) = bm_class.deploy(@array![]).unwrap();
    let bm = IMockBMDispatcher { contract_address: bm_addr };
    // Mock STRK, endow the creator.
    let mock_class = declare("MockStrk").unwrap().contract_class();
    let (mock_addr, _) = mock_class.deploy(@array![]).unwrap();
    let mock = IMockStrkDispatcher { contract_address: mock_addr };
    mock.mint(creator, 1_000_000_000_000_000_000_000_000_u256);
    mock.mint(investigator(), 1_000_000_000_000_000_000_000_000_u256);
    // Helper pointed at the mock token, wired to the mock BM.
    let anon_class = declare("VerityAnonymizer").unwrap().contract_class();
    let mut anon_calldata: Array<felt252> = array![];
    pool_addr().serialize(ref anon_calldata);
    bm_addr.serialize(ref anon_calldata);
    owner.serialize(ref anon_calldata);
    mock_addr.serialize(ref anon_calldata);
    let (anon_addr, _) = anon_class.deploy(@anon_calldata).unwrap();
    let anon = IVerityAnonymizerDispatcher { contract_address: anon_addr };
    Ctx { bm, anon, mock, bm_addr, anon_addr, mock_addr }
}

fn create_and_lock(
    ctx: @Ctx, reward: u128, fund_secret: felt252, refund_secret: felt252,
) -> u64 {
    start_cheat_caller_address(*ctx.bm_addr, creator());
    let bid = (*ctx.bm).create_bounty(reward, 'meta');
    stop_cheat_caller_address(*ctx.bm_addr);
    start_cheat_caller_address(*ctx.anon_addr, creator());
    (*ctx.anon).set_locks(bid, lock_of(fund_secret), lock_of(refund_secret));
    stop_cheat_caller_address(*ctx.anon_addr);
    bid
}

fn fund_as_pool(
    ctx: @Ctx, bid: u64, amount: u128, nonce: felt252, secret: felt252,
) -> Span<OpenNoteDeposit> {
    start_cheat_caller_address(*ctx.anon_addr, pool_addr());
    let out = (*ctx.anon)
        .privacy_invoke(ALLOWED_OP_FUND, bid, amount, nonce, 0, secret);
    stop_cheat_caller_address(*ctx.anon_addr);
    out
}

/// Drive a bounty to Claimable with the investigator as winner.
fn drive_to_claimable(ctx: @Ctx, reward: u128) -> u64 {
    let bid = create_and_lock(ctx, reward, 'fund-s', 'refund-s');
    // Emulate the withdraw leg: tokens arrive at the helper before the invoke.
    (*ctx.mock).mint(*ctx.anon_addr, reward.into());
    let _ = fund_as_pool(ctx, bid, reward, 'n-fund', 'fund-s');
    // Lifecycle mechanics (open/submit/select) are the real BM's tested
    // behavior; here we force the equivalent states on the double.
    (*ctx.bm).force_state(bid, BountyStatus::Open);
    (*ctx.bm).force_state(bid, BountyStatus::Claimable);
    (*ctx.bm).force_winner(bid, investigator());
    bid
}

// ---------------------------------------------------------------------------
// Poseidon parity with starknet.js (constants from hash.computePoseidonHashOnElements v10.5.0)
// ---------------------------------------------------------------------------

#[test]
fn test_poseidon_lock_parity_with_starknet_js() {
    let h1 = core::poseidon::poseidon_hash_span(array![0x1234].span());
    assert(
        h1 == 0x4e87ec1d3eba27ee5d1fb967121d0ae123b09f545e8f7cbd83f874d704659be,
        'parity 0x1234',
    );
    let h2 = core::poseidon::poseidon_hash_span(array![0xabcdef123456789].span());
    assert(
        h2 == 0x1276cdef3c9cab6498df7022e6f0e304cb1c0823ed3dfc139ac3b7e7d630425,
        'parity abcdef',
    );
    let h3 = core::poseidon::poseidon_hash_span(
        array![0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff].span(),
    );
    assert(
        h3 == 0x2416308baf2f5b8602265616dabf30e7d35c0a804b3c3ca8fecb0c4ae9f0d91,
        'parity maxfelt',
    );
}

// ---------------------------------------------------------------------------
// Lock authorization
// ---------------------------------------------------------------------------

#[test]
fn test_creator_can_set_locks() {
    let ctx = setup();
    start_cheat_caller_address(ctx.bm_addr, creator());
    let bid = ctx.bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(ctx.bm_addr);
    start_cheat_caller_address(ctx.anon_addr, creator());
    ctx.anon.set_locks(bid, lock_of('fs'), lock_of('rs'));
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.has_fund_lock(bid), 'fund lock missing');
    assert(ctx.anon.has_refund_lock(bid), 'refund lock missing');
    assert(!ctx.anon.has_payout_lock(bid), 'payout lock unexpected');
    assert(ctx.anon.get_escrow(bid) == 0, 'escrow nonzero');
}

#[test]
#[should_panic(expected: 'NOT_CREATOR')]
fn test_non_creator_cannot_set_locks() {
    let ctx = setup();
    start_cheat_caller_address(ctx.bm_addr, creator());
    let bid = ctx.bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(ctx.bm_addr);
    start_cheat_caller_address(ctx.anon_addr, attacker());
    ctx.anon.set_locks(bid, lock_of('fs'), lock_of('rs'));
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'BOUNTY_NOT_FOUND')]
fn test_set_locks_unknown_bounty_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, creator());
    ctx.anon.set_locks(999, lock_of('fs'), lock_of('rs'));
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'LOCK_ZERO')]
fn test_set_locks_zero_lock_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.bm_addr, creator());
    let bid = ctx.bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(ctx.bm_addr);
    start_cheat_caller_address(ctx.anon_addr, creator());
    ctx.anon.set_locks(bid, 0, lock_of('rs'));
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
fn test_creator_can_rotate_locks_before_funding() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'old-f', 'old-r');
    start_cheat_caller_address(ctx.anon_addr, creator());
    ctx.anon.set_locks(bid, lock_of('new-f'), lock_of('new-r'));
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.has_fund_lock(bid), 'lock missing after rotation');
    // New secret works for funding.
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let out = fund_as_pool(@ctx, bid, 1000, 'n-rot', 'new-f');
    assert(out.len() == 0, 'FUND_RETURNS_EMPTY');
}

#[test]
#[should_panic(expected: 'NOT_CREATED')]
fn test_funded_bounty_cannot_reset_locks() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n1', 'fund-s');
    start_cheat_caller_address(ctx.anon_addr, creator());
    ctx.anon.set_locks(bid, lock_of('x'), lock_of('y'));
    stop_cheat_caller_address(ctx.anon_addr);
}

// ---------------------------------------------------------------------------
// FUND
// ---------------------------------------------------------------------------

#[test]
fn test_fund_correct_secret_succeeds_exact_escrow_empty_deposits() {
    let ctx = setup();
    let reward: u128 = 10_000_000_000_000_000_000; // 10 STRK exact
    let bid = create_and_lock(@ctx, reward, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, reward.into());
    let out = fund_as_pool(@ctx, bid, reward, 'n-fund', 'fund-s');
    assert(out.len() == 0, 'FUND_RETURNS_EMPTY');
    let b = ctx.bm.get_bounty(bid);
    assert(b.status == BountyStatus::Funded, 'not Funded');
    assert(b.funded_amount == reward, 'funded amount mismatch');
    assert(ctx.anon.get_escrow(bid) == reward, 'escrow mismatch');
    assert(!ctx.anon.has_fund_lock(bid), 'fund lock not consumed');
    assert(ctx.anon.has_refund_lock(bid), 'refund lock wrongly cleared');
}

#[test]
#[should_panic(expected: 'BAD_SECRET')]
fn test_fund_wrong_secret_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-wrong', 'attacker-secret');
}

#[test]
#[should_panic(expected: 'SECRET_ZERO')]
fn test_fund_zero_secret_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-zero', 0);
}

#[test]
#[should_panic(expected: 'NO_FUND_LOCK')]
fn test_fund_without_lock_fails() {
    let ctx = setup();
    start_cheat_caller_address(ctx.bm_addr, creator());
    let bid = ctx.bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(ctx.bm_addr);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-nolock', 'any-secret');
}

#[test]
#[should_panic(expected: 'AMOUNT_MISMATCH')]
fn test_fund_wrong_amount_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    let _ = fund_as_pool(@ctx, bid, 999, 'n-amt', 'fund-s');
}

#[test]
#[should_panic(expected: 'AMOUNT_ZERO')]
fn test_fund_zero_amount_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    let _ = fund_as_pool(@ctx, bid, 0, 'n-amt0', 'fund-s');
}

#[test]
#[should_panic(expected: 'NO_FUND_LOCK')]
fn test_fund_nonexistent_bounty_fails() {
    let ctx = setup();
    let _ = fund_as_pool(@ctx, 9999, 1000, 'n-nob', 'any-secret');
}

#[test]
#[should_panic(expected: 'NOTE_MUST_BE_ZERO')]
fn test_fund_with_note_id_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx
        .anon
        .privacy_invoke(ALLOWED_OP_FUND, bid, 1000, 'n-note', 0xabc, 'fund-s');
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NO_FUND_LOCK')]
fn test_double_funding_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-first', 'fund-s');
    // Lock consumed AND status moved on: second attempt fails.
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-second', 'fund-s');
}

#[test]
#[should_panic(expected: 'REPLAY')]
fn test_fund_replay_same_nonce_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-replay', 'fund-s');
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-replay', 'fund-s');
}

#[test]
fn test_failed_fund_changes_nothing_then_correct_succeeds() {
    // Atomicity: a wrong-secret attempt leaves state, escrow and locks intact,
    // and the correct attempt afterwards succeeds (no partial corruption).
    let ctx = setup();
    let reward: u128 = 5_000_000_000_000_000_000;
    let bid = create_and_lock(@ctx, reward, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, reward.into());
    // Attempt with wrong secret via low-level call so the test survives the revert.
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let mut bad_calldata: Array<felt252> = array![];
    ALLOWED_OP_FUND.serialize(ref bad_calldata);
    bid.serialize(ref bad_calldata);
    reward.serialize(ref bad_calldata);
    'n-bad'.serialize(ref bad_calldata);
    let zero_note: felt252 = 0;
    zero_note.serialize(ref bad_calldata);
    'wrong'.serialize(ref bad_calldata);
    let res = starknet::syscalls::call_contract_syscall(
        ctx.anon_addr, selector!("privacy_invoke"), bad_calldata.span(),
    );
    stop_cheat_caller_address(ctx.anon_addr);
    assert(res.is_err(), 'wrong secret should revert');
    // Nothing changed.
    let b = ctx.bm.get_bounty(bid);
    assert(b.status == BountyStatus::Created, 'status moved on failure');
    assert(ctx.anon.get_escrow(bid) == 0, 'escrow moved on failure');
    assert(ctx.anon.has_fund_lock(bid), 'lock consumed on failure');
    // Correct attempt succeeds.
    let out = fund_as_pool(@ctx, bid, reward, 'n-good', 'fund-s');
    assert(out.len() == 0, 'FUND_RETURNS_EMPTY_2');
    let b2 = ctx.bm.get_bounty(bid);
    assert(b2.status == BountyStatus::Funded, 'not Funded after retry');
}

// ---------------------------------------------------------------------------
// REFUND
// ---------------------------------------------------------------------------

fn refund_as_pool(
    ctx: @Ctx, bid: u64, amount: u128, nonce: felt252, secret: felt252,
) -> Span<OpenNoteDeposit> {
    start_cheat_caller_address(*ctx.anon_addr, pool_addr());
    let out = (*ctx.anon)
        .privacy_invoke(ALLOWED_OP_REFUND, bid, amount, nonce, 0, secret);
    stop_cheat_caller_address(*ctx.anon_addr);
    out
}

#[test]
fn test_refund_correct_secret_returns_escrow_to_creator() {
    let ctx = setup();
    let reward: u128 = 3_000_000_000_000_000_000; // 3 STRK
    let bid = create_and_lock(@ctx, reward, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, reward.into());
    let _ = fund_as_pool(@ctx, bid, reward, 'n-fund', 'fund-s');
    let before = ctx.mock.balance_of(creator());
    let out = refund_as_pool(@ctx, bid, reward, 'n-refund', 'refund-s');
    assert(out.len() == 0, 'REFUND_RETURNS_EMPTY');
    let b = ctx.bm.get_bounty(bid);
    assert(b.status == BountyStatus::Refunded, 'not Refunded');
    assert(ctx.anon.get_escrow(bid) == 0, 'escrow not cleared');
    assert(!ctx.anon.has_refund_lock(bid), 'refund lock not cleared');
    assert(!ctx.anon.has_fund_lock(bid), 'fund lock not cleared');
    let got = ctx.mock.balance_of(creator());
    assert(got - before == reward.into(), 'creator not repaid exact escrow');
}

#[test]
#[should_panic(expected: 'BAD_SECRET')]
fn test_refund_wrong_secret_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-fund', 'fund-s');
    let _ = refund_as_pool(@ctx, bid, 1000, 'n-refund', 'wrong-secret');
}

#[test]
fn test_refund_unfunded_bounty_is_pure_bookkeeping() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    let out = refund_as_pool(@ctx, bid, 0, 'n-refund', 'refund-s');
    assert(out.len() == 0, 'REFUND_RETURNS_EMPTY_2');
    let b = ctx.bm.get_bounty(bid);
    assert(b.status == BountyStatus::Refunded, 'not Refunded');
    assert(!ctx.anon.has_refund_lock(bid), 'lock not cleared');
}

#[test]
#[should_panic(expected: 'NO_REFUND_LOCK')]
fn test_double_refund_fails() {
    let ctx = setup();
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-fund', 'fund-s');
    let _ = refund_as_pool(@ctx, bid, 1000, 'n-r1', 'refund-s');
    let _ = refund_as_pool(@ctx, bid, 1000, 'n-r2', 'refund-s');
}

// ---------------------------------------------------------------------------
// RELEASE (two-stage payout locks)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'NOT_WINNER')]
fn test_only_winner_can_register_payout_lock() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    start_cheat_caller_address(ctx.anon_addr, attacker());
    ctx.anon.register_payout_lock(bid, lock_of('attacker-lock'));
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NO_WINNER')]
fn test_payout_lock_without_winner_rejected() {
    let ctx = setup();
    // Funded+Open but no winner yet: register must fail.
    let bid = create_and_lock(@ctx, 1000, 'fund-s', 'refund-s');
    ctx.mock.mint(ctx.anon_addr, 1000_u256);
    let _ = fund_as_pool(@ctx, bid, 1000, 'n-fund', 'fund-s');
    ctx.bm.force_state(bid, BountyStatus::Open);
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('early-lock'));
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
fn test_release_full_flow_exact_escrow_exact_allowance() {
    let ctx = setup();
    let reward: u128 = 2_000_000_000_000_000_000; // 2 STRK
    let bid = drive_to_claimable(@ctx, reward);
    // Winner registers payout lock (direct call, authenticated as winner).
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('pay-s'));
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.has_payout_lock(bid), 'payout lock missing');
    assert(ctx.anon.get_escrow(bid) == reward, 'escrow mismatch pre-release');
    // Release as pool: open note for the winner + secret.
    let note_id: felt252 = 0x77aa;
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, reward, 'n-rel', note_id, 'pay-s');
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.len() == 1, 'RELEASE_ONE_DEPOSIT');
    let deposit: OpenNoteDeposit = *out.at(0);
    assert(deposit.note_id == note_id, 'note_id mismatch');
    assert(deposit.amount == reward, 'deposit amount mismatch');
    assert(deposit.token == ctx.mock_addr, 'DEPOSIT_TOKEN_MISMATCH');
    // Escrow deducted, BM paid, lock consumed.
    assert(ctx.anon.get_escrow(bid) == 0, 'escrow not cleared');
    assert(!ctx.anon.has_payout_lock(bid), 'payout lock not consumed');
    let b = ctx.bm.get_bounty(bid);
    assert(b.status == BountyStatus::Paid, 'not Paid');
    // Allowance is EXACT (== reward), helper still holds the backing.
    let allowance = ctx.mock.allowance(ctx.anon_addr, pool_addr());
    assert(allowance == reward.into(), 'ALLOWANCE_NOT_EXACT');
    // Emulate the pool's pull: it must succeed and consume the allowance fully.
    let pool_before = ctx.mock.balance_of(pool_addr());
    start_cheat_caller_address(ctx.mock_addr, pool_addr());
    let pulled = ctx.mock.transfer_from(ctx.anon_addr, pool_addr(), reward.into());
    stop_cheat_caller_address(ctx.mock_addr);
    assert(pulled, 'pool pull failed');
    assert(ctx.mock.allowance(ctx.anon_addr, pool_addr()) == 0, 'allowance not consumed');
    assert(ctx.mock.balance_of(pool_addr()) - pool_before == reward.into(), 'pool not funded');
}

#[test]
#[should_panic(expected: 'NO_PAYOUT_LOCK')]
fn test_attacker_cannot_release_without_lock() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    // Attacker submits a release naming their own note: no lock -> fails closed.
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1000, 'n-atk', 0x999, 'atk-secret');
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'BAD_SECRET')]
fn test_release_wrong_secret_fails() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('pay-s'));
    stop_cheat_caller_address(ctx.anon_addr);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1000, 'n-bad', 0x77, 'wrong');
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'AMOUNT_MISMATCH')]
fn test_release_over_release_fails() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('pay-s'));
    stop_cheat_caller_address(ctx.anon_addr);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1001, 'n-over', 0x77, 'pay-s');
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NO_PAYOUT_LOCK')]
fn test_double_release_fails() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('pay-s'));
    stop_cheat_caller_address(ctx.anon_addr);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1000, 'n-r1', 0x77, 'pay-s');
    stop_cheat_caller_address(ctx.anon_addr);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1000, 'n-r2', 0x78, 'pay-s');
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NOTE_ZERO')]
fn test_release_zero_note_id_fails() {
    let ctx = setup();
    let bid = drive_to_claimable(@ctx, 1000);
    start_cheat_caller_address(ctx.anon_addr, investigator());
    ctx.anon.register_payout_lock(bid, lock_of('pay-s'));
    stop_cheat_caller_address(ctx.anon_addr);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_RELEASE, bid, 1000, 'n-nonote', 0, 'pay-s');
    stop_cheat_caller_address(ctx.anon_addr);
}
