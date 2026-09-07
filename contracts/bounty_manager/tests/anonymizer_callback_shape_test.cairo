//! Proves the REAL BountyManager accepts the exact call shapes the
//! VerityAnonymizer sends via its dispatcher (fund/claim/refund/get_bounty
//! with (u64, u128) serialization, plus the private-identity callbacks
//! register_stake_identity / submit_private / register_private_payout_lock /
//! consume_preimage_by_tip / get_stake_escrow-view). The helper package cannot
//! cross-declare the real BM in snforge, so this file closes that seam from
//! the BM side: if either side changes its signature, one of the two suites
//! fails.
//!
//! snforge cannot cross-declare workspace packages, so the helper itself is
//! NOT deployed here; instead the calls below use byte-identical argument
//! shapes (bounty_id: u64, amount: u128) from the anonymizer's address.

use core::num::traits::Zero;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{IBountyManagerDispatcher, IBountyManagerDispatcherTrait};
use bounty_manager::types::BountyStatus;

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn investigator() -> ContractAddress { starknet::contract_address_const::<0x400>() }
fn fake_anonymizer() -> ContractAddress {
    starknet::contract_address_const::<0x7777>()
}

// Minimal escrow double standing in for the helper's get_stake_escrow view,
// which submit_private consults for the live stake proof.
#[starknet::interface]
trait IShapeEscrow<T> {
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    fn slash_stake(ref self: T, identity: felt252);
    fn set_escrow(ref self: T, identity: felt252, amount: u128);
}

#[starknet::contract]
mod ShapeEscrow {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        escrow: Map<felt252, u128>,
    }

    #[abi(embed_v0)]
    impl ShapeEscrowImpl of super::IShapeEscrow<ContractState> {
        fn get_stake_escrow(self: @ContractState, identity: felt252) -> u128 {
            self.escrow.read(identity)
        }
        fn slash_stake(ref self: ContractState, identity: felt252) {
            self.escrow.write(identity, 0);
        }
        fn set_escrow(ref self: ContractState, identity: felt252, amount: u128) {
            self.escrow.write(identity, amount);
        }
    }
}

#[test]
fn test_helper_call_shapes_against_real_bounty_manager() {
    // Deploy real BM, wire a stand-in anonymizer address.
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (bm_addr, _) = cls.deploy(@calldata).unwrap();
    let bm = IBountyManagerDispatcher { contract_address: bm_addr };
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(fake_anonymizer());
    stop_cheat_caller_address(bm_addr);
    // create_bounty as creator (u128 reward, felt meta) — as the UI sends it.
    start_cheat_caller_address(bm_addr, creator());
    let bid: u64 = bm.create_bounty(10_000_000_000_000_000_000, 'meta');
    stop_cheat_caller_address(bm_addr);
    // fund_bounty as the anonymizer with EXACTLY (u64, u128) — the helper shape.
    start_cheat_caller_address(bm_addr, fake_anonymizer());
    bm.fund_bounty(bid, 10_000_000_000_000_000_000);
    stop_cheat_caller_address(bm_addr);
    let b = bm.get_bounty(bid);
    assert(b.status == BountyStatus::Funded, 'not Funded');
    assert(b.reward_amount == 10_000_000_000_000_000_000, 'reward mismatch');
    assert(b.creator == creator(), 'creator mismatch');
    // open as creator, stake+submit as investigator, select as creator.
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    let sid = bm.submit_investigation(bid, 'ev');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.select_winner(bid, sid);
    stop_cheat_caller_address(bm_addr);
    let b2 = bm.get_bounty(bid);
    assert(b2.status == BountyStatus::Claimable, 'not Claimable');
    assert(b2.winner == investigator(), 'winner mismatch');
    // claim_payout as the anonymizer with EXACTLY (u64) — the helper shape.
    start_cheat_caller_address(bm_addr, fake_anonymizer());
    bm.claim_payout(bid);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_bounty(bid).status == BountyStatus::Paid, 'not Paid');
    // refund_bounty shape on a second bounty.
    start_cheat_caller_address(bm_addr, creator());
    let bid2: u64 = bm.create_bounty(1000, 'm2');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, fake_anonymizer());
    bm.fund_bounty(bid2, 1000);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.refund_bounty(bid2);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_bounty(bid2).status == BountyStatus::Refunded, 'not Refunded');
}

