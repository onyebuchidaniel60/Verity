//! Private investigator identity tests (docs/PRIVATE_INVESTIGATOR.md).
//!
//! Covers the §20/§21 privacy/authorization matrix for commitment-keyed
//! staking + reputation. Every test is structural: it asserts WHAT is stored
//! (commitments only, never wallets) and WHO can act (preimage knowledge, not
//! caller address).
//!
//! Hash-chain vectors (seed 0x1234, single-Poseidon iteration) were generated
//! with the installed `starknet@10.5.0`
//! (`hash.computePoseidonHashOnElements`); the same constants appear in the
//! frontend `identity.regression.test.ts`. Cairo `poseidon_hash_span` agreeing
//! with them is the JS↔Cairo parity proof for chains (cf. the fund-lock
//! parity test — indeed `H(0x1234)` here equals that test's constant).
//!
//! Test double: MockStakeHelper stands in for VerityAnonymizer (snforge
//! cannot cross-`declare` workspace packages). It mirrors exactly what BM
//! depends on: `get_stake_escrow` (settable per identity) and `slash_stake`
//! (records the slashed identity). Real helper behavior is covered by the
//! anonymizer package's own stake tests.

#[feature("deprecated-starknet-consts")]
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{
    IBountyManagerDispatcher, IBountyManagerDispatcherTrait, identity_to_address,
};
use bounty_manager::types::{BountyStatus, SubmissionStatus};

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn stranger() -> ContractAddress { starknet::contract_address_const::<0x999>() }

const STAKE_AMOUNT: u128 = 1000000000000000000; // 1 STRK default

// Seed 0x1234 chain: c_{k+1} = Poseidon(c_k).
const SEED_A: felt252 = 0x1234;
const A_C63: felt252 = 0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265;
const A_GENESIS: felt252 = 0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973;
// Second identity, seed 0xabcdef123456789.
const SEED_B: felt252 = 0xabcdef123456789;
const B_C63: felt252 = 0x461b08ca930e3a78e9c2648185e31b2f01c294818d16631fe3b43f0ac5c1aec;
const B_GENESIS: felt252 = 0x5e64767a10b2a0e8fa4a66d76a4cf0d23b846e049d17e4bf8080613ece0fb7a;

fn poseidon1(x: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array![x].span())
}

// c_k: Poseidon iterated k times from seed (c_0 = seed). Genesis tip = c_64.
fn chain_at(seed: felt252, k: u64) -> felt252 {
    let mut v = seed;
    let mut i = 0;
    while i < k {
        v = poseidon1(v);
        i += 1;
    };
    v
}

#[starknet::interface]
trait IMockStakeHelper<T> {
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    fn slash_stake(ref self: T, identity: felt252);
    fn set_escrow(ref self: T, identity: felt252, amount: u128);
    fn slashed_identity(self: @T) -> felt252;
}

#[starknet::contract]
mod MockStakeHelper {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        escrow: Map<felt252, u128>,
        slashed: felt252,
    }

    #[abi(embed_v0)]
    impl MockStakeHelperImpl of super::IMockStakeHelper<ContractState> {
        fn get_stake_escrow(self: @ContractState, identity: felt252) -> u128 {
            self.escrow.read(identity)
        }
        fn slash_stake(ref self: ContractState, identity: felt252) {
            self.slashed.write(identity);
            self.escrow.write(identity, 0);
        }
        fn set_escrow(ref self: ContractState, identity: felt252, amount: u128) {
            self.escrow.write(identity, amount);
        }
        fn slashed_identity(self: @ContractState) -> felt252 {
            self.slashed.read()
        }
    }
}

fn deploy_bm() -> (ContractAddress, IBountyManagerDispatcher) {
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    (addr, IBountyManagerDispatcher { contract_address: addr })
}

fn deploy_helper() -> (ContractAddress, IMockStakeHelperDispatcher) {
    let cls = declare("MockStakeHelper").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![]).unwrap();
    (addr, IMockStakeHelperDispatcher { contract_address: addr })
}

fn wire(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, helper: ContractAddress) {
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(helper);
    stop_cheat_caller_address(bm_addr);
}

