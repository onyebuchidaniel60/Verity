//! Private investigator stake tests for VerityAnonymizer
//! (docs/PRIVATE_INVESTIGATOR.md).
//!
//! Covers the helper side of the §20 matrix: STAKE escrow with real backing,
//! SUBMIT/REG_PAYOUT relays, UNSTAKE exact-backed notes, slash routing, slot
//! validation, pool-only auth, replay. BM behavior behind the callbacks is
//! covered by the bounty_manager package's own private-identity tests; here
//! the BM is a shape-faithful double (StakeMockBM) with test backdoors, per
//! the established MockBM strategy in funding_test.cairo.
//!
//! Identity vectors: seed 0x1234 chain, genesis
//! 0x73e2289a… (see private_identity_test.cairo for the JS↔Cairo parity
//! proof of the same chain).

#[feature("deprecated-starknet-consts")]
use core::num::traits::Zero;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use verity_anonymizer::verity_anonymizer::{
    IVerityAnonymizerDispatcher, IVerityAnonymizerDispatcherTrait, ALLOWED_OP_STAKE,
    ALLOWED_OP_SUBMIT, ALLOWED_OP_REG_PAYOUT, ALLOWED_OP_UNSTAKE,
};
use privacy::objects::OpenNoteDeposit;

const STAKE_AMOUNT: u128 = 1000000000000000000; // 1 STRK default
const IDENTITY_A: felt252 = 0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973;
const PRE_A1: felt252 = 0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265;
const IDENTITY_B: felt252 = 0x5e64767a10b2a0e8fa4a66d76a4cf0d23b846e049d17e4bf8080613ece0fb7a;
const PRE_B1: felt252 = 0x461b08ca930e3a78e9c2648185e31b2f01c294818d16631fe3b43f0ac5c1aec;

// ---------------------------------------------------------------------------
// StakeMockStrk: minimal ERC20 double (own copy; funding_test owns MockStrk).
// ---------------------------------------------------------------------------

#[starknet::interface]
trait IStakeMockStrk<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
mod StakeMockStrk {
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
    impl StakeMockStrkImpl of super::IStakeMockStrk<ContractState> {
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
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.write(recipient, self.balances.read(recipient) + amount);
        }
    }
}

// ---------------------------------------------------------------------------
// StakeMockBM: shape-faithful BM double for the identity callbacks.
// Mirrors the real checks the helper depends on (exact stake amount,
// slashed gate); all deeper logic lives in the real BM's own tests.
// ---------------------------------------------------------------------------

#[starknet::interface]
trait IStakeMockBM<T> {
    fn register_stake_identity(ref self: T, identity: felt252, amount: u128);
    fn submit_private(ref self: T, bounty_id: u64, evidence_hash: felt252, preimage: felt252) -> u64;
    fn register_private_payout_lock(ref self: T, bounty_id: u64, payout_lock: felt252, preimage: felt252);
    fn consume_preimage_by_tip(ref self: T, preimage: felt252) -> felt252;
    fn is_identity_slashed(self: @T, identity: felt252) -> bool;
    fn mock_expect(ref self: T, preimage: felt252, identity: felt252);
    fn mock_slashed(ref self: T, identity: felt252, slashed: bool);
    fn is_registered(self: @T, identity: felt252) -> bool;
    fn last_submit(self: @T) -> (u64, felt252, felt252);
    fn payout_lock_for(self: @T, bounty_id: u64) -> felt252;
}

