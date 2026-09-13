//! BountyManager â€” VERITY with investigator staking & anonymous reputation (no verifiers).
//! Creator-controlled winner selection, fixed stake, report/slash, reputation threshold,
//! protocol fee on refund. Preserves STRK20 private funding/payout via VerityAnonymizer.

use core::traits::TryInto;
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
    // Option A evidence transport (public text, private author): full UTF-8
    // text as 31-byte felt chunks, published after submission via direct call
    // (challenge pattern). See `publish_evidence` impl notes.
    fn publish_evidence(ref self: T, bounty_id: u64, submission_id: u64, chunks: Span<felt252>, preimage: felt252);
    fn get_submission_evidence(self: @T, bounty_id: u64, submission_id: u64) -> Span<felt252>;
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
    // Report / slash with dispute window
    fn report_submission(ref self: T, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252);
    fn challenge_report(ref self: T, bounty_id: u64, submission_id: u64);
    fn resolve_report(ref self: T, bounty_id: u64, submission_id: u64, should_slash: bool);
    fn get_report(self: @T, bounty_id: u64, submission_id: u64) -> Report;
    fn withdraw_stake(ref self: T);
    // Private creator identity (commitment-keyed, same hash-chain scheme as
    // investigators â€” docs/PRIVATE_INVESTIGATOR.md Â§creator). Alias bounties
    // record NO creator wallet: `creator` holds the alias cast as an address
    // and control is proven per-action with chain preimages. Value movement
    // still needs a real address, so the creator binds a self-chosen
    // `payout_address` (refunds land there; withdraw edges are inherently
    // public â€” use a fresh address). Legacy entries are frozen for legacy
    // bounties (alias == 0); owner backstop is retained on both paths.
    fn create_bounty_private(ref self: T, reward_amount: u128, metadata_hash: felt252, creator_alias: felt252) -> u64;
    fn set_payout_address(ref self: T, bounty_id: u64, payout: ContractAddress, preimage: felt252);
    fn open_bounty_private(ref self: T, bounty_id: u64, preimage: felt252);
    fn select_winner_private(ref self: T, bounty_id: u64, submission_id: u64, preimage: felt252);
    fn report_private(ref self: T, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252, preimage: felt252);
    fn resolve_report_private(ref self: T, bounty_id: u64, submission_id: u64, should_slash: bool, preimage: felt252);
    fn verify_creator_preimage(self: @T, alias: felt252, preimage: felt252) -> bool;
    fn get_payout_recipient(self: @T, bounty_id: u64) -> ContractAddress;
    // Private investigator identities (commitment-keyed, STRK20-routed).
    // Identity = genesis tip of a Poseidon hash chain whose seed never leaves
    // the investigator's device (see docs/PRIVATE_INVESTIGATOR.md). No wallet
    // address is recorded for private identities. Registration, private
    // submission and payout-lock registration are pool-routed via the
    // VerityAnonymizer (caller == anonymizer); challenge consumes a chain
    // preimage from ANY direct caller (preimage is the auth, sender is
    // irrelevant). Legacy wallet-keyed entries above are frozen for compat.
    fn register_stake_identity(ref self: T, identity: felt252, amount: u128);
    // NOTE: pool-routed private entries resolve the identity from the chain
    // preimage (`tip = Poseidon(preimage)` â†’ `tip_owner[tip]`), so the
    // identity itself never travels in invoke calldata. This keeps the
    // 6-argument `privacy_invoke` shape byte-identical for FUND/REFUND/RELEASE
    // (per-op slot table in docs/PRIVATE_INVESTIGATOR.md).
    fn submit_private(ref self: T, bounty_id: u64, evidence_hash: felt252, preimage: felt252) -> u64;
    fn challenge_private_report(ref self: T, bounty_id: u64, submission_id: u64, preimage: felt252);
    fn register_private_payout_lock(ref self: T, bounty_id: u64, payout_lock: felt252, preimage: felt252);
    fn consume_preimage_by_tip(ref self: T, preimage: felt252) -> felt252;
    fn get_identity_tip(self: @T, identity: felt252) -> felt252;
    fn get_identity_reputation(self: @T, identity: felt252) -> u64;
    fn is_identity_registered(self: @T, identity: felt252) -> bool;
    fn is_identity_slashed(self: @T, identity: felt252) -> bool;
    fn is_identity_eligible(self: @T, identity: felt252) -> bool;
    fn get_identity_stake(self: @T, identity: felt252) -> u128;
    fn get_private_payout_lock(self: @T, bounty_id: u64) -> felt252;
    // Deprecated verifier stubs â€” kept to surface clear error if old frontend calls them
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

/// Minimal view of the VerityAnonymizer escrow/slash surface, as seen from
/// BountyManager. Declared locally (no package dependency) to avoid a
/// bounty_manager â†’ verity_anonymizer dependency cycle: the anonymizer package
/// already depends on bounty_manager types. Must stay in sync with
/// `IVerityAnonymizer::{get_stake_escrow, slash_stake}`.
#[starknet::interface]
pub trait IStakeHelper<T> {
    fn get_stake_escrow(self: @T, identity: felt252) -> u128;
    fn slash_stake(ref self: T, identity: felt252);
}

