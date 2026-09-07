//! Private creator identity tests (docs/PRIVATE_INVESTIGATOR.md, creator alias).
//!
//! Creator control mirrors the investigator hash-chain scheme in a separate
//! namespace (no reputation/slash for creators — only control auth).
//! Alias bounties record NO creator wallet: `creator` holds the alias cast
//! as an address; value movement binds an explicit creator-chosen
//! `payout_address`. Legacy wallet entries are frozen and stay green.
//!
//! Creator chain vectors (seed 0xc4e4) generated with installed
//! `starknet@10.5.0`, same method as the investigator vectors.
//! Investigator vectors (seed 0x1234) reused for submissions.

#[feature("deprecated-starknet-consts")]
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{
    IBountyManagerDispatcher, IBountyManagerDispatcherTrait, identity_to_address,
};
use bounty_manager::types::BountyStatus;

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn stranger() -> ContractAddress { starknet::contract_address_const::<0x999>() }
fn payout_addr() -> ContractAddress { starknet::contract_address_const::<0xabc>() }

const STAKE_AMOUNT: u128 = 1000000000000000000;

// Creator chain, seed 0xc4e4.
const C_C62: felt252 = 0x5f3baf155659f34752430a0bcc190dd62e204e5374062a236ab4c1de1bb8a71;
const C_C63: felt252 = 0x63d6076df4f7002fc5ee8d5a70e4266e432a96ab397dfe6d041bf9da7f91567;
const C_ALIAS: felt252 = 0x645e7e3c50aaea87cda43b3c44431007acba5186a020738b317246f80e83d56;
// Investigator A, seed 0x1234.
const A_C62: felt252 = 0x3c64e9aeac82f58159a462ecad0a11c01949c4e804431ca89347d1042b471ce;
const A_C63: felt252 = 0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265;
const A_GENESIS: felt252 = 0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973;

fn poseidon1(x: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array![x].span())
}

// c_k: Poseidon iterated k times from seed.
fn chain_at(seed: felt252, k: u64) -> felt252 {
    let mut v = seed;
    let mut i = 0;
    while i < k {
        v = poseidon1(v);
        i += 1;
    };
    v
}

const SEED_C: felt252 = 0xc4e4;

#[test]
fn test_creator_chain_parity() {
    assert(chain_at(SEED_C, 62) == C_C62, 'c62 vector');
    assert(chain_at(SEED_C, 63) == C_C63, 'c63 vector');
    assert(poseidon1(C_C62) == C_C63, 'c62 order');
    assert(poseidon1(C_C63) == C_ALIAS, 'genesis order');
}

// Minimal helper double: live escrow views + slash record (same role as
// MockStakeHelper in private_identity_test, local to avoid cross-file coupling).
#[starknet::interface]
trait ICreatorHelper<T> {
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    fn slash_stake(ref self: T, identity: felt252);
    fn set_escrow(ref self: T, identity: felt252, amount: u128);
    fn slashed_identity(self: @T) -> felt252;
}

#[starknet::contract]
mod CreatorHelper {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        escrow: Map<felt252, u128>,
        slashed: felt252,
    }

    #[abi(embed_v0)]
    impl CreatorHelperImpl of super::ICreatorHelper<ContractState> {
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

fn deploy_helper() -> (ContractAddress, ICreatorHelperDispatcher) {
    let cls = declare("CreatorHelper").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![]).unwrap();
    (addr, ICreatorHelperDispatcher { contract_address: addr })
}

fn wire(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, helper: ContractAddress) {
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(helper);
    stop_cheat_caller_address(bm_addr);
}

fn create_alias(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, reward: u128) -> u64 {
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    let bid = bm.create_bounty_private(reward, 'alias-meta', C_ALIAS);
    stop_cheat_caller_address(bm_addr);
    bid
}

fn fund_as_helper(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, bid: u64, amount: u128) {
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    bm.fund_bounty(bid, amount);
    stop_cheat_caller_address(bm_addr);
}

// --- Creation --------------------------------------------------------------

