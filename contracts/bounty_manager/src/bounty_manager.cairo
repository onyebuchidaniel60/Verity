//! BountyManager — VERITY with investigator staking & anonymous reputation (no verifiers).
//! Creator-controlled winner selection, fixed stake, report/slash, reputation threshold,
//! protocol fee on refund. Preserves STRK20 private funding/payout via VerityAnonymizer.

use starknet::ContractAddress;
use crate::types::{Bounty, BountyStatus, Submission, SubmissionStatus, Report};

#[starknet::interface]
pub trait IBountyManager<T> {
    fn version(self: @T) -> felt252;
    fn create_bounty(ref self: T, reward_amount: u128, metadata_hash: felt252) -> u64;
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn get_bounty(self: @T, bounty_id: u64) -> Bounty;
    fn get_next_bounty_id(self: @T) -> u64;
    fn get_bounty_count(self: @T) -> u64;
    fn get_anonymizer(self: @T) -> ContractAddress;
    fn set_anonymizer(ref self: T, anonymizer: ContractAddress);
    fn open_bounty(ref self: T, bounty_id: u64);
    fn close_bounty(ref self: T, bounty_id: u64);
    fn submit_investigation(ref self: T, bounty_id: u64, evidence_hash: felt252) -> u64;
    fn submit_evidence(ref self: T, bounty_id: u64, evidence_hash: felt252) -> u64;
    fn get_submission(self: @T, bounty_id: u64, submission_id: u64) -> Submission;
    fn get_submission_count(self: @T, bounty_id: u64) -> u64;
    fn select_winner(ref self: T, bounty_id: u64, submission_id: u64);
    fn get_winner(self: @T, bounty_id: u64) -> ContractAddress;
    fn get_winning_submission(self: @T, bounty_id: u64) -> u64;
    fn claim_payout(ref self: T, bounty_id: u64);
    fn mark_paid(ref self: T, bounty_id: u64);
    fn refund_bounty(ref self: T, bounty_id: u64);
    fn refund(ref self: T, bounty_id: u64);
    // Staking
    fn stake(ref self: T);
    fn get_stake(self: @T, account: ContractAddress) -> u128;
    fn has_stake(self: @T, account: ContractAddress) -> bool;
    fn is_slashed(self: @T, account: ContractAddress) -> bool;
    fn get_stake_amount(self: @T) -> u128;
    fn set_stake_amount(ref self: T, amount: u128);
    // Reputation
    fn get_reputation(self: @T, account: ContractAddress) -> u64;
    fn get_minimum_reputation(self: @T) -> u64;
    fn set_minimum_reputation(ref self: T, threshold: u64);
    fn get_reputation_provider(self: @T) -> ContractAddress;
    fn set_reputation_provider(ref self: T, provider: ContractAddress);
    // Report / slash
    fn report_submission(ref self: T, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252);
    fn get_report(self: @T, bounty_id: u64, submission_id: u64) -> Report;
    // Deprecated verifier stubs — kept to surface clear error if old frontend calls them
    fn set_verifiers(ref self: T, verifiers: Span<ContractAddress>);
    fn is_verifier(self: @T, account: ContractAddress) -> bool;
    fn vote(ref self: T, bounty_id: u64, submission_id: u64);
    fn get_vote_count(self: @T, bounty_id: u64, submission_id: u64) -> u32;
    fn has_voted(self: @T, bounty_id: u64, verifier: ContractAddress) -> bool;
}

#[starknet::interface]
pub trait IReputationProvider<T> {
    fn get_score(self: @T, account: ContractAddress) -> u64;
    fn meets_threshold(self: @T, account: ContractAddress, threshold: u64) -> bool;
}

#[starknet::contract]
pub mod BountyManager {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::{IBountyManager, IReputationProviderDispatcher, IReputationProviderDispatcherTrait};
    use crate::types::{Bounty, BountyStatus, Submission, SubmissionStatus, Report};