/// Length of the investigator hash chain committed at private-stake time.
/// Each submit / challenge / payout-register / unstake consumes one preimage.
pub const IDENTITY_CHAIN_LEN: u64 = 64;

/// Maximum 31-byte evidence text chunks per submission (Option A transport).
/// 64 chunks ≈ 1984 bytes of UTF-8 — enough for MVP investigations, bounded
/// against gas bombs. Raise only with a fee/DoS review.
pub const MAX_EVIDENCE_CHUNKS: usize = 64;

/// Cast a private identity commitment to an address for storage in
/// address-typed fields (Submission.investigator, Bounty.winner) and for the
/// address-keyed `IReputationProvider` boundary. The value is a pseudonym:
/// it carries no wallet information.
pub fn identity_to_address(identity: felt252) -> ContractAddress {
    let addr: ContractAddress = identity.try_into().unwrap();
    addr
}

#[starknet::contract]
pub mod BountyManager {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::{IBountyManager, IReputationProviderDispatcher, IReputationProviderDispatcherTrait, IStakeHelperDispatcher, IStakeHelperDispatcherTrait, IDENTITY_CHAIN_LEN, MAX_EVIDENCE_CHUNKS, identity_to_address};
    use crate::types::{Bounty, BountyStatus, Submission, SubmissionStatus, Report};

    const CHALLENGE_PERIOD: u64 = 259200; // 3 days

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
        // Option A evidence text chunks: (bounty_id, submission_id, chunk_idx).
        submission_evidence: Map<(u64, u64, u64), felt252>,
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
        // Private investigator identities (commitment-keyed; no wallet data).
        // Identity = genesis tip of the investigator's Poseidon hash chain.
        id_tip: Map<felt252, felt252>,
        id_chain_len: Map<felt252, u64>,
        id_registered: Map<felt252, bool>,
        id_reputation: Map<felt252, u64>,
        id_slashed: Map<felt252, bool>,
        // Reverse index: every live (and past) chain tip â†’ owning identity.
        // Lets pool-routed entries resolve the identity from a preimage alone.
        tip_owner: Map<felt252, felt252>,
        // Private creator identities (separate namespace: creators carry no
        // reputation/slash state, only control auth per bounty).
        c_tip: Map<felt252, felt252>,
        c_chain_len: Map<felt252, u64>,
        c_registered: Map<felt252, bool>,
        c_owner: Map<felt252, felt252>,
        // Payout locks committed by private winners (consumed by RELEASE).
        private_payout_locks: Map<u64, felt252>,
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
        StakeWithdrawn: StakeWithdrawn,
        ReputationUpdated: ReputationUpdated,
        Reported: Reported,
        Challenged: Challenged,
        ReportResolved: ReportResolved,
        Slashed: Slashed,
        StakeAmountUpdated: StakeAmountUpdated,
        ReputationThresholdUpdated: ReputationThresholdUpdated,
        ReputationProviderUpdated: ReputationProviderUpdated,
        IdentityRegistered: IdentityRegistered,
        PrivateInvestigationSubmitted: PrivateInvestigationSubmitted,
        PrivatePayoutLockRegistered: PrivatePayoutLockRegistered,
        PrivateBountyCreated: PrivateBountyCreated,
        PayoutAddressSet: PayoutAddressSet,
        EvidencePublished: EvidencePublished,
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
    pub struct Challenged { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub investigator: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct ReportResolved { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub slashed: bool, pub resolver: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct Slashed { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub investigator: ContractAddress, pub slashed_amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct StakeWithdrawn { #[key] pub investigator: ContractAddress, pub amount: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct StakeAmountUpdated { pub old: u128, pub new: u128 }
    #[derive(Drop, starknet::Event)]
    pub struct ReputationThresholdUpdated { pub old: u64, pub new: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct ReputationProviderUpdated { pub old: ContractAddress, pub new: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct IdentityRegistered { #[key] pub identity: felt252, pub amount: u128, pub chain_len: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct PrivateInvestigationSubmitted { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub identity: felt252, pub evidence_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct PrivatePayoutLockRegistered { #[key] pub bounty_id: u64, pub identity: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct PrivateBountyCreated { #[key] pub bounty_id: u64, pub creator_alias: felt252, pub reward_amount: u128, pub metadata_hash: felt252 }
    #[derive(Drop, starknet::Event)]
    pub struct PayoutAddressSet { #[key] pub bounty_id: u64, pub payout: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct EvidencePublished { #[key] pub bounty_id: u64, #[key] pub submission_id: u64, pub chunks: u64 }

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
                creator_alias: 0, payout_address: starknet::contract_address_const::<0x0>(),
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
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Funded, 'NOT_FUNDED');
            let caller = get_caller_address();
            assert(caller == bounty.creator || caller == self.owner.read(), 'NOT_CREATOR');
            self._open_inner(bounty_id);
        }