#[test]
fn test_create_private_registers_alias_without_wallet() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    let b = bm.get_bounty(bid);
    assert(b.status == BountyStatus::Created, 'not Created');
    assert(b.reward_amount == 1000, 'reward');
    assert(b.creator_alias == C_ALIAS, 'alias link');
    // No wallet recorded: creator is the alias pseudonym.
    assert(b.creator == identity_to_address(C_ALIAS), 'pseudo mismatch');
    let creator_felt: felt252 = owner().into();
    let stranger_felt: felt252 = stranger().into();
    assert(C_ALIAS != creator_felt, 'wallet leaked');
    assert(C_ALIAS != stranger_felt, 'wallet leaked');
    // Payout address starts unset (bound pre-funding by the creator).
    let zero: ContractAddress = starknet::contract_address_const::<0x0>();
    assert(b.payout_address == zero, 'payout preset');
    // Recipient defaults to the pseudonym until bound.
    assert(bm.get_payout_recipient(bid) == identity_to_address(C_ALIAS), 'recipient default');
    assert(bm.verify_creator_preimage(C_ALIAS, C_C63), 'tip verify');
}

#[test]
#[should_panic(expected: 'NOT_ANONYMIZER')]
fn test_create_private_direct_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    // A wallet creating "privately" by direct call would link itself.
    start_cheat_caller_address(bm_addr, stranger());
    let _ = bm.create_bounty_private(1000, 'm', C_ALIAS);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'ALIAS_ZERO')]
fn test_create_private_zero_alias_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    let _ = bm.create_bounty_private(1000, 'm', 0);
    stop_cheat_caller_address(bm_addr);
}

// --- Legacy/wallet paths on alias bounties ---------------------------------

#[test]
#[should_panic(expected: 'USE_PRIVATE_SUBMIT')]
fn test_legacy_submit_blocked_on_alias_bounty() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    // Owner backstop opens (creator alias cannot sign a direct call).
    start_cheat_caller_address(bm_addr, owner());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    // A wallet submission would bypass creator-exclusion (the creator's own
    // wallet is indistinguishable), so the wallet path is closed entirely.
    start_cheat_caller_address(bm_addr, stranger());
    bm.stake();
    let _ = bm.submit_investigation(bid, 'e');
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'NOT_CREATOR')]
fn test_legacy_report_blocked_on_alias_bounty() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    start_cheat_caller_address(bm_addr, owner());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    // Only the unreachable alias-cast would pass the caller check.
    start_cheat_caller_address(bm_addr, stranger());
    bm.report_submission(bid, 1, 'r', 'e');
    stop_cheat_caller_address(bm_addr);
}

// --- Payout address binding --------------------------------------------------

#[test]
fn test_set_payout_address_flow() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    // Anyone may relay: preimage knowledge is the auth (non-consuming here).
    start_cheat_caller_address(bm_addr, stranger());
    bm.set_payout_address(bid, payout_addr(), C_C63);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_payout_recipient(bid) == payout_addr(), 'recipient');
    // Setup auth does not burn the chain: tip still the alias.
    assert(bm.verify_creator_preimage(C_ALIAS, C_C63), 'tip moved');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_set_payout_address_wrong_preimage() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    start_cheat_caller_address(bm_addr, stranger());
    bm.set_payout_address(bid, payout_addr(), A_C63);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'NOT_ALIAS_BOUNTY')]
fn test_set_payout_address_legacy_bounty_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    start_cheat_caller_address(bm_addr, stranger());
    bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, stranger());
    bm.set_payout_address(1, payout_addr(), C_C63);
    stop_cheat_caller_address(bm_addr);
}

// --- Full private lifecycle --------------------------------------------------

fn setup_open_alias(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, bid: u64) {
    // Bind payout + fund, then open with the first creator preimage.
    start_cheat_caller_address(bm_addr, stranger());
    bm.set_payout_address(bid, payout_addr(), C_C63);
    stop_cheat_caller_address(bm_addr);
    fund_as_helper(bm_addr, bm, bid, 1000);
    start_cheat_caller_address(bm_addr, stranger());
    bm.open_bounty_private(bid, C_C63);
    stop_cheat_caller_address(bm_addr);
}

fn stake_and_submit_a(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, helper: ICreatorHelperDispatcher, helper_addr: ContractAddress, bid: u64) -> u64 {
    let anon = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, anon);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(helper_addr, owner());
    helper.set_escrow(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(helper_addr);
    start_cheat_caller_address(bm_addr, anon);
    let sid = bm.submit_private(bid, 'ev-a', A_C63);
    stop_cheat_caller_address(bm_addr);
    sid
}

