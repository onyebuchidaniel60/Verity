#[feature("deprecated-starknet-consts")]
use core::num::traits::Zero;
use core::traits::TryInto;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;
use bounty_manager::bounty_manager::{IBountyManagerDispatcher, IBountyManagerDispatcherTrait};
use bounty_manager::types::{BountyStatus, SubmissionStatus};

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn investigator() -> ContractAddress { starknet::contract_address_const::<0x400>() }
fn investigator2() -> ContractAddress { starknet::contract_address_const::<0x401>() }
fn pool() -> ContractAddress { starknet::contract_address_const::<0x500>() }

fn deploy_bounty_manager() -> (ContractAddress, IBountyManagerDispatcher) {
    let cls = declare("BountyManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    owner().serialize(ref calldata);
    let (addr, _) = cls.deploy(@calldata).unwrap();
    (addr, IBountyManagerDispatcher { contract_address: addr })
}

fn anon_addr_for_test(pool: ContractAddress) -> ContractAddress { pool }

#[test]
fn test_full_bounty_lifecycle_new() {
    let pool_addr = pool();
    let (bm_addr, bm) = deploy_bounty_manager();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    stop_cheat_caller_address(bm_addr);
    // Create bounty as creator
    start_cheat_caller_address(bm_addr, creator());
    let bounty_id = bm.create_bounty(1000, 'meta');
    stop_cheat_caller_address(bm_addr);
    let b = bm.get_bounty(bounty_id);
    assert(b.status == BountyStatus::Created, 'not Created');
    // Fund via anonymizer as pool
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
    // Investigator stakes
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    stop_cheat_caller_address(bm_addr);
    assert(bm.has_stake(investigator()), 'not staked');
    assert(bm.get_reputation(investigator()) >= bm.get_minimum_reputation(), 'rep low');
    // Submit investigation
    start_cheat_caller_address(bm_addr, investigator());
    let sub_id = bm.submit_investigation(bounty_id, 'evidence_hash');
    stop_cheat_caller_address(bm_addr);
    assert(sub_id == 1, 'sub_id');
    let sub = bm.get_submission(bounty_id, sub_id);
    assert(sub.status == SubmissionStatus::Pending, 'not Pending');
    // Creator selects winner
    start_cheat_caller_address(bm_addr, creator());
    bm.select_winner(bounty_id, sub_id);
    stop_cheat_caller_address(bm_addr);
    let b4 = bm.get_bounty(bounty_id);
    assert(b4.status == BountyStatus::Claimable, 'not Claimable');
    assert(b4.winner == investigator(), 'winner mismatch');
    let sub2 = bm.get_submission(bounty_id, sub_id);
    assert(sub2.status == SubmissionStatus::Accepted, 'not Accepted');
    // Winner reputation should have increased
    let rep_after = bm.get_reputation(investigator());
    assert(rep_after > 60, 'rep not increased');
    // Claim payout as winner
    start_cheat_caller_address(bm_addr, investigator());
    bm.claim_payout(bounty_id);
    stop_cheat_caller_address(bm_addr);
    let b5 = bm.get_bounty(bounty_id);
    assert(b5.status == BountyStatus::Paid, 'not Paid');
}

#[test]
#[should_panic(expected: 'CREATOR_CANNOT_SUBMIT')]
fn test_creator_cannot_submit() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    let bid = bm.create_bounty(500, 'm');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, anon_addr);
    bm.fund_bounty(bid, 500);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    // Creator stakes (allowed) but should not be able to submit to own bounty
    bm.stake();
    let _ = bm.submit_investigation(bid, 'e');
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'NOT_STAKED')]
fn test_not_staked_cannot_submit() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
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
    // Investigator2 has not staked
    start_cheat_caller_address(bm_addr, investigator2());
    let _ = bm.submit_investigation(bid, 'e');
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'ALREADY_STAKED')]
fn test_double_stake_rejected() {
    let (bm_addr, bm) = deploy_bounty_manager();
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    bm.stake();
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_report_and_slash_with_dispute() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
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
    bm.stake();
    let sid = bm.submit_investigation(bid, 'bad_evidence');
    stop_cheat_caller_address(bm_addr);
    let rep_before = bm.get_reputation(investigator());
    // Creator reports — no slash yet, status Reported, challenge window open
    start_cheat_caller_address(bm_addr, creator());
    bm.report_submission(bid, sid, 'FRAUD', 'proof');
    stop_cheat_caller_address(bm_addr);
    assert(!bm.is_slashed(investigator()), 'should not be slashed yet');
    let sub_reported = bm.get_submission(bid, sid);
    assert(sub_reported.status == SubmissionStatus::Reported, 'not Reported');
    // Investigator challenges within period
    start_cheat_caller_address(bm_addr, investigator());
    bm.challenge_report(bid, sid);
    stop_cheat_caller_address(bm_addr);
    let rep_mid = bm.get_reputation(investigator());
    assert(rep_mid == rep_before, 'rep unchanged');
    // Owner resolves after challenge — decides to slash (malicious confirmed)
    start_cheat_caller_address(bm_addr, owner());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
    assert(bm.is_slashed(investigator()), 'not slashed after resolve');
    let rep_after = bm.get_reputation(investigator());
    assert(rep_after < rep_before, 'rep not reduced');
    let sub = bm.get_submission(bid, sid);
    assert(sub.status == SubmissionStatus::Slashed, 'not Slashed');
}