#[starknet::contract]
mod StakeMockBM {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        registered: Map<felt252, bool>,
        slashed: Map<felt252, bool>,
        tip_owner: Map<felt252, felt252>,
        submit_count: u64,
        last_bounty: u64,
        last_evidence: felt252,
        last_preimage: felt252,
        payout_locks: Map<u64, felt252>,
    }

    #[abi(embed_v0)]
    impl StakeMockBMImpl of super::IStakeMockBM<ContractState> {
        fn register_stake_identity(ref self: ContractState, identity: felt252, amount: u128) {
            assert(amount == 1000000000000000000, 'AMOUNT_MISMATCH');
            assert(!self.slashed.read(identity), 'IS_SLASHED_CANNOT_STAKE');
            self.registered.write(identity, true);
        }
        fn submit_private(
            ref self: ContractState, bounty_id: u64, evidence_hash: felt252, preimage: felt252,
        ) -> u64 {
            self.last_bounty.write(bounty_id);
            self.last_evidence.write(evidence_hash);
            self.last_preimage.write(preimage);
            let n = self.submit_count.read() + 1;
            self.submit_count.write(n);
            n
        }
        fn register_private_payout_lock(
            ref self: ContractState, bounty_id: u64, payout_lock: felt252, preimage: felt252,
        ) {
            assert(preimage.is_non_zero(), 'PREIMAGE_ZERO');
            self.payout_locks.write(bounty_id, payout_lock);
        }
        fn consume_preimage_by_tip(ref self: ContractState, preimage: felt252) -> felt252 {
            let id = self.tip_owner.read(preimage);
            assert(id.is_non_zero(), 'UNKNOWN_PREIMAGE');
            id
        }
        fn is_identity_slashed(self: @ContractState, identity: felt252) -> bool {
            self.slashed.read(identity)
        }
        fn mock_expect(ref self: ContractState, preimage: felt252, identity: felt252) {
            self.tip_owner.write(preimage, identity);
        }
        fn mock_slashed(ref self: ContractState, identity: felt252, slashed: bool) {
            self.slashed.write(identity, slashed);
        }
        fn is_registered(self: @ContractState, identity: felt252) -> bool {
            self.registered.read(identity)
        }
        fn last_submit(self: @ContractState) -> (u64, felt252, felt252) {
            (self.last_bounty.read(), self.last_evidence.read(), self.last_preimage.read())
        }
        fn payout_lock_for(self: @ContractState, bounty_id: u64) -> felt252 {
            self.payout_locks.read(bounty_id)
        }
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn pool_addr() -> ContractAddress { starknet::contract_address_const::<0x500>() }
fn attacker() -> ContractAddress { starknet::contract_address_const::<0x600>() }

#[derive(Drop, Copy)]
struct Ctx {
    bm: IStakeMockBMDispatcher,
    anon: IVerityAnonymizerDispatcher,
    mock: IStakeMockStrkDispatcher,
    bm_addr: ContractAddress,
    anon_addr: ContractAddress,
    mock_addr: ContractAddress,
}

fn setup() -> Ctx {
    let bm_class = declare("StakeMockBM").unwrap().contract_class();
    let (bm_addr, _) = bm_class.deploy(@array![]).unwrap();
    let bm = IStakeMockBMDispatcher { contract_address: bm_addr };
    let mock_class = declare("StakeMockStrk").unwrap().contract_class();
    let (mock_addr, _) = mock_class.deploy(@array![]).unwrap();
    let mock = IStakeMockStrkDispatcher { contract_address: mock_addr };
    let anon_class = declare("VerityAnonymizer").unwrap().contract_class();
    let mut anon_calldata: Array<felt252> = array![];
    pool_addr().serialize(ref anon_calldata);
    bm_addr.serialize(ref anon_calldata);
    owner().serialize(ref anon_calldata);
    mock_addr.serialize(ref anon_calldata);
    let (anon_addr, _) = anon_class.deploy(@anon_calldata).unwrap();
    let anon = IVerityAnonymizerDispatcher { contract_address: anon_addr };
    Ctx { bm, anon, mock, bm_addr, anon_addr, mock_addr }
}

fn stake_as_pool(ctx: @Ctx, amount: u128, nonce: felt252, identity: felt252) -> Span<OpenNoteDeposit> {
    start_cheat_caller_address(*ctx.anon_addr, pool_addr());
    let out = (*ctx.anon).privacy_invoke(ALLOWED_OP_STAKE, 0, amount, nonce, 0, identity);
    stop_cheat_caller_address(*ctx.anon_addr);
    out
}

// --- STAKE ---------------------------------------------------------------

#[test]
fn test_stake_records_backed_escrow_without_wallet() {
    let ctx = setup();
    // Emulate the private withdraw leg: real STRK lands on the helper first.
    ctx.mock.mint(ctx.anon_addr, STAKE_AMOUNT.into());
    let deposits = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-1', IDENTITY_A);
    assert(deposits.is_empty(), 'stake must return no notes');
    assert(ctx.anon.get_stake_escrow(IDENTITY_A) == STAKE_AMOUNT, 'escrow mismatch');
    assert(ctx.bm.is_registered(IDENTITY_A), 'BM not notified');
    // The record is the commitment alone: it equals no participating wallet.
    let pool_felt: felt252 = pool_addr().into();
    let owner_felt: felt252 = owner().into();
    assert(IDENTITY_A != pool_felt, 'wallet leaked');
    assert(IDENTITY_A != owner_felt, 'wallet leaked');
}

#[test]
#[should_panic(expected: 'STAKE_NOT_BACKED')]
fn test_stake_without_backing_reverts() {
    let ctx = setup();
    // No withdraw leg → helper holds nothing → forged stake impossible.
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-2', IDENTITY_A);
}

#[test]
#[should_panic(expected: 'STAKE_NOT_BACKED')]
fn test_stake_partial_backing_reverts() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, (STAKE_AMOUNT - 1).into());
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-3', IDENTITY_A);
}