#[test]
fn test_helper_identity_call_shapes_against_real_bounty_manager() {
    // Same chain vectors as private_identity_test (seed 0x1234).
    let identity: felt252 = 0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973;
    let pre1: felt252 = 0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265;
    // Real BM + escrow double as the anonymizer address.
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (bm_addr, _) = cls.deploy(@calldata).unwrap();
    let bm = IBountyManagerDispatcher { contract_address: bm_addr };
    let esc_cls = declare("ShapeEscrow").unwrap().contract_class();
    let (esc_addr, _) = esc_cls.deploy(@array![]).unwrap();
    let esc = IShapeEscrowDispatcher { contract_address: esc_addr };
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(esc_addr);
    stop_cheat_caller_address(bm_addr);
    // register_stake_identity(identity, amount) — the STAKE op shape.
    start_cheat_caller_address(bm_addr, esc_addr);
    bm.register_stake_identity(identity, 1_000_000_000_000_000_000);
    stop_cheat_caller_address(bm_addr);
    assert(bm.is_identity_registered(identity), 'not registered');
    assert(bm.get_identity_reputation(identity) == 60, 'rep != 60');
    // Escrow view shape drives eligibility.
    esc.set_escrow(identity, 1_000_000_000_000_000_000);
    assert(bm.get_identity_stake(identity) == 1_000_000_000_000_000_000, 'stake view');
    assert(bm.is_identity_eligible(identity), 'not eligible');
    // Open a bounty, then submit_private(bid, evidence, preimage) shape.
    start_cheat_caller_address(bm_addr, creator());
    let bid: u64 = bm.create_bounty(500, 'm');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, esc_addr);
    bm.fund_bounty(bid, 500);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, esc_addr);
    let sid = bm.submit_private(bid, 'ev-shape', pre1);
    stop_cheat_caller_address(bm_addr);
    assert(sid == 1, 'sub id');
    assert(bm.get_submission(bid, sid).identity == identity, 'identity link');
    // consume_preimage_by_tip(preimage) -> identity shape (UNSTAKE path).
    // Tip is now c63 after the submit above, so the next preimage is c62.
    start_cheat_caller_address(bm_addr, esc_addr);
    let resolved = bm.consume_preimage_by_tip(0x3c64e9aeac82f58159a462ecad0a11c01949c4e804431ca89347d1042b471ce);
    stop_cheat_caller_address(bm_addr);
    assert(resolved == identity, 'resolve mismatch');
}

#[test]
fn test_helper_creator_call_shapes_against_real_bounty_manager() {
    // Creator chain, seed 0xc4e4 (same generation as investigator vectors).
    let alias: felt252 = 0x645e7e3c50aaea87cda43b3c44431007acba5186a020738b317246f80e83d56;
    let pre1: felt252 = 0x63d6076df4f7002fc5ee8d5a70e4266e432a96ab397dfe6d041bf9da7f91567;
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (bm_addr, _) = cls.deploy(@calldata).unwrap();
    let bm = IBountyManagerDispatcher { contract_address: bm_addr };
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(fake_anonymizer());
    stop_cheat_caller_address(bm_addr);
    // create_bounty_private(reward, metadata, alias) — the CREATE op shape.
    start_cheat_caller_address(bm_addr, fake_anonymizer());
    let bid = bm.create_bounty_private(777, 'creator-meta', alias);
    stop_cheat_caller_address(bm_addr);
    let b = bm.get_bounty(bid);
    assert(b.creator_alias == alias, 'alias link');
    assert(b.reward_amount == 777, 'reward');
    // verify_creator_preimage + payout recipient views.
    assert(bm.verify_creator_preimage(alias, pre1), 'tip verify');
    assert(!bm.verify_creator_preimage(alias, 0xdead), 'bad verify');
    assert(bm.get_payout_recipient(bid) == b.creator, 'recipient default');
    // set_payout_address(bid, payout, preimage) shape (non-consuming).
    let payout: ContractAddress = starknet::contract_address_const::<0xabc>();
    start_cheat_caller_address(bm_addr, creator());
    bm.set_payout_address(bid, payout, pre1);
    stop_cheat_caller_address(bm_addr);
    assert(bm.get_payout_recipient(bid) == payout, 'recipient set');
    assert(bm.verify_creator_preimage(alias, pre1), 'tip moved');
}