#[test]
fn test_report_without_challenge_then_slash() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
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
    bm.stake();
    let sid = bm.submit_investigation(bid, 'bad');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.report_submission(bid, sid, 'FRAUD', 'proof');
    stop_cheat_caller_address(bm_addr);
    // Warp time beyond challenge period (3 days + 1)
    snforge_std::start_cheat_block_timestamp(bm_addr, 259201);
    start_cheat_caller_address(bm_addr, creator());
    bm.resolve_report(bid, sid, true);
    stop_cheat_caller_address(bm_addr);
    snforge_std::stop_cheat_block_timestamp(bm_addr);
    assert(bm.is_slashed(investigator()), 'not slashed after deadline');
}

#[test]
fn test_report_challenged_then_dismissed() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
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
    bm.stake();
    let sid = bm.submit_investigation(bid, 'maybe_bad');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.report_submission(bid, sid, 'FRAUD', 'proof');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, investigator());
    bm.challenge_report(bid, sid);
    stop_cheat_caller_address(bm_addr);
    // Owner dismisses (should_slash false) — no slash, reputation unchanged, status Rejected
    let rep_before = bm.get_reputation(investigator());
    start_cheat_caller_address(bm_addr, owner());
    bm.resolve_report(bid, sid, false);
    stop_cheat_caller_address(bm_addr);
    assert(!bm.is_slashed(investigator()), 'should not be slashed');
    assert(bm.get_reputation(investigator()) == rep_before, 'rep should not change');
    let sub = bm.get_submission(bid, sid);
    assert(sub.status == SubmissionStatus::Rejected, 'not Rejected');
}

#[test]
fn test_stake_withdraw() {
    let (bm_addr, bm) = deploy_bounty_manager();
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    assert(bm.has_stake(investigator()), 'not staked');
    bm.withdraw_stake();
    assert(!bm.has_stake(investigator()), 'still staked');
    stop_cheat_caller_address(bm_addr);
}

#[test]
fn test_refund_with_fee() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    let bid = bm.create_bounty(1000, 'm');
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, anon_addr);
    bm.fund_bounty(bid, 1000);
    stop_cheat_caller_address(bm_addr);
    start_cheat_caller_address(bm_addr, creator());
    bm.open_bounty(bid);
    // No winner, creator refunds
    bm.refund_bounty(bid);
    stop_cheat_caller_address(bm_addr);
    let b = bm.get_bounty(bid);
    assert(b.status == BountyStatus::Refunded, 'not Refunded');
}

#[test]
#[should_panic(expected: 'NOT_CREATOR')]
fn test_select_winner_only_creator() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
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
    bm.stake();
    let sid = bm.submit_investigation(bid, 'e');
    stop_cheat_caller_address(bm_addr);
    // Investigator tries to select winner (should fail)
    start_cheat_caller_address(bm_addr, investigator());
    bm.select_winner(bid, sid);
    stop_cheat_caller_address(bm_addr);
}

#[test]
#[should_panic(expected: 'REPUTATION_TOO_LOW')]
fn test_reputation_threshold_enforced() {
    let (bm_addr, bm) = deploy_bounty_manager();
    let pool_addr = pool();
    let anon_addr = anon_addr_for_test(pool_addr);
    start_cheat_caller_address(bm_addr, owner());
    bm.set_anonymizer(anon_addr);
    bm.set_minimum_reputation(90);
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
    // Investigator stakes with 60 rep, below 90 threshold
    start_cheat_caller_address(bm_addr, investigator());
    bm.stake();
    let _ = bm.submit_investigation(bid, 'e');
    stop_cheat_caller_address(bm_addr);
}
