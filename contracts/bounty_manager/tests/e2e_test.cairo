#[feature("deprecated-starknet-consts")]
use core::array::SpanTrait;
use core::num::traits::Zero;
use core::traits::TryInto;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{IBountyManagerDispatcher, IBountyManagerDispatcherTrait};
use bounty_manager::types::BountyStatus;

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn verifier(n: felt252) -> ContractAddress {
    // Generate deterministic verifier addresses 1..13
    let base: felt252 = 0x300;
    let addr_felt = base + n;
    let addr: ContractAddress = addr_felt.try_into().unwrap();
    addr
}
fn investigator() -> ContractAddress { starknet::contract_address_const::<0x400>() }
fn pool() -> ContractAddress { starknet::contract_address_const::<0x500>() }

fn deploy_bounty_manager() -> (ContractAddress, IBountyManagerDispatcher) {
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    (addr, IBountyManagerDispatcher { contract_address: addr })
}

// For this BountyManager-only e2e, we use the pool address itself as the anonymizer
// (no need to deploy VerityAnonymizer — we just cheat caller to be pool)
fn anon_addr_for_test(pool: ContractAddress) -> ContractAddress { pool }

#[test]
fn test_full_bounty_lifecycle() {
    let pool_addr = pool();
    let (bm_addr, bm) = deploy_bounty_manager();
    let anon_addr = anon_addr_for_test(pool_addr);
    // Set anonymizer in BountyManager as owner
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    stop_cheat_caller_address(bm_addr);
    // Set 13 verifiers
    let mut verifiers: Array<ContractAddress> = array![];
    let mut i: u32 = 1;
    while i <= 13 {
        verifiers.append(verifier(i.into()));
        i += 1;
    };
    start_cheat_caller_address(bm_addr, owner());
    bm.set_verifiers(verifiers.span());
    stop_cheat_caller_address(bm_addr);
    // Create bounty as creator
    start_cheat_caller_address(bm_addr, creator());
    let bounty_id = bm.create_bounty(1000, 'meta');
    stop_cheat_caller_address(bm_addr);
    let b = bm.get_bounty(bounty_id);
    assert(b.status == BountyStatus::Created, 'not Created');
    // Fund via anonymizer as pool (private funding) — directly call fund_bounty as anonymizer
    start_cheat_caller_address(bm_addr, anon_addr);
    bm.fund_bounty(bounty_id, 1000);
    stop_cheat_caller_address(bm_addr);
    let b2 = bm.get_bounty(bounty_id);
    assert(b2.status == BountyStatus::Funded, 'not Funded');
    // Open
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bounty_id);
    stop_cheat_caller_address(bm_addr);
    let b3 = bm.get_bounty(bounty_id);
    assert(b3.status == BountyStatus::Open, 'not Open');
    // Submit evidence as investigator
    start_cheat_caller_address(bm_addr, investigator());
    let sub_id = bm.submit_evidence(bounty_id, 'evidence_hash');
    stop_cheat_caller_address(bm_addr);
    assert(sub_id == 1, 'sub_id');
    let b4 = bm.get_bounty(bounty_id);
    assert(b4.status == BountyStatus::Voting, 'not Voting');
    // Vote 7 times
    let mut v: u32 = 1;
    while v <= 7 {
        let ver = verifier(v.into());
        start_cheat_caller_address(bm_addr, ver);
        bm.vote(bounty_id, sub_id);
        stop_cheat_caller_address(bm_addr);
        v += 1;
    };
    let b5 = bm.get_bounty(bounty_id);
    assert(b5.status == BountyStatus::Claimable, 'not Claimable');
    assert(b5.winner == investigator(), 'winner mismatch');
    // Claim payout — directly as winner (for test) or via anonymizer
    // For this e2e, we test the BountyManager's claim_payout directly as winner
    start_cheat_caller_address(bm_addr, investigator());
    bm.claim_payout(bounty_id);
    stop_cheat_caller_address(bm_addr);
    let b6 = bm.get_bounty(bounty_id);
    assert(b6.status == BountyStatus::Paid, 'not Paid');
}

#[test]
#[should_panic(expected: 'ALREADY_VOTED')]
fn test_double_vote_rejected() {
    let pool_addr = pool();
    let (bm_addr, bm) = deploy_bounty_manager();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    let mut vers: Array<ContractAddress> = array![];
    let mut i: u32 = 1;
    while i <= 13 { vers.append(verifier(i.into())); i += 1; };
    bm.set_verifiers(vers.span());
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    let bid = bm.create_bounty(500, 'm');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, anon_addr);
    bm.fund_bounty(bid, 500);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, investigator());
    let sid = bm.submit_evidence(bid, 'e');
    stop_cheat_caller_address(bm_addr);
    let v1 = verifier(1.into());
    start_cheat_caller_address(bm_addr, v1);
    bm.vote(bid, sid);
    bm.vote(bid, sid);
    stop_cheat_caller_address(bm_addr);
}