#[test]
#[should_panic(expected: 'STAKE_ACTIVE')]
fn test_stake_duplicate_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, (2 * STAKE_AMOUNT).into());
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-4', IDENTITY_A);
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-5', IDENTITY_A);
}

#[test]
#[should_panic(expected: 'NOT_POOL')]
fn test_stake_direct_caller_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, STAKE_AMOUNT.into());
    // A wallet calling privacy_invoke directly (not via the pool) is refused:
    // stake must arrive through the STRK20 flow so the origin stays hidden.
    start_cheat_caller_address(ctx.anon_addr, attacker());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_STAKE, 0, STAKE_AMOUNT, 'n-x', 0, IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'BOUNTY_MUST_BE_ZERO')]
fn test_stake_nonzero_bounty_slot_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, STAKE_AMOUNT.into());
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_STAKE, 7, STAKE_AMOUNT, 'n-x', 0, IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NOTE_MUST_BE_ZERO')]
fn test_stake_nonzero_note_slot_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, STAKE_AMOUNT.into());
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_STAKE, 0, STAKE_AMOUNT, 'n-x', 0xabc, IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'IDENTITY_ZERO')]
fn test_stake_zero_identity_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_STAKE, 0, STAKE_AMOUNT, 'n-x', 0, 0);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'AMOUNT_MISMATCH')]
fn test_stake_wrong_amount_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, (2 * STAKE_AMOUNT).into());
    // Backed, but not the configured stake amount → BM refuses.
    let _ = stake_as_pool(@ctx, 2 * STAKE_AMOUNT, 'n-stake-6', IDENTITY_A);
}

// --- SUBMIT relay --------------------------------------------------------

#[test]
fn test_submit_relay_forwards_evidence_and_preimage() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_SUBMIT, 3, 0, 'n-sub-1', 'ev-hash', PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.is_empty(), 'submit returns no notes');
    let (bid, ev, pre) = ctx.bm.last_submit();
    assert(bid == 3, 'bounty mismatch');
    assert(ev == 'ev-hash', 'evidence mismatch');
    assert(pre == PRE_A1, 'preimage mismatch');
}

#[test]
#[should_panic(expected: 'AMOUNT_MUST_BE_ZERO')]
fn test_submit_nonzero_amount_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_SUBMIT, 3, 9, 'n-x', 'ev', PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'EVIDENCE_ZERO')]
fn test_submit_zero_evidence_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_SUBMIT, 3, 0, 'n-x', 0, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NOT_POOL')]
fn test_submit_direct_caller_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, attacker());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_SUBMIT, 3, 0, 'n-x', 'ev', PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- REG_PAYOUT relay ------------------------------------------------------

#[test]
fn test_reg_payout_relay_stores_lock() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_REG_PAYOUT, 5, 0, 'n-reg-1', 0x9a910c4, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.is_empty(), 'reg returns no notes');
    // The verified lock lands in the helper map the RELEASE op reads.
    assert(ctx.anon.has_payout_lock(5), 'lock not stored');
    assert(ctx.bm.payout_lock_for(5) == 0x9a910c4, 'BM not notified');
}

#[test]
#[should_panic(expected: 'LOCK_ZERO')]
fn test_reg_payout_zero_lock_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_REG_PAYOUT, 5, 0, 'n-x', 0, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- UNSTAKE ---------------------------------------------------------------

fn stake_backed(ctx: @Ctx, identity: felt252, nonce: felt252) {
    (*ctx.mock).mint(*ctx.anon_addr, STAKE_AMOUNT.into());
    let _ = stake_as_pool(ctx, STAKE_AMOUNT, nonce, identity);
}

