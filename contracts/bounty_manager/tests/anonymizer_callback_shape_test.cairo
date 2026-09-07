//! Proves the REAL BountyManager accepts the exact call shapes the
//! VerityAnonymizer sends via its dispatcher (fund/claim/refund/get_bounty
//! with (u64, u128) serialization). The helper package cannot cross-declare
//! the real BM in snforge, so this file closes that seam from the BM side:
//! if either side changes its signature, one of the two suites fails.
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