// Register identity A through the helper (pool-routed in production).
fn register_a(bm_addr: ContractAddress, bm: IBountyManagerDispatcher) {
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
}

fn open_bounty(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, helper: ContractAddress) -> u64 {
    start_cheat_caller_address(bm_addr, creator());
    let bid = bm.create_bounty(1000, 'meta');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, helper);
    bm.fund_bounty(bid, 1000);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    bid
}

// --- Chain parity: Cairo core Poseidon agrees with the JS vectors ---------

#[test]
fn test_chain_parity_with_js_vectors() {
    // H(SEED_A) side-checks are covered by the fund-lock parity test; here the
    // full 64-step chain must land exactly on the JS-computed genesis.
    let mut v = SEED_A;
    let mut i = 0;
    while i < 63_u64 {
        v = poseidon1(v);
        i += 1;
    };
    assert(v == A_C63, 'c63 mismatch');
    assert(poseidon1(v) == A_GENESIS, 'genesis mismatch');
    // Second identity vector.
    let mut w = SEED_B;
    let mut j = 0;
    while j < 63_u64 {
        w = poseidon1(w);
        j += 1;
    };
    assert(w == B_C63, 'B c63 mismatch');
    assert(poseidon1(w) == B_GENESIS, 'B genesis mismatch');
}

// --- Registration: baseline, no wallet in record --------------------------

#[test]
fn test_private_register_baseline_no_wallet_record() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    assert(bm.is_identity_registered(A_GENESIS), 'not registered');
    assert(bm.get_identity_tip(A_GENESIS) == A_GENESIS, 'tip != genesis');
    // Baseline reputation 60, matching legacy stake economics.
    assert(bm.get_identity_reputation(A_GENESIS) == 60, 'rep != 60');
    assert(!bm.is_identity_slashed(A_GENESIS), 'slashed at birth');
    // The ONLY stored values are the commitment itself: it equals no wallet.
    let tip = bm.get_identity_tip(A_GENESIS);
    let creator_felt: felt252 = creator().into();
    let owner_felt: felt252 = owner().into();
    assert(tip != creator_felt, 'wallet leaked');
    assert(tip != owner_felt, 'wallet leaked');
    assert(A_GENESIS != creator_felt, 'wallet leaked');
    // No escrow yet → not eligible (stake proof missing).
    assert(!bm.is_identity_eligible(A_GENESIS), 'eligible w/o escrow');
    assert(bm.get_identity_stake(A_GENESIS) == 0, 'stake nonzero');
}

#[test]
fn test_private_register_idempotent_preserves_history() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    // Second registration (re-stake after unstake) keeps reputation history.
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_identity_reputation(A_GENESIS) == 60, 'rep reset');
    // Escrow makes the identity eligible.
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    assert(bm.is_identity_eligible(A_GENESIS), 'not eligible');
}

#[test]
#[should_panic(expected: 'NOT_ANONYMIZER')]
fn test_private_register_direct_caller_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    // A wallet calling register directly (bypassing the pool) is rejected:
    // stake must arrive through the STRK20 flow.
    start_cheat_caller_address(bm_addr, stranger());
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'AMOUNT_MISMATCH')]
fn test_private_register_wrong_amount_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT - 1);
    stop_cheat_caller_address(bm_addr);
}

// --- Submission gating -----------------------------------------------------

