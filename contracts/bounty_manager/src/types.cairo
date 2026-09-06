//! Bounty domain types — Phase 4+ (VERITY_SPEC §7, §8, §11).
//! Full lifecycle after Phase 3 funding.

use starknet::ContractAddress;

/// Canonical bounty lifecycle status.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum BountyStatus {
    #[default]
    Created,
    Funded,
    Open,
    Voting,
    WinnerSelected,
    Claimable,
    Paid,
    Refunded,
}

/// On-chain bounty record — minimal required fields per SPEC §8 plus lifecycle.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct Bounty {
    pub id: u64,
    pub creator: ContractAddress,
    pub reward_amount: u128,
    pub status: BountyStatus,
    pub metadata_hash: felt252,
    pub created_at: u64,
    pub funded_amount: u128,
    pub winner: ContractAddress,
    pub winning_submission: u64,
}

/// Submission record for evidence (SPEC §13).
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct Submission {
    pub id: u64,
    pub bounty_id: u64,
    pub investigator: ContractAddress,
    pub evidence_hash: felt252,
    pub timestamp: u64,
}