    #[storage]
    struct Storage {
        next_bounty_id: u64,
        bounties: Map<u64, Bounty>,
        anonymizer: ContractAddress,
        owner: ContractAddress,
        // Submissions
        submission_counts: Map<u64, u64>,
        submissions: Map<(u64, u64), Submission>,
        winners: Map<u64, ContractAddress>,
        winning_submissions: Map<u64, u64>,
        // Staking
        has_staked: Map<ContractAddress, bool>,
        stake_balances: Map<ContractAddress, u128>,
        is_slashed_map: Map<ContractAddress, bool>,
        stake_amount: u128,
        // Reputation
        reputation: Map<ContractAddress, u64>,
        minimum_reputation: u64,
        reputation_provider: ContractAddress,
        // Reports
        reports: Map<(u64, u64), Report>,
        has_reported: Map<(u64, u64), bool>,
        // Protocol fee (bps, 500 = 5%)
        protocol_fee_bps: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BountyCreated: BountyCreated,
        BountyFunded: BountyFunded,
        AnonymizerUpdated: AnonymizerUpdated,
        BountyOpened: BountyOpened,
        BountyClosed: BountyClosed,
        InvestigationSubmitted: InvestigationSubmitted,
        WinnerSelected: WinnerSelected,
        Claimable: Claimable,
        Paid: Paid,
        Refunded: Refunded,
        Staked: Staked,
        ReputationUpdated: ReputationUpdated,
        Reported: Reported,
        Slashed: Slashed,
        StakeAmountUpdated: StakeAmountUpdated,
        ReputationThresholdUpdated: ReputationThresholdUpdated,
        ReputationProviderUpdated: ReputationProviderUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BountyCreated { #[key] pub bounty_id: u64, pub creator: ContractAddress, pub reward_amount: u128, pub metadata_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct BountyFunded { #[key] pub bounty_id: u64, pub amount: u128, pub funded_amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct AnonymizerUpdated { pub old: ContractAddress, pub new: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct BountyOpened { #[key] pub bounty_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct BountyClosed { #[key] pub bounty_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct InvestigationSubmitted { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub investigator: ContractAddress, pub evidence_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct WinnerSelected { #[key] pub bounty_id: u64, pub winner: ContractAddress, pub submission_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct Claimable { #[key] pub bounty_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct Paid { #[key] pub bounty_id: u64, pub winner: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct Refunded { #[key] pub bounty_id: u64, pub creator: ContractAddress, pub amount: u128, pub fee: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct Staked { #[key] pub investigator: ContractAddress, pub amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct ReputationUpdated { #[key] pub account: ContractAddress, pub old_score: u64, pub new_score: u64, pub reason: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct Reported { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub reporter: ContractAddress, pub reason: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct Slashed { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub investigator: ContractAddress, pub slashed_amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct StakeAmountUpdated { pub old: u128, pub new: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct ReputationThresholdUpdated { pub old: u64, pub new: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct ReputationProviderUpdated { pub old: ContractAddress, pub new: ContractAddress }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        let owner = if owner.is_zero() { get_caller_address() } else { owner };
        self.owner.write(owner);
        self.next_bounty_id.write(1);
        // Defaults: 1 STRK stake, 60 min reputation, 5% fee
        self.stake_amount.write(1000000000000000000);
        self.minimum_reputation.write(60);
        self.protocol_fee_bps.write(500);
    }

    #[abi(embed_v0)]
    impl BountyManagerImpl of IBountyManager<ContractState> {
        fn version(self: @ContractState) -> felt252 { 'VERITY_BOUNTY_MANAGER_V2' }

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
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            bounty.status = BountyStatus::Open;
            self.bounties.write(bounty_id, bounty);
            self.emit(BountyOpened { bounty_id });
        }

        fn close_bounty(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            // Allow closing when Funded or Open and no winner yet — essentially refund preparation
            assert(bounty.status == BountyStatus::Funded || bounty.status == BountyStatus::Open, 'NOT_CLOSABLE');
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            // For close, we just keep status as is? But spec wants refund path.
            // This is alias for refund without fee? We treat as refund.
            self.refund_bounty(bounty_id);
        }