        fn close_bounty(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            // Allow closing when Funded or Open and no winner yet â€” essentially refund preparation
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
            // Alias bounties accept ONLY commitment-keyed private submissions:
            // a wallet check cannot exclude the creator without linking
            // wallets to the alias, so the wallet path is closed entirely.
            assert(bounty.creator_alias.is_zero(), 'USE_PRIVATE_SUBMIT');
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
            let submission = Submission { id: submission_id, bounty_id, investigator, evidence_hash, timestamp: get_block_timestamp(), status: SubmissionStatus::Pending, identity: 0, evidence_len: 0 };
            self.submissions.write((bounty_id, submission_id), submission);
            self.submission_counts.write(bounty_id, submission_id);
            self.emit(InvestigationSubmitted { bounty_id, submission_id, investigator, evidence_hash });
            submission_id
        }

        fn submit_evidence(ref self: ContractState, bounty_id: u64, evidence_hash: felt252) -> u64 {
            self.submit_investigation(bounty_id, evidence_hash)
        }

        // Option A evidence transport (public text, private author — §47.12).
        // Direct call (challenge pattern), deliberately NOT pool-routed:
        // content is public by design, so no privacy leg is needed and no
        // pool fee applies. Sender IS visible on-chain: investigators who
        // care about unlinkability should publish from a fresh account
        // (same operational guidance as challenge_private_report).
        // Auth: private submissions consume a chain preimage (retiring it —
        // a NON-consuming reveal would leave it valid for impersonation, so
        // that shape is explicitly rejected here); legacy submissions check
        // caller == investigator. First-write-wins (no overwrite, no delete).
        fn publish_evidence(ref self: ContractState, bounty_id: u64, submission_id: u64, chunks: Span<felt252>, preimage: felt252) {
            let mut submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.evidence_len == 0, 'EVIDENCE_ALREADY_SET');
            let n = chunks.len();
            assert(n > 0, 'EVIDENCE_EMPTY');
            assert(n <= MAX_EVIDENCE_CHUNKS, 'EVIDENCE_TOO_LONG');
            if submission.identity.is_non_zero() {
                self._consume_preimage_inner(submission.identity, preimage);
            } else {
                assert(get_caller_address() == submission.investigator, 'NOT_INVESTIGATOR');
            }
            let mut i: usize = 0;
            while i < n {
                let idx: u64 = i.try_into().expect('IDX_OVERFLOW');
                self.submission_evidence.write((bounty_id, submission_id, idx), *chunks.at(i));
                i += 1;
            };
            let n_u64: u64 = n.try_into().expect('LEN_OVERFLOW');
            submission.evidence_len = n_u64;
            self.submissions.write((bounty_id, submission_id), submission);
            self.emit(EvidencePublished { bounty_id, submission_id, chunks: n_u64 });
        }

        fn get_submission_evidence(self: @ContractState, bounty_id: u64, submission_id: u64) -> Span<felt252> {
            let submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            let n = submission.evidence_len;
            let mut out: Array<felt252> = array![];
            let mut i: u64 = 0;
            while i < n {
                out.append(self.submission_evidence.read((bounty_id, submission_id, i)));
                i += 1;
            };
            out.span()
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
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let caller = get_caller_address();
            assert(caller == bounty.creator, 'NOT_CREATOR');
            self._select_inner(bounty_id, submission_id);
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
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Created || bounty.status == BountyStatus::Funded || bounty.status == BountyStatus::Open, 'NOT_REFUNDABLE');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            assert(bounty.status != BountyStatus::Paid, 'ALREADY_PAID');
            assert(bounty.status != BountyStatus::Refunded, 'ALREADY_REFUNDED');
            let caller = get_caller_address();
            let owner = self.owner.read();
            let helper = self.anonymizer.read();
            // The pool-routed helper REFUND op is an authorized caller on BOTH
            // paths: it verified the single-use refund secret (bearer auth
            // created by the creator at setup) before forwarding here.
            let via_helper = helper.is_non_zero() && caller == helper;
            if bounty.creator_alias.is_zero() {
                assert(caller == bounty.creator || caller == owner || via_helper, 'NOT_CREATOR');
            } else {
                // Alias bounty: the pool-routed helper REFUND op carries the
                // single-use refund secret as bearer auth (no wallet involved,
                // by design). Owner backstop retained.
                assert(helper.is_non_zero() && (caller == helper || caller == owner), 'NOT_AUTHORIZED');
            }
            self._refund_inner(bounty_id);
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

        // Report / slash with dispute window â€” prevents immediate creator abuse
        // 1. report_submission: creator reports, creates Report with challenge_deadline = now + 3 days, status Reported, no slashing yet
        // 2. challenge_report: investigator may challenge within deadline, sets challenged=true
        // 3. resolve_report: after deadline (or immediately if challenged, only owner may resolve), decides should_slash
        fn report_submission(ref self: ContractState, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252) {
            assert(reason.is_non_zero(), 'REASON_ZERO');
            assert(evidence.is_non_zero(), 'EVIDENCE_ZERO');
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let caller = get_caller_address();
            assert(caller == bounty.creator, 'NOT_CREATOR');
            self._report_inner(bounty_id, submission_id, caller, reason, evidence);
        }