#[test]
#[should_panic(expected: 'NOT_STAKED')]
fn test_private_submit_without_escrow_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    // Registered + reputable, but zero escrow → cannot submit.
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let _ = bm.submit_private(bid, 'evidence', A_C63);
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_private_submit_flow_links_submits_to_identity() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    // First submit consumes c63; tip advances to c63.
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'evidence_one', A_C63);
    stop_cheat_caller_address(bm_addr);
    assert(sid == 1, 'sub id');
    let sub = bm.get_submission(bid, sid);
    assert(sub.identity == A_GENESIS, 'identity link broken');
    assert(sub.status == SubmissionStatus::Pending, 'not Pending');
    // No wallet recorded: investigator is the identity pseudonym.
    assert(sub.investigator == identity_to_address(A_GENESIS), 'pseudo mismatch');
    assert(sub.investigator != creator(), 'wallet recorded');
    assert(bm.get_identity_tip(A_GENESIS) == A_C63, 'tip did not advance');
    // Second submit consumes c62 — reputation/history stays with A.
    let c62 = chain_at(SEED_A, 62);
    // walk c62 forward check: H(c62) == c63
    assert(poseidon1(c62) == A_C63, 'chain order');
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid2 = bm.submit_private(bid, 'evidence_two', c62);
    stop_cheat_caller_address(bm_addr);
    assert(sid2 == 2, 'sub2 id');
    assert(bm.get_submission(bid, sid2).identity == A_GENESIS, 'link broken 2');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_private_submit_replay_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let _ = bm.submit_private(bid, 'e1', A_C63);
    // Replaying the consumed preimage fails: tip already advanced past it.
    let _ = bm.submit_private(bid, 'e2', A_C63);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'UNKNOWN_PREIMAGE')]
fn test_private_submit_forged_preimage_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    // Attacker invents a preimage: Poseidon maps it to an unknown tip.
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let _ = bm.submit_private(bid, 'evil', 0xdeadbeef);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'REPUTATION_TOO_LOW')]
fn test_private_reputation_threshold_enforced() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_minimum_reputation(90);
    stop_cheat_caller_address(bm_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    assert(!bm.is_identity_eligible(A_GENESIS), 'eligible below threshold');
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let _ = bm.submit_private(bid, 'e', A_C63);
    stop_cheat_caller_address(bm_addr);
}

// --- Winner / reputation evolution -----------------------------------------

#[test]
fn test_private_win_increases_reputation_capped() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'winning', A_C63);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.select_winner(bid, sid);
    stop_cheat_caller_address(bm_addr);
    // Winner recorded as the identity pseudonym; rep 60 → 70.
    assert(bm.get_winner(bid) == identity_to_address(A_GENESIS), 'winner link');
    assert(bm.get_identity_reputation(A_GENESIS) == 70, 'rep != 70');
    let b = bm.get_bounty(bid);
    assert(b.status == BountyStatus::Claimable, 'not Claimable');
}

// --- Dispute: challenge needs no wallet, slash hits the right identity -----

fn report_a(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, bid: u64, sid: u64) {
    start_cheat_caller_address(bm_addr, creator());
    bm.report_submission(bid, sid, 'FRAUD', 'proof');
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_private_challenge_from_unrelated_account() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'maybe_bad', A_C63);
    stop_cheat_caller_address(bm_addr);
    report_a(bm_addr, bm, bid, sid);
    // Challenger is a STRANGER account: preimage knowledge is the ONLY auth.
    // This proves eligibility/ownership never depends on the wallet.
    let c62 = chain_at(SEED_A, 62);
    start_cheat_caller_address(bm_addr, stranger());
    bm.challenge_private_report(bid, sid, c62);
    stop_cheat_caller_address(bm_addr);
    let rep = bm.get_report(bid, sid);
    assert(rep.challenged, 'not challenged');
    assert(bm.get_identity_reputation(A_GENESIS) == 60, 'rep moved');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_private_challenge_wrong_preimage_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'maybe_bad', A_C63);
    stop_cheat_caller_address(bm_addr);
    report_a(bm_addr, bm, bid, sid);
    // Attacker guesses B's preimage for A's report: tip mismatch → rejected.
    start_cheat_caller_address(bm_addr, stranger());
    bm.challenge_private_report(bid, sid, B_C63);
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_private_slash_hits_correct_identity_only() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    // Two independent private identities stake + submit.
    register_a(bm_addr, bm);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_stake_identity(B_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    helper.set_escrow(B_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid_a = bm.submit_private(bid, 'bad', A_C63);
    let sid_b = bm.submit_private(bid, 'good', B_C63);
    stop_cheat_caller_address(bm_addr);
    // Report + slash A's submission (unchallenged path past deadline).
    report_a(bm_addr, bm, bid, sid_a);
    snforge_std::start_cheat_block_timestamp(bm_addr, 259201);
    start_cheat_caller_address(bm_addr, creator());
    bm.resolve_report(bid, sid_a, true);
    stop_cheat_caller_address(bm_addr);
    snforge_std::stop_cheat_block_timestamp(bm_addr);
    // A slashed: rep 60 → 40, flagged, helper slash invoked.
    assert(bm.is_identity_slashed(A_GENESIS), 'A not slashed');
    assert(bm.get_identity_reputation(A_GENESIS) == 40, 'A rep != 40');
    assert(!bm.is_identity_eligible(A_GENESIS), 'A still eligible');
    // B untouched: rep, flags, eligibility, submission all intact.
    assert(!bm.is_identity_slashed(B_GENESIS), 'B slashed!');
    assert(bm.get_identity_reputation(B_GENESIS) == 60, 'B rep moved');
    assert(bm.is_identity_eligible(B_GENESIS), 'B ineligible');
    assert(bm.get_submission(bid, sid_b).status == SubmissionStatus::Pending, 'B sub moved');
    // Helper-side slash targeted exactly A.
    assert(helper.slashed_identity() == A_GENESIS, 'slash mistargeted');
}

#[test]
#[should_panic(expected: 'IS_SLASHED')]
fn test_private_slashed_cannot_submit() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'bad', A_C63);
    stop_cheat_caller_address(bm_addr);
    report_a(bm_addr, bm, bid, sid);
    snforge_std::start_cheat_block_timestamp(bm_addr, 259201);
    start_cheat_caller_address(bm_addr, creator());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
    snforge_std::stop_cheat_block_timestamp(bm_addr);
    // Slashed identity re-submits with the next preimage → blocked.
    let c62 = chain_at(SEED_A, 62);
    start_cheat_caller_address(bm_addr, helper_caller);
    let _ = bm.submit_private(bid, 'again', c62);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'IS_SLASHED_CANNOT_STAKE')]