        fn submit_investigation(ref self: ContractState, bounty_id: u64, evidence_hash: felt252) -> u64 {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            assert(evidence_hash.is_non_zero(), 'EVIDENCE_ZERO');
            let investigator = get_caller_address();
            assert(investigator.is_non_zero(), 'CALLER_ZERO');
            assert(investigator != bounty.creator, 'CREATOR_CANNOT_SUBMIT');
            assert(self.has_staked.read(investigator), 'NOT_STAKED');
            assert(!self.is_slashed_map.read(investigator), 'IS_SLASHED');
            // Reputation threshold
            let rep = self._get_reputation(investigator);
            let min_rep = self.minimum_reputation.read();
            assert(rep >= min_rep, 'REPUTATION_TOO_LOW');
            let count = self.submission_counts.read(bounty_id);
            let submission_id = count + 1;
            let submission = Submission { id: submission_id, bounty_id, investigator, evidence_hash, timestamp: get_block_timestamp(), status: SubmissionStatus::Pending };
            self.submissions.write((bounty_id, submission_id), submission);
            self.submission_counts.write(bounty_id, submission_id);
            self.emit(InvestigationSubmitted { bounty_id, submission_id, investigator, evidence_hash });
            submission_id
        }

        fn submit_evidence(ref self: ContractState, bounty_id: u64, evidence_hash: felt252) -> u64 {
            self.submit_investigation(bounty_id, evidence_hash)
        }

        fn get_submission(self: @ContractState, bounty_id: u64, submission_id: u64) -> Submission {
            let s = self.submissions.read((bounty_id, submission_id));
            assert(s.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            s
        }

        fn get_submission_count(self: @ContractState, bounty_id: u64) -> u64 {
            self.submission_counts.read(bounty_id)
        }

        fn select_winner(ref self: ContractState, bounty_id: u64, submission_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let caller = get_caller_address();
            assert(caller == bounty.creator, 'NOT_CREATOR');
            let mut submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.status == SubmissionStatus::Pending, 'NOT_PENDING');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            // Mark winner
            bounty.winner = submission.investigator;
            bounty.winning_submission = submission_id;
            bounty.status = BountyStatus::WinnerSelected;
            self.bounties.write(bounty_id, bounty);
            self.winners.write(bounty_id, submission.investigator);
            self.winning_submissions.write(bounty_id, submission_id);
            // Update submission to Accepted
            submission.status = SubmissionStatus::Accepted;
            self.submissions.write((bounty_id, submission_id), submission);
            self.emit(WinnerSelected { bounty_id, winner: submission.investigator, submission_id });
            // Reputation boost for winner +10 capped at 100
            let winner = submission.investigator;
            let old_rep = self._get_reputation(winner);
            let new_rep = if old_rep + 10 > 100 { 100 } else { old_rep + 10 };
            self.reputation.write(winner, new_rep);
            self.emit(ReputationUpdated { account: winner, old_score: old_rep, new_score: new_rep, reason: 'WIN_SELECTED' });
            // Transition to Claimable immediately
            let mut b2 = self.bounties.read(bounty_id);
            b2.status = BountyStatus::Claimable;
            self.bounties.write(bounty_id, b2);
            self.emit(Claimable { bounty_id });
        }

        fn get_winner(self: @ContractState, bounty_id: u64) -> ContractAddress {
            self.winners.read(bounty_id)
        }

        fn get_winning_submission(self: @ContractState, bounty_id: u64) -> u64 {
            self.winning_submissions.read(bounty_id)
        }

        fn claim_payout(ref self: ContractState, bounty_id: u64) {
            let caller = get_caller_address();
            let anonymizer = self.anonymizer.read();
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
            if caller != anonymizer && caller != bounty.winner {
                assert(false, 'NOT_AUTHORIZED_CLAIM');
            }
            bounty.status = BountyStatus::Paid;
            self.bounties.write(bounty_id, bounty);
            self.emit(Paid { bounty_id, winner: bounty.winner });
        }