        fn challenge_report(ref self: ContractState, bounty_id: u64, submission_id: u64) {
            let mut report = self.reports.read((bounty_id, submission_id));
            assert(report.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            assert(!report.resolved, 'ALREADY_RESOLVED');
            assert(!report.challenged, 'ALREADY_CHALLENGED');
            let now = get_block_timestamp();
            assert(now <= report.challenge_deadline, 'CHALLENGE_EXPIRED');
            let submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            let caller = get_caller_address();
            assert(caller == submission.investigator, 'NOT_INVESTIGATOR');
            report.challenged = true;
            self.reports.write((bounty_id, submission_id), report);
            self.emit(Challenged { bounty_id, submission_id, investigator: caller });
        }

        fn resolve_report(ref self: ContractState, bounty_id: u64, submission_id: u64, should_slash: bool) {
            let mut report = self.reports.read((bounty_id, submission_id));
            assert(report.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            assert(!report.resolved, 'ALREADY_RESOLVED');
            let now = get_block_timestamp();
            let caller = get_caller_address();
            let bounty = self.bounties.read(bounty_id);
            let is_owner = caller == self.owner.read();
            let is_creator = caller == bounty.creator;
            // If challenged, only owner may resolve (prevents creator from overriding challenge)
            // If not challenged, creator or owner may resolve after deadline, or owner may resolve early
            if report.challenged {
                assert(is_owner, 'NOT_OWNER_FOR_CHALLENGED');
            } else {
                // Not challenged: allow creator or owner after deadline, or owner early
                if !is_owner {
                    assert(is_creator, 'NOT_AUTHORIZED');
                    assert(now > report.challenge_deadline, 'CHALLENGE_PERIOD_ACTIVE');
                }
            }
            self._resolve_inner(bounty_id, submission_id, should_slash, caller);
        }

        fn get_report(self: @ContractState, bounty_id: u64, submission_id: u64) -> Report {
            let r = self.reports.read((bounty_id, submission_id));
            assert(r.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            r
        }

        fn withdraw_stake(ref self: ContractState) {
            let caller = get_caller_address();
            assert(self.has_staked.read(caller), 'NOT_STAKED');
            assert(!self.is_slashed_map.read(caller), 'IS_SLASHED_CANNOT_WITHDRAW');
            let amount = self.stake_balances.read(caller);
            assert(amount.is_non_zero(), 'NO_STAKE_BALANCE');
            // For MVP, stake is just a flag; we clear it and allow re-staking later if desired
            // In a real STRK-locking version, this would transfer STRK back to caller via ERC20
            self.has_staked.write(caller, false);
            self.stake_balances.write(caller, 0);
            self.emit(StakeWithdrawn { investigator: caller, amount });
        }

        // Private investigator identities (STRK20-routed; see docs/PRIVATE_INVESTIGATOR.md).
        // Registration is pool-routed: the helper escrows real STRK first,
        // then calls here with caller == anonymizer. No wallet address is
        // recorded. Re-registration of a live identity is idempotent (rep
        // history preserved); slashed identities can never re-register.
        fn register_stake_identity(ref self: ContractState, identity: felt252, amount: u128) {
            let helper = self.anonymizer.read();
            assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(get_caller_address() == helper, 'NOT_ANONYMIZER');
            assert(identity.is_non_zero(), 'IDENTITY_ZERO');
            assert(amount == self.stake_amount.read(), 'AMOUNT_MISMATCH');
            assert(!self.id_slashed.read(identity), 'IS_SLASHED_CANNOT_STAKE');
            if !self.id_registered.read(identity) {
                self.id_registered.write(identity, true);
                self.id_tip.write(identity, identity);
                self.tip_owner.write(identity, identity);
                self.id_chain_len.write(identity, IDENTITY_CHAIN_LEN);
                self.id_reputation.write(identity, 60);
                self.emit(ReputationUpdated { account: identity_to_address(identity), old_score: 0, new_score: 60, reason: 'INITIAL_STAKE' });
                self.emit(IdentityRegistered { identity, amount, chain_len: IDENTITY_CHAIN_LEN });
            }
        }

        // Pool-routed private submission (caller == anonymizer). Auth is the
        // hash-chain preimage: the identity is resolved as
        // `tip_owner[Poseidon(preimage)]` and the tip advances atomically, so a
        // revealed preimage can never authorize again. The direct caller is NOT
        // recorded, so any relayer/wallet may relay without linking a wallet
        // to the identity.
        // KNOWN LIMITATION (documented): creator self-submission via a private
        // identity cannot be excluded on-chain without breaking investigator
        // privacy; it is economically irrational (stake + pool fees exceed any
        // gain from winning one's own reward).
        fn submit_private(ref self: ContractState, bounty_id: u64, evidence_hash: felt252, preimage: felt252) -> u64 {
            let helper = self.anonymizer.read();
            assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(get_caller_address() == helper, 'NOT_ANONYMIZER');
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            assert(evidence_hash.is_non_zero(), 'EVIDENCE_ZERO');
            let identity = self._consume_by_tip_inner(preimage);
            assert(!self.id_slashed.read(identity), 'IS_SLASHED');
            let rep = self._get_identity_reputation(identity);
            assert(rep >= self.minimum_reputation.read(), 'REPUTATION_TOO_LOW');
            let escrow = self._identity_escrow(identity);
            assert(escrow >= self.stake_amount.read(), 'NOT_STAKED');
            let count = self.submission_counts.read(bounty_id);
            let submission_id = count + 1;
            let pseudo = identity_to_address(identity);
            let submission = Submission { id: submission_id, bounty_id, investigator: pseudo, evidence_hash, timestamp: get_block_timestamp(), status: SubmissionStatus::Pending, identity, evidence_len: 0 };
            self.submissions.write((bounty_id, submission_id), submission);
            self.submission_counts.write(bounty_id, submission_id);
            self.emit(PrivateInvestigationSubmitted { bounty_id, submission_id, identity, evidence_hash });
            submission_id
        }

        // Direct-call challenge for private submissions, callable by ANY
        // account: knowledge of the next chain preimage IS the authorization
        // (proves ownership of the identity without revealing a wallet or the
        // seed). Kept direct (not pool-routed) so disputes can beat the
        // challenge deadline without proof latency/fees; no new linkage is
        // created beyond what the pool-routed submission already published.
        fn challenge_private_report(ref self: ContractState, bounty_id: u64, submission_id: u64, preimage: felt252) {
            let mut report = self.reports.read((bounty_id, submission_id));
            assert(report.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            assert(!report.resolved, 'ALREADY_RESOLVED');
            assert(!report.challenged, 'ALREADY_CHALLENGED');
            let now = get_block_timestamp();
            assert(now <= report.challenge_deadline, 'CHALLENGE_EXPIRED');
            let submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.identity.is_non_zero(), 'NOT_PRIVATE_SUBMISSION');
            self._consume_preimage_inner(submission.identity, preimage);
            report.challenged = true;
            self.reports.write((bounty_id, submission_id), report);
            self.emit(Challenged { bounty_id, submission_id, investigator: submission.investigator });
        }

        // Pool-routed payout-lock registration for private winners
        // (caller == anonymizer). The helper stores the verified lock in its
        // own payout_locks map, so the existing RELEASE op works unchanged.
        fn register_private_payout_lock(
            ref self: ContractState, bounty_id: u64, payout_lock: felt252, preimage: felt252,
        ) {
            let helper = self.anonymizer.read();
            assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(get_caller_address() == helper, 'NOT_ANONYMIZER');
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Claimable, 'NOT_CLAIMABLE');
            assert(payout_lock.is_non_zero(), 'LOCK_ZERO');
            let identity = self._consume_by_tip_inner(preimage);
            assert(bounty.winner == identity_to_address(identity), 'NOT_WINNER');
            self.private_payout_locks.write(bounty_id, payout_lock);
            self.emit(PrivatePayoutLockRegistered { bounty_id, identity });
        }

        // Pool-routed preimage consumption used by helper-side flows that
        // need identity auth without a BM state transition (UNSTAKE).
        // Returns the resolved identity.
        fn consume_preimage_by_tip(ref self: ContractState, preimage: felt252) -> felt252 {
            let helper = self.anonymizer.read();
            assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(get_caller_address() == helper, 'NOT_ANONYMIZER');
            self._consume_by_tip_inner(preimage)
        }

        fn get_identity_tip(self: @ContractState, identity: felt252) -> felt252 {
            self.id_tip.read(identity)
        }

        fn get_identity_reputation(self: @ContractState, identity: felt252) -> u64 {
            self._get_identity_reputation(identity)
        }

        fn is_identity_registered(self: @ContractState, identity: felt252) -> bool {
            self.id_registered.read(identity)
        }

        fn is_identity_slashed(self: @ContractState, identity: felt252) -> bool {
            self.id_slashed.read(identity)
        }

        fn get_identity_stake(self: @ContractState, identity: felt252) -> u128 {
            self._identity_escrow(identity)
        }

        fn get_private_payout_lock(self: @ContractState, bounty_id: u64) -> felt252 {
            self.private_payout_locks.read(bounty_id)
        }

        // Private creator identity entries. Control auth is a chain preimage
        // against the bounty's alias tip — knowledge, not caller address — so
        // any relayer may submit without linking a wallet to the alias.
        // Pool-routed creation parallels investigator registration; all other
        // creator ops are direct calls (no pool fee, no proof latency) whose
        // sender is semantically irrelevant.
        fn create_bounty_private(ref self: ContractState, reward_amount: u128, metadata_hash: felt252, creator_alias: felt252) -> u64 {
            let helper = self.anonymizer.read();
            assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
            assert(get_caller_address() == helper, 'NOT_ANONYMIZER');
            assert(reward_amount.is_non_zero(), 'REWARD_ZERO');
            assert(creator_alias.is_non_zero(), 'ALIAS_ZERO');
            if !self.c_registered.read(creator_alias) {
                self.c_registered.write(creator_alias, true);
                self.c_tip.write(creator_alias, creator_alias);
                self.c_owner.write(creator_alias, creator_alias);
                self.c_chain_len.write(creator_alias, IDENTITY_CHAIN_LEN);
            }
            let bounty_id = self.next_bounty_id.read();
            let pseudo = identity_to_address(creator_alias);
            let bounty = Bounty {
                id: bounty_id, creator: pseudo, reward_amount, status: BountyStatus::Created,
                metadata_hash, created_at: get_block_timestamp(), funded_amount: 0,
                winner: starknet::contract_address_const::<0x0>(), winning_submission: 0,
                creator_alias, payout_address: starknet::contract_address_const::<0x0>(),
            };
            self.bounties.write(bounty_id, bounty);
            self.next_bounty_id.write(bounty_id + 1);
            self.emit(BountyCreated { bounty_id, creator: pseudo, reward_amount, metadata_hash });
            self.emit(PrivateBountyCreated { bounty_id, creator_alias, reward_amount, metadata_hash });
            bounty_id
        }

        // Bind the refund/value recipient (creator-chosen real address).
        // Pre-funding only; non-consuming auth (idempotent setup).
        fn set_payout_address(ref self: ContractState, bounty_id: u64, payout: ContractAddress, preimage: felt252) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.creator_alias.is_non_zero(), 'NOT_ALIAS_BOUNTY');
            assert(bounty.status == BountyStatus::Created, 'NOT_CREATED');
            assert(payout.is_non_zero(), 'PAYOUT_ZERO');
            assert(self._verify_creator_inner(bounty.creator_alias, preimage), 'BAD_PREIMAGE');
            bounty.payout_address = payout;
            self.bounties.write(bounty_id, bounty);
            self.emit(PayoutAddressSet { bounty_id, payout });
        }

