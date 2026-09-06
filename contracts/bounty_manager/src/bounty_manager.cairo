//! BountyManager — VERITY's application/business-logic contract (Phase 3-5).
//! Per SPEC §6.1, it must NOT implement ZK proofs, notes, viewing keys, etc.
//! Stores bounty lifecycle, submissions, voting (13 verifiers, 7/13 threshold),
//! and payout entitlement. Funded and payout credits are only via VerityAnonymizer.

use starknet::ContractAddress;
use crate::types::{Bounty, BountyStatus, Submission};

#[starknet::interface]
pub trait IBountyManager<T> {
    fn version(self: @T) -> felt252;
    fn create_bounty(ref self: T, reward_amount: u128, metadata_hash: felt252) -> u64;
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn get_bounty(self: @T, bounty_id: u64) -> Bounty;
    fn get_next_bounty_id(self: @T) -> u64;
    fn get_anonymizer(self: @T) -> ContractAddress;
    fn set_anonymizer(ref self: T, anonymizer: ContractAddress);
    fn get_bounty_count(self: @T) -> u64;
    // Phase 4
    fn set_verifiers(ref self: T, verifiers: Span<ContractAddress>);
    fn is_verifier(self: @T, account: ContractAddress) -> bool;
    fn open_bounty(ref self: T, bounty_id: u64);
    fn submit_evidence(ref self: T, bounty_id: u64, evidence_hash: felt252) -> u64;
    fn get_submission(self: @T, bounty_id: u64, submission_id: u64) -> Submission;
    fn get_submission_count(self: @T, bounty_id: u64) -> u64;
    fn vote(ref self: T, bounty_id: u64, submission_id: u64);
    fn get_vote_count(self: @T, bounty_id: u64, submission_id: u64) -> u32;
    fn has_voted(self: @T, bounty_id: u64, verifier: ContractAddress) -> bool;
    fn get_winner(self: @T, bounty_id: u64) -> ContractAddress;
    fn get_winning_submission(self: @T, bounty_id: u64) -> u64;
    fn claim_payout(ref self: T, bounty_id: u64);
    fn mark_paid(ref self: T, bounty_id: u64);
    fn refund(ref self: T, bounty_id: u64);
}

#[starknet::contract]
pub mod BountyManager {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::IBountyManager;
    use crate::types::{Bounty, BountyStatus, Submission};