        fn mark_paid(ref self: ContractState, bounty_id: u64) {
            self.claim_payout(bounty_id);
        }

        fn refund_bounty(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Created || bounty.status == BountyStatus::Funded || bounty.status == BountyStatus::Open, 'NOT_REFUNDABLE');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            assert(bounty.status != BountyStatus::Paid, 'ALREADY_PAID');
            assert(bounty.status != BountyStatus::Refunded, 'ALREADY_REFUNDED');
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            // Protocol fee: 5% of funded_amount if funded, else 0
            let fee_bps = self.protocol_fee_bps.read();
            let fee: u128 = if bounty.funded_amount.is_non_zero() {
                (bounty.funded_amount * fee_bps.into()) / 10000
            } else {
                0
            };
            bounty.status = BountyStatus::Refunded;
            self.bounties.write(bounty_id, bounty);
            self.emit(Refunded { bounty_id, creator: bounty.creator, amount: bounty.funded_amount, fee });
        }

        fn refund(ref self: ContractState, bounty_id: u64) {
            self.refund_bounty(bounty_id);
        }

        // Staking
        fn stake(ref self: ContractState) {
            let caller = get_caller_address();
            assert(caller.is_non_zero(), 'CALLER_ZERO');
            assert(!self.has_staked.read(caller), 'ALREADY_STAKED');
            assert(!self.is_slashed_map.read(caller), 'IS_SLASHED_CANNOT_STAKE');
            let amount = self.stake_amount.read();
            assert(amount.is_non_zero(), 'STAKE_ZERO');
            self.has_staked.write(caller, true);
            self.stake_balances.write(caller, amount);
            // Initial reputation 60 if not set
            if self.reputation.read(caller) == 0 {
                self.reputation.write(caller, 60);
                self.emit(ReputationUpdated { account: caller, old_score: 0, new_score: 60, reason: 'INITIAL_STAKE' });
            }
            self.emit(Staked { investigator: caller, amount });
        }

        fn get_stake(self: @ContractState, account: ContractAddress) -> u128 {
            self.stake_balances.read(account)
        }

        fn has_stake(self: @ContractState, account: ContractAddress) -> bool {
            self.has_staked.read(account)
        }

        fn is_slashed(self: @ContractState, account: ContractAddress) -> bool {
            self.is_slashed_map.read(account)
        }

        fn get_stake_amount(self: @ContractState) -> u128 {
            self.stake_amount.read()
        }