        fn open_bounty_private(ref self: ContractState, bounty_id: u64, preimage: felt252) {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.creator_alias.is_non_zero(), 'NOT_ALIAS_BOUNTY');
            self._consume_creator_inner(bounty.creator_alias, preimage);
            self._open_inner(bounty_id);
        }

        fn select_winner_private(ref self: ContractState, bounty_id: u64, submission_id: u64, preimage: felt252) {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.creator_alias.is_non_zero(), 'NOT_ALIAS_BOUNTY');
            self._consume_creator_inner(bounty.creator_alias, preimage);
            self._select_inner(bounty_id, submission_id);
        }

        fn report_private(ref self: ContractState, bounty_id: u64, submission_id: u64, reason: felt252, evidence: felt252, preimage: felt252) {
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.creator_alias.is_non_zero(), 'NOT_ALIAS_BOUNTY');
            self._consume_creator_inner(bounty.creator_alias, preimage);
            self._report_inner(bounty_id, submission_id, identity_to_address(bounty.creator_alias), reason, evidence);
        }

        fn resolve_report_private(ref self: ContractState, bounty_id: u64, submission_id: u64, should_slash: bool, preimage: felt252) {
            let report = self.reports.read((bounty_id, submission_id));
            assert(report.reporter.is_non_zero(), 'REPORT_NOT_FOUND');
            assert(!report.resolved, 'ALREADY_RESOLVED');
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator_alias.is_non_zero(), 'NOT_ALIAS_BOUNTY');
            let now = get_block_timestamp();
            if report.challenged {
                // Challenged alias reports resolve via owner arbitration only
                // (mirrors the legacy challenged path).
                assert(get_caller_address() == self.owner.read(), 'NOT_OWNER_FOR_CHALLENGED');
            } else {
                let is_owner = get_caller_address() == self.owner.read();
                if !is_owner {
                    self._consume_creator_inner(bounty.creator_alias, preimage);
                    assert(now > report.challenge_deadline, 'CHALLENGE_PERIOD_ACTIVE');
                }
            }
            self._resolve_inner(bounty_id, submission_id, should_slash, get_caller_address());
        }

