//! Verity Bounty domain types — Investigator staking & anonymous reputation architecture.
//! Replaces verifier committee (13/7) with creator-controlled winner selection,
//! fixed investigator stake, report/slash, and reputation threshold.

use starknet::ContractAddress;

/// Canonical bounty lifecycle — creator-controlled.
//! CREATED -> FUNDED -> OPEN -> WINNER_SELECTED -> CLAIMABLE -> PAID
//! Alternative: CREATED/FUNDED/OPEN -> REFUNDED (no winner, protocol fee)
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum BountyStatus {
    #[default]
    Created,
    Funded,
    Open,
    WinnerSelected,
    Claimable,
    Paid,
    Refunded,
}

/// Submission lifecycle for investigator investigations.
//! PENDING -> ACCEPTED (if winner/good) or REJECTED or REPORTED -> SLASHED
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum SubmissionStatus {
    #[default]
    Pending,
    Accepted,
    Rejected,
    Reported,
    Slashed,
}

/// On-chain bounty record — minimal required fields per spec §8 plus new lifecycle.
/// `creator_alias` is the private creator identity (genesis tip of a Poseidon
/// hash chain, same scheme as investigator identities —
/// docs/PRIVATE_INVESTIGATOR.md). `0` = legacy wallet-created bounty where
/// `creator` is the creator's public address AND control key. For alias
/// bounties `creator` holds the alias cast as an address (pseudonym, no wallet
/// data) and `payout_address` holds the creator-chosen refund recipient
/// (a real address — money must land somewhere; creators should use a fresh
/// address. Unset (zero) until the creator sets it pre-funding).
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
    pub creator_alias: felt252,
    pub payout_address: ContractAddress,
}

/// Investigation submission — investigator pseudonymous, requires stake + reputation.
/// `identity` is the private investigator identity (genesis tip of a Poseidon
/// hash chain, see `docs/PRIVATE_INVESTIGATOR.md`). `0` = legacy wallet-keyed
/// submission where `investigator` is the caller's public address. For private
/// submissions `investigator` holds the identity cast as an address and NO
/// wallet address is recorded anywhere.
/// `evidence_len` counts published 31-byte text chunks (Option A, public
/// evidence / private identity): `0` = hash-only (legacy or unpublished).
/// Full text lives in `submission_evidence` and is read via
/// `get_submission_evidence`.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct Submission {
    pub id: u64,
    pub bounty_id: u64,
    pub investigator: ContractAddress,
    pub evidence_hash: felt252,
    pub timestamp: u64,
    pub status: SubmissionStatus,
    pub identity: felt252,
    pub evidence_len: u64,
}

/// Report for malicious/fraudulent investigation — creator-originated, safeguards against abuse.
/// Two-step: Reported → (Investigator may challenge within CHALLENGE_PERIOD) → Resolved/Slashed.
/// This prevents a malicious creator from instantly stealing stake; a dispute window and owner arbitration are required.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct Report {
    pub bounty_id: u64,
    pub submission_id: u64,
    pub reporter: ContractAddress,
    pub reason: felt252,
    pub evidence: felt252,
    pub timestamp: u64,
    pub challenged: bool,
    pub challenge_deadline: u64,
    pub resolved: bool,
    pub slashed: bool,
}

/// Investigator anonymous profile — public pseudonym, not wallet address.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct InvestigatorProfile {
    pub address: ContractAddress,
    pub reputation: u64,
    pub has_stake: bool,
    pub stake_amount: u128,
    pub is_slashed: bool,
    pub eligible: bool,
}