        fn set_stake_amount(ref self: ContractState, amount: u128) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(amount.is_non_zero(), 'STAKE_ZERO');
            let old = self.stake_amount.read();
            self.stake_amount.write(amount);
            self.emit(StakeAmountUpdated { old, new: amount });
        }

        // Reputation
        fn get_reputation(self: @ContractState, account: ContractAddress) -> u64 {
            self._get_reputation(account)
        }

        fn get_minimum_reputation(self: @ContractState) -> u64 {
            self.minimum_reputation.read()
        }

        fn set_minimum_reputation(ref self: ContractState, threshold: u64) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(threshold <= 100, 'THRESHOLD_TOO_HIGH');
            let old = self.minimum_reputation.read();
            self.minimum_reputation.write(threshold);
            self.emit(ReputationThresholdUpdated { old, new: threshold });
        }

        fn get_reputation_provider(self: @ContractState) -> ContractAddress {
            self.reputation_provider.read()
        }

        fn set_reputation_provider(ref self: ContractState, provider: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            let old = self.reputation_provider.read();
            self.reputation_provider.write(provider);
            self.emit(ReputationProviderUpdated { old, new: provider });
        }

        // Report / slash
        fn report_submission(ref self: ContractState, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252) {
            assert(reason.is_non_zero(), 'REASON_ZERO');
            assert(evidence.is_non_zero(), 'EVIDENCE_ZERO');
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let caller = get_caller_address();
            assert(caller == bounty.creator, 'NOT_CREATOR');
            let mut submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.status == SubmissionStatus::Pending, 'NOT_PENDING');
            assert(!self.has_reported.read((bounty_id, submission_id)), 'ALREADY_REPORTED');
            // Create report
            let report = Report { bounty_id, submission_id, reporter: caller, reason, evidence, timestamp: get_block_timestamp(), resolved: false, slashed: false };
            self.reports.write((bounty_id, submission_id), report);
            self.has_reported.write((bounty_id, submission_id), true);
            submission.status = SubmissionStatus::Reported;
            self.submissions.write((bounty_id, submission_id), submission);
            self.emit(Reported { bounty_id, submission_id, reporter: caller, reason });
            // Immediate slash safeguard: limit to one slash per investigator per bounty, amount is stake, reputation -20
            let investigator = submission.investigator;
            assert(!self.is_slashed_map.read(investigator), 'ALREADY_SLASHED');
            // Prevent creator abuse: only allow slash if submission was Pending and now Reported, and not already slashed
            let old_rep = self._get_reputation(investigator);
            let new_rep = if old_rep >= 20 { old_rep - 20 } else { 0 };
            self.reputation.write(investigator, new_rep);
            self.is_slashed_map.write(investigator, true);
            // Optionally clear stake? Keep stake but mark slashed; future submits will fail due to is_slashed check
            self.emit(ReputationUpdated { account: investigator, old_score: old_rep, new_score: new_rep, reason: 'SLASHED' });
            let stake_amt = self.stake_balances.read(investigator);
            self.emit(Slashed { bounty_id, submission_id, investigator, slashed_amount: stake_amt });
            // Mark report as resolved/slashed
            let mut r = self.reports.read((bounty_id, submission_id));
            r.resolved = true;
            r.slashed = true;
            self.reports.write((bounty_id, submission_id), r);
            // Update submission to Slashed
            let mut sub2 = self.submissions.read((bounty_id, submission_id));
            sub2.status = SubmissionStatus::Slashed;
            self.submissions.write((bounty_id, submission_id), sub2);
        }

        fn get_report(self: @ContractState, bounty_id: u64, submission_id: u64) -> Report {
            let r = self.reports.read((bounty_id, submission_id));
            assert(r.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            r
        }

        // Deprecated verifier stubs
        fn set_verifiers(ref self: ContractState, verifiers: Span<ContractAddress>) {
            assert(false, 'VERIFIERS_REMOVED');
        }
        fn is_verifier(self: @ContractState, account: ContractAddress) -> bool {
            false
        }
        fn vote(ref self: ContractState, bounty_id: u64, submission_id: u64) {
            assert(false, 'VERIFIERS_REMOVED');
        }
        fn get_vote_count(self: @ContractState, bounty_id: u64, submission_id: u64) -> u32 {
            0
        }
        fn has_voted(self: @ContractState, bounty_id: u64, verifier: ContractAddress) -> bool {
            false
        }
    }

    // Internal reputation helper with provider abstraction
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _get_reputation(self: @ContractState, account: ContractAddress) -> u64 {
            let provider = self.reputation_provider.read();
            if provider.is_non_zero() {
                let dispatcher = IReputationProviderDispatcher { contract_address: provider };
                // If external provider reverts or returns 0, fallback to internal
                // We try to call; if it fails, return internal. For simplicity, we just call and if 0 fallback?
                // For now, we attempt and if threshold check would fail, we use internal.
                // To avoid cross-contract call failure in tests when provider not deployed, we skip if provider is zero.
                // So if provider is set, we delegate.
                // Note: In production, provider must implement IReputationProvider correctly.
                // We use a low-level call pattern: directly return dispatcher result, but if it panics, it will propagate.
                // That's acceptable — provider failure should be visible.
                dispatcher.get_score(account)
            } else {
                self.reputation.read(account)
            }
        }
    }
}