        fn verify_creator_preimage(self: @ContractState, alias: felt252, preimage: felt252) -> bool {
            self._verify_creator_inner(alias, preimage)
        }

        // Refund/value recipient: explicit payout address when bound, else the
        // legacy creator field (identical behavior for legacy bounties).
        fn get_payout_recipient(self: @ContractState, bounty_id: u64) -> ContractAddress {
            let bounty = self.bounties.read(bounty_id);
            if bounty.payout_address.is_non_zero() {
                bounty.payout_address
            } else {
                bounty.creator
            }
        }

        // Eligible = registered stake + unslashed + rep threshold + live
        // escrow. Total view (never reverts on unset anonymizer) driving the
        // "Eligible âœ“" UI state.
        fn is_identity_eligible(self: @ContractState, identity: felt252) -> bool {
            if identity.is_zero() { return false; }
            if !self.id_registered.read(identity) { return false; }
            if self.id_slashed.read(identity) { return false; }
            if self._get_identity_reputation(identity) < self.minimum_reputation.read() { return false; }
            if self._identity_escrow(identity) < self.stake_amount.read() { return false; }
            true
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
        // Shared lifecycle bodies (auth done by the calling entrypoint, so
        // legacy wallet paths and private alias paths execute identical
        // state transitions).
        fn _open_inner(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Funded, 'NOT_FUNDED');
            bounty.status = BountyStatus::Open;
            self.bounties.write(bounty_id, bounty);
            self.emit(BountyOpened { bounty_id });
        }