#[test]
fn test_unstake_returns_exact_backed_note() {
    let ctx = setup();
    stake_backed(@ctx, IDENTITY_A, 'n-stake-10');
    ctx.bm.mock_expect(PRE_A1, IDENTITY_A);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_UNSTAKE, 0, 0, 'n-un-1', 0xbeef01, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.len() == 1, 'one deposit');
    let d = *out.at(0);
    assert(d.note_id == 0xbeef01, 'note mismatch');
    assert(d.amount == STAKE_AMOUNT, 'amount mismatch');
    assert(ctx.anon.get_stake_escrow(IDENTITY_A) == 0, 'escrow not cleared');
    // Exact, single-use approval for the pool pull.
    assert(ctx.mock.allowance(ctx.anon_addr, pool_addr()) == STAKE_AMOUNT.into(), 'allowance');
}

#[test]
#[should_panic(expected: 'IS_SLASHED_CANNOT_WITHDRAW')]
fn test_unstake_slashed_blocked() {
    let ctx = setup();
    stake_backed(@ctx, IDENTITY_A, 'n-stake-11');
    ctx.bm.mock_expect(PRE_A1, IDENTITY_A);
    ctx.bm.mock_slashed(IDENTITY_A, true);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_UNSTAKE, 0, 0, 'n-un-2', 0xbeef01, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NO_STAKE')]
fn test_unstake_without_escrow_reverts() {
    let ctx = setup();
    // Preimage valid, but nothing escrowed under the identity.
    ctx.bm.mock_expect(PRE_A1, IDENTITY_A);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_UNSTAKE, 0, 0, 'n-un-3', 0xbeef01, PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'UNKNOWN_PREIMAGE')]
fn test_unstake_unknown_preimage_reverts() {
    let ctx = setup();
    stake_backed(@ctx, IDENTITY_A, 'n-stake-12');
    // Attacker without any chain preimage cannot touch the stake.
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_UNSTAKE, 0, 0, 'n-un-4', 0xbeef01, 0xbad9e);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- Slash routing -----------------------------------------------------------

#[test]
fn test_slash_stake_routes_escrow_to_treasury() {
    let ctx = setup();
    stake_backed(@ctx, IDENTITY_A, 'n-stake-13');
    start_cheat_caller_address(ctx.anon_addr, ctx.bm_addr);
    ctx.anon.slash_stake(IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.get_stake_escrow(IDENTITY_A) == 0, 'escrow not cleared');
    assert(ctx.mock.balance_of(owner()) == STAKE_AMOUNT.into(), 'treasury mismatch');
}

#[test]
#[should_panic(expected: 'NOT_BOUNTY_MANAGER')]
fn test_slash_stake_non_bm_rejected() {
    let ctx = setup();
    stake_backed(@ctx, IDENTITY_A, 'n-stake-14');
    // Even the owner cannot slash directly: only the dispute flow (BM) can.
    start_cheat_caller_address(ctx.anon_addr, owner());
    ctx.anon.slash_stake(IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- Isolation + replay ------------------------------------------------------

#[test]
fn test_two_identities_isolated() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, (2 * STAKE_AMOUNT).into());
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-20', IDENTITY_A);
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-stake-21', IDENTITY_B);
    // Slash A at the BM's order; B's escrow is untouched and withdrawable.
    start_cheat_caller_address(ctx.anon_addr, ctx.bm_addr);
    ctx.anon.slash_stake(IDENTITY_A);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.get_stake_escrow(IDENTITY_B) == STAKE_AMOUNT, 'B escrow moved');
    ctx.bm.mock_expect(PRE_B1, IDENTITY_B);
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_UNSTAKE, 0, 0, 'n-un-20', 0xbeef08, PRE_B1);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.len() == 1, 'B unstake failed');
    assert((*out.at(0)).amount == STAKE_AMOUNT, 'B amount');
}

#[test]
#[should_panic(expected: 'REPLAY')]
fn test_identity_nonce_replay_rejected() {
    let ctx = setup();
    ctx.mock.mint(ctx.anon_addr, STAKE_AMOUNT.into());
    let _ = stake_as_pool(@ctx, STAKE_AMOUNT, 'n-replay', IDENTITY_A);
    // Same nonce for a second op → replay protection fires first.
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_SUBMIT, 1, 0, 'n-replay', 'ev', PRE_A1);
    stop_cheat_caller_address(ctx.anon_addr);
}