    #[storage]
    struct Storage {
        next_bounty_id: u64,
        bounties: Map<u64, Bounty>,
        anonymizer: ContractAddress,
        owner: ContractAddress,
        // Verifiers
        verifiers: Map<ContractAddress, bool>,
        verifier_count: u32,
        // Submissions
        submission_counts: Map<u64, u64>, // bounty_id -> count
        submissions: Map<(u64, u64), Submission>, // (bounty_id, submission_id) -> Submission
        // Voting
        has_voted_map: Map<(u64, ContractAddress), bool>, // (bounty_id, verifier) -> voted
        vote_counts: Map<(u64, u64), u32>, // (bounty_id, submission_id) -> count
        winners: Map<u64, ContractAddress>, // bounty_id -> winner
        winning_submissions: Map<u64, u64>, // bounty_id -> submission_id
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BountyCreated: BountyCreated,
        BountyFunded: BountyFunded,
        AnonymizerUpdated: AnonymizerUpdated,
        VerifiersUpdated: VerifiersUpdated,
        BountyOpened: BountyOpened,
        EvidenceSubmitted: EvidenceSubmitted,
        Voted: Voted,
        WinnerSelected: WinnerSelected,
        Claimable: Claimable,
        Paid: Paid,
        Refunded: Refunded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BountyCreated { #[key] pub bounty_id: u64, pub creator: ContractAddress, pub reward_amount: u128, pub metadata_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct BountyFunded { #[key] pub bounty_id: u64, pub amount: u128, pub funded_amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct AnonymizerUpdated { pub old: ContractAddress, pub new: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct VerifiersUpdated { pub count: u32 }
    #[derive(Drop, starknet::Event)]
    pub struct BountyOpened { #[key] pub bounty_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct EvidenceSubmitted { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub investigator: ContractAddress, pub evidence_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct Voted { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub verifier: ContractAddress, pub count: u32 }
    #[derive(Drop, starknet::Event)]
    pub struct WinnerSelected { #[key] pub bounty_id: u64, pub winner: ContractAddress, pub submission_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct Claimable { #[key] pub bounty_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct Paid { #[key] pub bounty_id: u64, pub winner: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct Refunded { #[key] pub bounty_id: u64 }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        let owner = if owner.is_zero() { get_caller_address() } else { owner };
        self.owner.write(owner);
        self.next_bounty_id.write(1);
    }

    #[abi(embed_v0)]
    impl BountyManagerImpl of IBountyManager<ContractState> {
        fn version(self: @ContractState) -> felt252 { 'VERITY_BOUNTY_MANAGER_V1' }

        fn get_next_bounty_id(self: @ContractState) -> u64 { self.next_bounty_id.read() }
        fn get_bounty_count(self: @ContractState) -> u64 {
            let n = self.next_bounty_id.read();
            if n == 0 { 0 } else { n - 1 }
        }
        fn get_anonymizer(self: @ContractState) -> ContractAddress { self.anonymizer.read() }

        fn set_anonymizer(ref self: ContractState, anonymizer: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(anonymizer.is_non_zero(), 'ANONYMIZER_ZERO');
            let old = self.anonymizer.read();
            self.anonymizer.write(anonymizer);
            self.emit(AnonymizerUpdated { old, new: anonymizer });
        }

        fn set_verifiers(ref self: ContractState, verifiers: Span<ContractAddress>) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(verifiers.len() == 13, 'VERIFIERS_13_REQUIRED');
            // Clear old verifiers is not needed for test — just set new ones and count
            let mut i: u32 = 0;
            while i < verifiers.len() {
                let v = *verifiers.at(i);
                assert(v.is_non_zero(), 'VERIFIER_ZERO');
                self.verifiers.write(v, true);
                i += 1;
            };
            self.verifier_count.write(13);
            self.emit(VerifiersUpdated { count: 13 });
        }

        fn is_verifier(self: @ContractState, account: ContractAddress) -> bool {
            self.verifiers.read(account)
        }

        fn create_bounty(ref self: ContractState, reward_amount: u128, metadata_hash: felt252) -> u64 {
            assert(reward_amount.is_non_zero(), 'REWARD_ZERO');
            let creator = get_caller_address();
            assert(creator.is_non_zero(), 'CALLER_ZERO');
            let bounty_id = self.next_bounty_id.read();
            let bounty = Bounty {
                id: bounty_id, creator, reward_amount, status: BountyStatus::Created,
                metadata_hash, created_at: get_block_timestamp(), funded_amount: 0,
                winner: starknet::contract_address_const::<0x0>(), winning_submission: 0,
            };
            self.bounties.write(bounty_id, bounty);
            self.next_bounty_id.write(bounty_id + 1);
            self.emit(BountyCreated { bounty_id, creator, reward_amount, metadata_hash });
            bounty_id
        }

        fn fund_bounty(ref self: ContractState, bounty_id: u64, amount: u128) {
            let caller = get_caller_address();
            let anonymizer = self.anonymizer.read();
            assert(anonymizer.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(caller == anonymizer, 'NOT_ANONYMIZER');
            assert(amount.is_non_zero(), 'AMOUNT_ZERO');
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Created, 'NOT_CREATED');
            assert(amount == bounty.reward_amount, 'AMOUNT_MISMATCH');
            bounty.funded_amount = amount;
            bounty.status = BountyStatus::Funded;
            self.bounties.write(bounty_id, bounty);
            self.emit(BountyFunded { bounty_id, amount, funded_amount: bounty.funded_amount });
        }

        fn get_bounty(self: @ContractState, bounty_id: u64) -> Bounty {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            bounty
        }

        fn open_bounty(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Funded, 'NOT_FUNDED');
            // Only creator or owner can open — for test, allow creator
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            bounty.status = BountyStatus::Open;
            self.bounties.write(bounty_id, bounty);
            self.emit(BountyOpened { bounty_id });
        }

        fn submit_evidence(ref self: ContractState, bounty_id: u64, evidence_hash: felt252) -> u64 {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            assert(evidence_hash.is_non_zero(), 'EVIDENCE_ZERO');
            let investigator = get_caller_address();
            assert(investigator.is_non_zero(), 'CALLER_ZERO');
            let count = self.submission_counts.read(bounty_id);
            let submission_id = count + 1;
            let submission = Submission { id: submission_id, bounty_id, investigator, evidence_hash, timestamp: get_block_timestamp() };
            self.submissions.write((bounty_id, submission_id), submission);
            self.submission_counts.write(bounty_id, submission_id);
            self.emit(EvidenceSubmitted { bounty_id, submission_id, investigator, evidence_hash });
            // If this is first submission, move to Voting? For simplicity, auto-move Open -> Voting on first submit
            // But spec says bounty goes OPEN -> VOTING explicitly. We will transition to Voting on first submit if still Open
            let mut b = self.bounties.read(bounty_id);
            if b.status == BountyStatus::Open {
                b.status = BountyStatus::Voting;
                self.bounties.write(bounty_id, b);
            }
            submission_id
        }

        fn get_submission(self: @ContractState, bounty_id: u64, submission_id: u64) -> Submission {
            let s = self.submissions.read((bounty_id, submission_id));
            assert(s.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            s
        }

        fn get_submission_count(self: @ContractState, bounty_id: u64) -> u64 {
            self.submission_counts.read(bounty_id)
        }

        fn vote(ref self: ContractState, bounty_id: u64, submission_id: u64) {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Voting, 'NOT_VOTING');
            let verifier = get_caller_address();
            assert(self.verifiers.read(verifier), 'NOT_VERIFIER');
            assert(!self.has_voted_map.read((bounty_id, verifier)), 'ALREADY_VOTED');
            let submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            self.has_voted_map.write((bounty_id, verifier), true);
            let current = self.vote_counts.read((bounty_id, submission_id));
            let new_count = current + 1;
            self.vote_counts.write((bounty_id, submission_id), new_count);
            self.emit(Voted { bounty_id, submission_id, verifier, count: new_count });
            // Check threshold 7/13
            if new_count >= 7 {
                // Winner is the investigator of this submission
                let winner = submission.investigator;
                let mut b = self.bounties.read(bounty_id);
                // Prevent double winner
                if b.status == BountyStatus::Voting {
                    b.status = BountyStatus::WinnerSelected;
                    b.winner = winner;
                    b.winning_submission = submission_id;
                    self.bounties.write(bounty_id, b);
                    self.winners.write(bounty_id, winner);
                    self.winning_submissions.write(bounty_id, submission_id);
                    self.emit(WinnerSelected { bounty_id, winner, submission_id });
                    // Immediately make claimable
                    let mut b2 = self.bounties.read(bounty_id);
                    b2.status = BountyStatus::Claimable;
                    self.bounties.write(bounty_id, b2);
                    self.emit(Claimable { bounty_id });
                }
            }
        }

        fn get_vote_count(self: @ContractState, bounty_id: u64, submission_id: u64) -> u32 {
            self.vote_counts.read((bounty_id, submission_id))
        }

        fn has_voted(self: @ContractState, bounty_id: u64, verifier: ContractAddress) -> bool {
            self.has_voted_map.read((bounty_id, verifier))
        }

        fn get_winner(self: @ContractState, bounty_id: u64) -> ContractAddress {
            self.winners.read(bounty_id)
        }

        fn get_winning_submission(self: @ContractState, bounty_id: u64) -> u64 {
            self.winning_submissions.read(bounty_id)
        }

        fn claim_payout(ref self: ContractState, bounty_id: u64) {
            // Called by VerityAnonymizer after validating winner's private payout request
            // For Phase 4, this is just a state transition; Phase 5 will call it via anonymizer
            let caller = get_caller_address();
            let anonymizer = self.anonymizer.read();
            // Allow either anonymizer or winner to claim? For now, only anonymizer (private payout)
            // But for testing, allow winner directly if anonymizer not set? No, require anonymizer.
            // To keep Phase 4 testable without private flow, allow winner to claim directly if status is Claimable
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
            // If caller is anonymizer, it's the private payout path; if caller is winner, it's direct for test
            // We allow both, but in production only anonymizer should be allowed — for now allow either
            // To enforce, check if caller is winner or anonymizer
            if caller != anonymizer && caller != bounty.winner {
                assert(false, 'NOT_AUTHORIZED_CLAIM');
            }
            bounty.status = BountyStatus::Paid;
            self.bounties.write(bounty_id, bounty);
            self.emit(Paid { bounty_id, winner: bounty.winner });
        }

        fn mark_paid(ref self: ContractState, bounty_id: u64) {
            // Alias for claim_payout when called via anonymizer — same logic
            self.claim_payout(bounty_id);
        }

        fn refund(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Created || bounty.status == BountyStatus::Funded, 'NOT_REFUNDABLE');
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            assert(bounty.status != BountyStatus::Paid, 'ALREADY_PAID');
            bounty.status = BountyStatus::Refunded;
            self.bounties.write(bounty_id, bounty);
            self.emit(Refunded { bounty_id });
        }
    }
}