        fn _select_inner(ref self: ContractState, bounty_id: u64, submission_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let mut submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.status == SubmissionStatus::Pending, 'NOT_PENDING');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            bounty.winner = submission.investigator;
            bounty.winning_submission = submission_id;
            bounty.status = BountyStatus::WinnerSelected;
            self.bounties.write(bounty_id, bounty);
            self.winners.write(bounty_id, submission.investigator);
            self.winning_submissions.write(bounty_id, submission_id);
            submission.status = SubmissionStatus::Accepted;
            self.submissions.write((bounty_id, submission_id), submission);
            self.emit(WinnerSelected { bounty_id, winner: submission.investigator, submission_id });
            let winner = submission.investigator;
            if submission.identity.is_non_zero() {
                let old_rep = self._get_identity_reputation(submission.identity);
                let new_rep = if old_rep + 10 > 100 { 100 } else { old_rep + 10 };
                self.id_reputation.write(submission.identity, new_rep);
                self.emit(ReputationUpdated { account: winner, old_score: old_rep, new_score: new_rep, reason: 'WIN_SELECTED' });
            } else {
                let old_rep = self._get_reputation(winner);
                let new_rep = if old_rep + 10 > 100 { 100 } else { old_rep + 10 };
                self.reputation.write(winner, new_rep);
                self.emit(ReputationUpdated { account: winner, old_score: old_rep, new_score: new_rep, reason: 'WIN_SELECTED' });
            }
            let mut b2 = self.bounties.read(bounty_id);
            b2.status = BountyStatus::Claimable;
            self.bounties.write(bounty_id, b2);
            self.emit(Claimable { bounty_id });
        }

        fn _refund_inner(ref self: ContractState, bounty_id: u64) {
            let mut bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Created || bounty.status == BountyStatus::Funded || bounty.status == BountyStatus::Open, 'NOT_REFUNDABLE');
            assert(bounty.winner.is_zero(), 'ALREADY_HAS_WINNER');
            assert(bounty.status != BountyStatus::Paid, 'ALREADY_PAID');
            assert(bounty.status != BountyStatus::Refunded, 'ALREADY_REFUNDED');
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