fn test_private_slashed_cannot_restake() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'bad', A_C63);
    stop_cheat_caller_address(bm_addr);
    report_a(bm_addr, bm, bid, sid);
    snforge_std::start_cheat_block_timestamp(bm_addr, 259201);
    start_cheat_caller_address(bm_addr, creator());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
    snforge_std::stop_cheat_block_timestamp(bm_addr);
    // Re-registration after slash is refused even with fresh escrow.
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
}

// --- Creator powerlessness over reputation ---------------------------------

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn test_creator_cannot_set_threshold() {
    let (bm_addr, bm) = deploy_bm();
    start_cheat_caller_address(bm_addr, creator());
    bm.set_minimum_reputation(100);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'REPORT_NOT_FOUND')]
fn test_resolve_without_report_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'fine', A_C63);
    stop_cheat_caller_address(bm_addr);
    // Creator tries to slash without any report → no state path exists.
    start_cheat_caller_address(bm_addr, creator());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
}

// --- Payout-lock registration (private winner path) -------------------------

#[test]
fn test_private_payout_lock_registration() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid = bm.submit_private(bid, 'winning', A_C63);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.select_winner(bid, sid);
    stop_cheat_caller_address(bm_addr);
    // Winner registers a payout lock with the next preimage (c62).
    let c62 = chain_at(SEED_A, 62);
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_private_payout_lock(bid, 0xfeed10c4, c62);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_private_payout_lock(bid) == 0xfeed10c4, 'lock not stored');
}

#[test]
#[should_panic(expected: 'NOT_WINNER')]
fn test_private_payout_lock_by_loser_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = open_bounty(bm_addr, bm, helper_addr);
    register_a(bm_addr, bm);
    let helper_caller = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_stake_identity(B_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    helper.set_escrow(B_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    start_cheat_caller_address(bm_addr, helper_caller);
    let sid_a = bm.submit_private(bid, 'winning', A_C63);
    let _ = bm.submit_private(bid, 'losing', B_C63);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.select_winner(bid, sid_a);
    stop_cheat_caller_address(bm_addr);
    // B (loser) tries to register a payout lock for A's bounty → rejected.
    let c62b = chain_at(SEED_B, 62);
    start_cheat_caller_address(bm_addr, helper_caller);
    bm.register_private_payout_lock(bid, 0xbad10c, c62b);
    stop_cheat_caller_address(bm_addr);
}
