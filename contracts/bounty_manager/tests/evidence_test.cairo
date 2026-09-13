//! Option A evidence transport (public text, private author — §47.12).
//!
//! `publish_evidence`: direct call (challenge pattern), deliberately NOT
//! pool-routed — content is public by design. Consuming-preimage auth for
//! private submissions (a NON-consuming reveal would leave the preimage
//! valid for impersonation, so that shape is rejected by construction);
//! caller == investigator for legacy submissions. First-write-wins,
//! 64-chunk cap, empty rejected.

#[feature("deprecated-starknet-consts")]
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{
    IBountyManagerDispatcher, IBountyManagerDispatcherTrait,
};

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn investigator() -> ContractAddress { starknet::contract_address_const::<0x300>() }
fn stranger() -> ContractAddress { starknet::contract_address_const::<0x999>() }

const STAKE_AMOUNT: u128 = 1000000000000000000;

// Seed 0x1234 chain constants (shared with the JS vectors).
const A_C63: felt252 = 0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265;
const A_C62: felt252 = 0x3c64e9aeac82f58159a462ecad0a11c01949c4e804431ca89347d1042b471ce;
const A_GENESIS: felt252 = 0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973;
// Arbitrary nonzero felt that is NOT on the A chain (negative-path probe).
const OFF_CHAIN: felt252 = 0xbeef;

#[starknet::interface]
trait IMockHelperEv<T> {
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    fn set_escrow(ref self: T, identity: felt252, amount: u128);
}

#[starknet::contract]
mod MockHelperEv {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        escrow: Map<felt252, u128>,
    }

    #[abi(embed_v0)]
    impl MockHelperEvImpl of super::IMockHelperEv<ContractState> {
        fn get_stake_escrow(self: @ContractState, identity: felt252) -> u128 {
            self.escrow.read(identity)
        }
        fn set_escrow(ref self: ContractState, identity: felt252, amount: u128) {
            self.escrow.write(identity, amount);
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

fn deploy_helper() -> ContractAddress {
    let cls = declare("MockHelperEv").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![]).unwrap();
    addr
}

fn wire(bm_addr: ContractAddress, bm: IBountyManagerDispatcher, helper: ContractAddress) {
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(helper);
    stop_cheat_caller_address(bm_addr);
}

// Open bounty via legacy path (create / fund-as-helper / open as creator).
fn open_bounty(bm_addr: ContractAddress, bm: IBountyManagerDispatcher) -> u64 {
    let helper = bm.get_anonymizer();
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

// Register identity A (pool-routed in production) + back its mock escrow +
// open a bounty + submit privately (consumes A_C63, tip c64 -> c63).
fn setup_private_submit(bm_addr: ContractAddress, bm: IBountyManagerDispatcher) -> u64 {
    let helper = bm.get_anonymizer();
    start_cheat_caller_address(bm_addr, helper);
    bm.register_stake_identity(A_GENESIS, STAKE_AMOUNT);
    stop_cheat_caller_address(bm_addr);
    let mock = IMockHelperEvDispatcher { contract_address: helper };
    mock.set_escrow(A_GENESIS, STAKE_AMOUNT);
    let bid = open_bounty(bm_addr, bm);
    start_cheat_caller_address(bm_addr, helper);
    let sid = bm.submit_private(bid, 'evhash', A_C63);
    stop_cheat_caller_address(bm_addr);
    assert(sid == 1, 'sid');
    bid
}

// --- Private path: publish consumes the NEXT preimage, sender-free --------

#[test]
fn test_publish_private_roundtrip_from_stranger_sender() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = setup_private_submit(bm_addr, bm);
    // Publish from a STRANGER sender: preimage is the auth, sender is not.
    // A_C62 is the next unrevealed preimage (tip is A_C63 after submit).
    let chunks = array!['evi', 'den', 'ce!'];
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, 1, chunks.span(), A_C62);
    stop_cheat_caller_address(bm_addr);
    // Round-trip: exact chunks back, len recorded, tip retired to A_C62.
    let back = bm.get_submission_evidence(bid, 1);
    assert(back.len() == 3, 'len');
    assert(*back.at(0) == 'evi', 'c0');
    assert(*back.at(1) == 'den', 'c1');
    assert(*back.at(2) == 'ce!', 'c2');
    let sub = bm.get_submission(bid, 1);
    assert(sub.evidence_len == 3, 'evidence_len');
    assert(bm.get_identity_tip(A_GENESIS) == A_C62, 'tip not retired');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_publish_private_wrong_preimage_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = setup_private_submit(bm_addr, bm);
    // OFF_CHAIN is nonzero but resolves nowhere near the live tip.
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, 1, array!['x'].span(), OFF_CHAIN);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'EVIDENCE_ALREADY_SET')]
fn test_publish_private_twice_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = setup_private_submit(bm_addr, bm);
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, 1, array!['one'].span(), A_C62);
    // Already-set is checked before auth: any second publish reverts even
    // with otherwise-valid input.
    bm.publish_evidence(bid, 1, array!['two'].span(), OFF_CHAIN);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'EVIDENCE_TOO_LONG')]
fn test_publish_oversize_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = setup_private_submit(bm_addr, bm);
    let mut big: Array<felt252> = array![];
    let mut i: u32 = 0;
    while i < 65 {
        big.append('x');
        i += 1;
    };
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, 1, big.span(), A_C62);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'EVIDENCE_EMPTY')]
fn test_publish_empty_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = setup_private_submit(bm_addr, bm);
    let empty: Array<felt252> = array![];
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, 1, empty.span(), A_C62);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'SUBMISSION_NOT_FOUND')]
fn test_publish_missing_submission_reverts() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(999, 1, array!['x'].span(), A_C62);
    stop_cheat_caller_address(bm_addr);
}

// --- Legacy path: caller == investigator, preimage unused ------------------

#[test]
fn test_publish_legacy_roundtrip() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = open_bounty(bm_addr, bm);
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    let sid = bm.submit_investigation(bid, 'evhash');
    // Preimage unused on the legacy path (pass 0).
    bm.publish_evidence(bid, sid, array!['pub', 'lic'].span(), 0);
    stop_cheat_caller_address(bm_addr);
    let back = bm.get_submission_evidence(bid, sid);
    assert(back.len() == 2, 'len');
    assert(*back.at(0) == 'pub', 'c0');
    assert(*back.at(1) == 'lic', 'c1');
    let sub = bm.get_submission(bid, sid);
    assert(sub.evidence_len == 2, 'evidence_len');
}

#[test]
#[should_panic(expected: 'NOT_INVESTIGATOR')]
fn test_publish_legacy_stranger_blocked() {
    let (bm_addr, bm) = deploy_bm();
    let helper = deploy_helper();
    wire(bm_addr, bm, helper);
    let bid = open_bounty(bm_addr, bm);
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    let sid = bm.submit_investigation(bid, 'evhash2');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, stranger());
    bm.publish_evidence(bid, sid, array!['junk'].span(), 0);
    stop_cheat_caller_address(bm_addr);
}