        fn _report_inner(ref self: ContractState, bounty_id: u64, submission_id: u64, reporter: ContractAddress, reason: felt252, evidence: felt252) {
            assert(reason.is_non_zero(), 'REASON_ZERO');
            assert(evidence.is_non_zero(), 'EVIDENCE_ZERO');
            let bounty = self.bounties.read(bounty_id);
            assert(bounty.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(bounty.status == BountyStatus::Open, 'NOT_OPEN');
            let mut submission = self.submissions.read((bounty_id, submission_id));
            assert(submission.investigator.is_non_zero(), 'SUBMISSION_NOT_FOUND');
            assert(submission.status == SubmissionStatus::Pending, 'NOT_PENDING');
            assert(!self.has_reported.read((bounty_id, submission_id)), 'ALREADY_REPORTED');
            let now = get_block_timestamp();
            let report = Report {
                bounty_id, submission_id, reporter, reason, evidence,
                timestamp: now, challenged: false, challenge_deadline: now + CHALLENGE_PERIOD, resolved: false, slashed: false
            };
            self.reports.write((bounty_id, submission_id), report);
            self.has_reported.write((bounty_id, submission_id), true);
            submission.status = SubmissionStatus::Reported;
            self.submissions.write((bounty_id, submission_id), submission);
            self.emit(Reported { bounty_id, submission_id, reporter, reason });
        }

        fn _resolve_inner(ref self: ContractState, bounty_id: u64, submission_id: u64, should_slash: bool, resolver: ContractAddress) {
            let submission = self.submissions.read((bounty_id, submission_id));
            let investigator = submission.investigator;
            let mut report = self.reports.read((bounty_id, submission_id));
            report.resolved = true;
            report.slashed = should_slash;
            self.reports.write((bounty_id, submission_id), report);
            self.emit(ReportResolved { bounty_id, submission_id, slashed: should_slash, resolver });
            if should_slash {
                assert(!self.is_slashed_map.read(investigator), 'ALREADY_SLASHED');
                if submission.identity.is_non_zero() {
                    let identity = submission.identity;
                    assert(!self.id_slashed.read(identity), 'ALREADY_SLASHED');
                    let old_rep = self._get_identity_reputation(identity);
                    let new_rep = if old_rep >= 20 { old_rep - 20 } else { 0 };
                    self.id_reputation.write(identity, new_rep);
                    self.id_slashed.write(identity, true);
                    let pseudo = identity_to_address(identity);
                    self.emit(ReputationUpdated { account: pseudo, old_score: old_rep, new_score: new_rep, reason: 'SLASHED' });
                    let stake_amt = self._identity_escrow(identity);
                    self.emit(Slashed { bounty_id, submission_id, investigator: pseudo, slashed_amount: stake_amt });
                    let helper = self.anonymizer.read();
                    assert(helper.is_non_zero(), 'ANONYMIZER_NOT_SET');
                    IStakeHelperDispatcher { contract_address: helper }.slash_stake(identity);
                } else {
                    let old_rep = self._get_reputation(investigator);
                    let new_rep = if old_rep >= 20 { old_rep - 20 } else { 0 };
                    self.reputation.write(investigator, new_rep);
                    self.is_slashed_map.write(investigator, true);
                    self.emit(ReputationUpdated { account: investigator, old_score: old_rep, new_score: new_rep, reason: 'SLASHED' });
                    let stake_amt = self.stake_balances.read(investigator);
                    self.emit(Slashed { bounty_id, submission_id, investigator, slashed_amount: stake_amt });
                }
                let mut sub = self.submissions.read((bounty_id, submission_id));
                sub.status = SubmissionStatus::Slashed;
                self.submissions.write((bounty_id, submission_id), sub);
            } else {
                let mut sub = self.submissions.read((bounty_id, submission_id));
                sub.status = SubmissionStatus::Rejected;
                self.submissions.write((bounty_id, submission_id), sub);
            }
        }

        // Creator-alias chain auth. Consuming variant advances the tip (state
        // transitions); the view variant does not (idempotent setup ops).
        fn _consume_creator_inner(ref self: ContractState, alias: felt252, preimage: felt252) {
            assert(preimage.is_non_zero(), 'PREIMAGE_ZERO');
            assert(self.c_registered.read(alias), 'NOT_REGISTERED_CREATOR');
            let tip = self.c_tip.read(alias);
            let digest = core::poseidon::poseidon_hash_span(array![preimage].span());
            assert(digest == tip, 'BAD_PREIMAGE');
            self.c_tip.write(alias, preimage);
            self.c_owner.write(preimage, alias);
        }

        fn _verify_creator_inner(self: @ContractState, alias: felt252, preimage: felt252) -> bool {
            if preimage.is_zero() { return false; }
            if !self.c_registered.read(alias) { return false; }
            let tip = self.c_tip.read(alias);
            core::poseidon::poseidon_hash_span(array![preimage].span()) == tip
        }

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
                // That's acceptable â€” provider failure should be visible.
                dispatcher.get_score(account)
            } else {
                self.reputation.read(account)
            }
        }

        // Commitment-keyed reputation. Delegates to the external provider
        // (identity cast as address â€” the documented Ethos plug-in path:
        // a future provider attests commitments, not wallets) when one is
        // set, else the native identity map.
        fn _get_identity_reputation(self: @ContractState, identity: felt252) -> u64 {
            let provider = self.reputation_provider.read();
            if provider.is_non_zero() {
                let dispatcher = IReputationProviderDispatcher { contract_address: provider };
                dispatcher.get_score(identity_to_address(identity))
            } else {
                self.id_reputation.read(identity)
            }
        }

        // Live STRK escrow for an identity, held by the helper. Zero when the
        // helper is unset (keeps eligibility views total).
        fn _identity_escrow(self: @ContractState, identity: felt252) -> u128 {
            let helper = self.anonymizer.read();
            if helper.is_zero() {
                0
            } else {
                IStakeHelperDispatcher { contract_address: helper }.get_stake_escrow(identity)
            }
        }

        // Verify Poseidon(preimage) == stored tip and advance the tip.
        // Single-use: a revealed preimage can never authorize again.
        fn _consume_preimage_inner(ref self: ContractState, identity: felt252, preimage: felt252) {
            assert(preimage.is_non_zero(), 'PREIMAGE_ZERO');
            assert(self.id_registered.read(identity), 'NOT_REGISTERED_IDENTITY');
            let tip = self.id_tip.read(identity);
            let digest = core::poseidon::poseidon_hash_span(array![preimage].span());
            assert(digest == tip, 'BAD_PREIMAGE');
            self.id_tip.write(identity, preimage);
            self.tip_owner.write(preimage, identity);
        }

        // Resolve the owning identity from a preimage alone, then consume it.
        // Used by pool-routed entries whose calldata carries no identity.
        fn _consume_by_tip_inner(ref self: ContractState, preimage: felt252) -> felt252 {
            assert(preimage.is_non_zero(), 'PREIMAGE_ZERO');
            let tip = core::poseidon::poseidon_hash_span(array![preimage].span());
            let identity = self.tip_owner.read(tip);
            assert(identity.is_non_zero(), 'UNKNOWN_PREIMAGE');
            assert(self.id_registered.read(identity), 'NOT_REGISTERED_IDENTITY');
            // The tip must be LIVE: a stale preimage resolves to an identity
            // whose current tip has moved on, and is rejected here.
            assert(self.id_tip.read(identity) == tip, 'BAD_PREIMAGE');
            self.id_tip.write(identity, preimage);
            self.tip_owner.write(preimage, identity);
            identity
        }
    }
}