#[test]
fn test_full_private_lifecycle() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    setup_open_alias(bm_addr, bm, bid);
    let b0 = bm.get_bounty(bid);
    assert(b0.status == BountyStatus::Open, 'not Open');
    let sid = stake_and_submit_a(bm_addr, bm, helper, helper_addr, bid);
    // Select with the next creator preimage (c62).
    start_cheat_caller_address(bm_addr, stranger());
    bm.select_winner_private(bid, sid, C_C62);
    stop_cheat_caller_address(bm_addr);
    let b1 = bm.get_bounty(bid);
    assert(b1.status == BountyStatus::Claimable, 'not Claimable');
    assert(b1.winner == identity_to_address(A_GENESIS), 'winner link');
    assert(bm.get_identity_reputation(A_GENESIS) == 70, 'rep != 70');
    // Winner payout-lock registration via helper-shaped call.
    let anon = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, anon);
    bm.register_private_payout_lock(bid, 0x10c4, A_C62);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_private_payout_lock(bid) == 0x10c4, 'lock');
    // Claim settles via the helper path (caller == anonymizer).
    start_cheat_caller_address(bm_addr, anon);
    bm.claim_payout(bid);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_bounty(bid).status == BountyStatus::Paid, 'not Paid');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_open_private_wrong_preimage() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    start_cheat_caller_address(bm_addr, stranger());
    bm.open_bounty_private(bid, A_C63);
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_owner_backstop_opens_alias_bounty() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    // Owner backstop retained (documented): protocol can unstick bounties.
    start_cheat_caller_address(bm_addr, owner());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_bounty(bid).status == BountyStatus::Open, 'not Open');
}

#[test]
fn test_refund_alias_via_helper_or_owner() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    // Pool-routed helper path (refund-secret bearer auth in production):
    // helper caller accepted on alias bounties (was NOT_CREATOR before).
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    bm.refund_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_bounty(bid).status == BountyStatus::Refunded, 'not Refunded');
}

#[test]
#[should_panic(expected: 'NOT_AUTHORIZED')]
fn test_refund_alias_direct_stranger_rejected() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, _) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    fund_as_helper(bm_addr, bm, bid, 1000);
    start_cheat_caller_address(bm_addr, stranger());
    bm.refund_bounty(bid);
    stop_cheat_caller_address(bm_addr);
}

// --- Private dispute ---------------------------------------------------------

#[test]
fn test_report_challenge_resolve_private() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    setup_open_alias(bm_addr, bm, bid);
    let sid = stake_and_submit_a(bm_addr, bm, helper, helper_addr, bid);
    // Report consumes the next creator preimage (c62; set_payout/open used c63... note
    // setup_open_alias consumed c63 at open, so report uses c62).
    start_cheat_caller_address(bm_addr, stranger());
    bm.report_private(bid, sid, 'FRAUD', 'proof', C_C62);
    stop_cheat_caller_address(bm_addr);
    let rep = bm.get_report(bid, sid);
    assert(rep.reporter == identity_to_address(C_ALIAS), 'reporter link');
    // Investigator challenges from an unrelated account (preimage auth only).
    start_cheat_caller_address(bm_addr, stranger());
    bm.challenge_private_report(bid, sid, A_C62);
    stop_cheat_caller_address(bm_addr);
    // Owner arbitrates the challenged report (mirrors legacy path).
    start_cheat_caller_address(bm_addr, owner());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
    assert(bm.is_identity_slashed(A_GENESIS), 'not slashed');
    assert(helper.slashed_identity() == A_GENESIS, 'helper slash');
}

#[test]
fn test_resolve_private_after_deadline() {
    let (bm_addr, bm) = deploy_bm();
    let (helper_addr, helper) = deploy_helper();
    wire(bm_addr, bm, helper_addr);
    let bid = create_alias(bm_addr, bm, 1000);
    setup_open_alias(bm_addr, bm, bid);
    let sid = stake_and_submit_a(bm_addr, bm, helper, helper_addr, bid);
    start_cheat_caller_address(bm_addr, stranger());
    bm.report_private(bid, sid, 'FRAUD', 'proof', C_C62);
    stop_cheat_caller_address(bm_addr);
    snforge_std::start_cheat_block_timestamp(bm_addr, 259201);
    // Creator resolves the unchallenged report after the window. Report used
    // c62, so the next creator preimage is c61 (derived in-test).
    let c61 = chain_at(SEED_C, 61);
    assert(poseidon1(c61) == C_C62, 'c61 order');
    start_cheat_caller_address(bm_addr, stranger());
    bm.resolve_report_private(bid, sid, false, c61);
    stop_cheat_caller_address(bm_addr);
    snforge_std::stop_cheat_block_timestamp(bm_addr);
    assert(!bm.is_identity_slashed(A_GENESIS), 'slashed on dismiss');
}
