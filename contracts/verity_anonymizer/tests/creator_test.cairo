//! Private creator-alias tests for VerityAnonymizer
//! (docs/PRIVATE_INVESTIGATOR.md, creator alias).
//!
//! Covers the helper side: CREATE op, set_locks preimage branch, and REFUND
//! payout-recipient routing. BM-side alias logic is covered by the
//! bounty_manager package's creator_alias_test; here the BM is a
//! shape-faithful double (CreatorMockBM) with REAL tip verification (small)
//! and backdoors for bounty setup, per the established MockBM strategy.
//!
//! Creator chain vectors: seed 0xc4e4 (same generation method as the
//! investigator vectors).

#[feature("deprecated-starknet-consts")]
use core::traits::TryInto;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use verity_anonymizer::verity_anonymizer::{
    IVerityAnonymizerDispatcher, IVerityAnonymizerDispatcherTrait, ALLOWED_OP_CREATE,
    ALLOWED_OP_FUND, ALLOWED_OP_REFUND,
};
use bounty_manager::types::{Bounty, BountyStatus};

const C_C63: felt252 = 0x63d6076df4f7002fc5ee8d5a70e4266e432a96ab397dfe6d041bf9da7f91567;
const C_ALIAS: felt252 = 0x645e7e3c50aaea87cda43b3c44431007acba5186a020738b317246f80e83d56;
const REWARD: u128 = 1000000000000000000;

fn lock_of(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array![secret].span())
}

// ---------------------------------------------------------------------------
// Doubles (own copies; funding_test owns MockBM/MockStrk).
// ---------------------------------------------------------------------------

#[starknet::interface]
trait ICreatorMockStrk<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
mod CreatorMockStrk {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl CreatorMockStrkImpl of super::ICreatorMockStrk<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.write(recipient, self.balances.read(recipient) + amount);
        }
    }
}

#[starknet::interface]
trait ICreatorMockBM<T> {
    fn fund_bounty(ref self: T, bounty_id: u64, amount: u128);
    fn refund_bounty(ref self: T, bounty_id: u64);
    fn get_bounty(self: @T, bounty_id: u64) -> Bounty;
    fn create_bounty_private(ref self: T, reward_amount: u128, metadata_hash: felt252, creator_alias: felt252) -> u64;
    fn verify_creator_preimage(self: @T, alias: felt252, preimage: felt252) -> bool;
    fn get_payout_recipient(self: @T, bounty_id: u64) -> ContractAddress;
    fn mock_bounty(ref self: T, bounty_id: u64, creator: ContractAddress, alias: felt252, payout: ContractAddress, reward: u128);
    fn last_created(self: @T) -> (u128, felt252, felt252);
}

#[starknet::contract]
mod CreatorMockBM {
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use starknet::{ContractAddress, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use bounty_manager::types::{Bounty, BountyStatus};

    #[storage]
    struct Storage {
        next_id: u64,
        bounties: Map<u64, Bounty>,
        tips: Map<felt252, felt252>,
        last_reward: u128,
        last_metadata: felt252,
        last_alias: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl CreatorMockBMImpl of super::ICreatorMockBM<ContractState> {
        fn fund_bounty(ref self: ContractState, bounty_id: u64, amount: u128) {
            let mut b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            assert(b.status == BountyStatus::Created, 'NOT_CREATED');
            assert(amount == b.reward_amount, 'AMOUNT_MISMATCH');
            b.funded_amount = amount;
            b.status = BountyStatus::Funded;
            self.bounties.write(bounty_id, b);
        }
        fn refund_bounty(ref self: ContractState, bounty_id: u64) {
            let mut b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            b.status = BountyStatus::Refunded;
            self.bounties.write(bounty_id, b);
        }
        fn get_bounty(self: @ContractState, bounty_id: u64) -> Bounty {
            let b = self.bounties.read(bounty_id);
            assert(b.creator.is_non_zero(), 'BOUNTY_NOT_FOUND');
            b
        }
        fn create_bounty_private(
            ref self: ContractState, reward_amount: u128, metadata_hash: felt252, creator_alias: felt252,
        ) -> u64 {
            assert(reward_amount.is_non_zero(), 'REWARD_ZERO');
            assert(creator_alias.is_non_zero(), 'ALIAS_ZERO');
            let bid = self.next_id.read();
            let pseudo: ContractAddress = creator_alias.try_into().unwrap();
            self.bounties.write(bid, Bounty {
                id: bid, creator: pseudo, reward_amount,
                status: BountyStatus::Created, metadata_hash,
                created_at: get_block_timestamp(), funded_amount: 0,
                winner: starknet::contract_address_const::<0x0>(), winning_submission: 0,
                creator_alias, payout_address: starknet::contract_address_const::<0x0>(),
            });
            self.tips.write(creator_alias, creator_alias);
            self.last_reward.write(reward_amount);
            self.last_metadata.write(metadata_hash);
            self.last_alias.write(creator_alias);
            self.next_id.write(bid + 1);
            bid
        }
        fn verify_creator_preimage(self: @ContractState, alias: felt252, preimage: felt252) -> bool {
            if preimage.is_zero() {
                false
            } else {
                core::poseidon::poseidon_hash_span(array![preimage].span()) == self.tips.read(alias)
            }
        }
        fn get_payout_recipient(self: @ContractState, bounty_id: u64) -> ContractAddress {
            let b = self.bounties.read(bounty_id);
            if b.payout_address.is_non_zero() { b.payout_address } else { b.creator }
        }
        fn mock_bounty(
            ref self: ContractState, bounty_id: u64, creator: ContractAddress, alias: felt252,
            payout: ContractAddress, reward: u128,
        ) {
            self.bounties.write(bounty_id, Bounty {
                id: bounty_id, creator, reward_amount: reward,
                status: BountyStatus::Created, metadata_hash: 'm',
                created_at: get_block_timestamp(), funded_amount: 0,
                winner: starknet::contract_address_const::<0x0>(), winning_submission: 0,
                creator_alias: alias, payout_address: payout,
            });
            if alias.is_non_zero() {
                self.tips.write(alias, alias);
            }
            if bounty_id >= self.next_id.read() {
                self.next_id.write(bounty_id + 1);
            }
        }
        fn last_created(self: @ContractState) -> (u128, felt252, felt252) {
            (self.last_reward.read(), self.last_metadata.read(), self.last_alias.read())
        }
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn owner() -> ContractAddress { starknet::contract_address_const::<0x100>() }
fn creator_wallet() -> ContractAddress { starknet::contract_address_const::<0x200>() }
fn stranger() -> ContractAddress { starknet::contract_address_const::<0x999>() }
fn payout_wallet() -> ContractAddress { starknet::contract_address_const::<0xabc>() }
fn pool_addr() -> ContractAddress { starknet::contract_address_const::<0x500>() }

#[derive(Drop, Copy)]
struct Ctx {
    bm: ICreatorMockBMDispatcher,
    anon: IVerityAnonymizerDispatcher,
    mock: ICreatorMockStrkDispatcher,
    bm_addr: ContractAddress,
    anon_addr: ContractAddress,
    mock_addr: ContractAddress,
}

fn setup() -> Ctx {
    let bm_class = declare("CreatorMockBM").unwrap().contract_class();
    let (bm_addr, _) = bm_class.deploy(@array![]).unwrap();
    let bm = ICreatorMockBMDispatcher { contract_address: bm_addr };
    let mock_class = declare("CreatorMockStrk").unwrap().contract_class();
    let (mock_addr, _) = mock_class.deploy(@array![]).unwrap();
    let mock = ICreatorMockStrkDispatcher { contract_address: mock_addr };
    let anon_class = declare("VerityAnonymizer").unwrap().contract_class();
    let mut anon_calldata: Array<felt252> = array![];
    pool_addr().serialize(ref anon_calldata);
    bm_addr.serialize(ref anon_calldata);
    owner().serialize(ref anon_calldata);
    mock_addr.serialize(ref anon_calldata);
    let (anon_addr, _) = anon_class.deploy(@anon_calldata).unwrap();
    let anon = IVerityAnonymizerDispatcher { contract_address: anon_addr };
    Ctx { bm, anon, mock, bm_addr, anon_addr, mock_addr }
}

// --- CREATE op ---------------------------------------------------------------

#[test]
fn test_create_op_registers_alias_bounty() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let out = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 0, REWARD, 'n-create-1', 'meta-1', C_ALIAS);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(out.is_empty(), 'create returns no notes');
    let (reward, meta, alias) = ctx.bm.last_created();
    assert(reward == REWARD, 'reward');
    assert(meta == 'meta-1', 'metadata');
    assert(alias == C_ALIAS, 'alias');
}

#[test]
#[should_panic(expected: 'BOUNTY_MUST_BE_ZERO')]
fn test_create_nonzero_bounty_slot_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 9, REWARD, 'n-x', 'm', C_ALIAS);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'AMOUNT_ZERO')]
fn test_create_zero_reward_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 0, 0, 'n-x', 'm', C_ALIAS);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'METADATA_ZERO')]
fn test_create_zero_metadata_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 0, REWARD, 'n-x', 0, C_ALIAS);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'ALIAS_ZERO')]
fn test_create_zero_alias_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 0, REWARD, 'n-x', 'm', 0);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NOT_POOL')]
fn test_create_direct_rejected() {
    let ctx = setup();
    start_cheat_caller_address(ctx.anon_addr, stranger());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_CREATE, 0, REWARD, 'n-x', 'm', C_ALIAS);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- set_locks alias branch ----------------------------------------------------

#[test]
fn test_set_locks_alias_via_stranger_with_preimage() {
    let ctx = setup();
    let pseudo: ContractAddress = C_ALIAS.try_into().unwrap();
    ctx.bm.mock_bounty(1, pseudo, C_ALIAS, payout_wallet(), REWARD);
    // A STRANGER relays: preimage knowledge replaces the caller check, so no
    // wallet is linked to the alias.
    start_cheat_caller_address(ctx.anon_addr, stranger());
    ctx.anon.set_locks(1, lock_of('fund-s'), lock_of('refund-s'), C_C63);
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.anon.has_fund_lock(1), 'fund lock');
    assert(ctx.anon.has_refund_lock(1), 'refund lock');
}

#[test]
#[should_panic(expected: 'BAD_PREIMAGE')]
fn test_set_locks_alias_wrong_preimage() {
    let ctx = setup();
    let pseudo: ContractAddress = C_ALIAS.try_into().unwrap();
    ctx.bm.mock_bounty(1, pseudo, C_ALIAS, payout_wallet(), REWARD);
    start_cheat_caller_address(ctx.anon_addr, stranger());
    ctx.anon.set_locks(1, lock_of('fund-s'), lock_of('refund-s'), 0xbadc1a1);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'PREIMAGE_ZERO')]
fn test_set_locks_alias_missing_preimage() {
    let ctx = setup();
    let pseudo: ContractAddress = C_ALIAS.try_into().unwrap();
    ctx.bm.mock_bounty(1, pseudo, C_ALIAS, payout_wallet(), REWARD);
    start_cheat_caller_address(ctx.anon_addr, stranger());
    ctx.anon.set_locks(1, lock_of('fund-s'), lock_of('refund-s'), 0);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'NOT_CREATOR')]
fn test_set_locks_legacy_stranger_rejected() {
    let ctx = setup();
    ctx.bm.mock_bounty(2, creator_wallet(), 0, starknet::contract_address_const::<0x0>(), REWARD);
    start_cheat_caller_address(ctx.anon_addr, stranger());
    ctx.anon.set_locks(2, lock_of('fund-s'), lock_of('refund-s'), 0);
    stop_cheat_caller_address(ctx.anon_addr);
}

#[test]
#[should_panic(expected: 'PREIMAGE_NOT_NEEDED')]
fn test_set_locks_legacy_with_preimage_rejected() {
    let ctx = setup();
    ctx.bm.mock_bounty(2, creator_wallet(), 0, starknet::contract_address_const::<0x0>(), REWARD);
    start_cheat_caller_address(ctx.anon_addr, creator_wallet());
    ctx.anon.set_locks(2, lock_of('fund-s'), lock_of('refund-s'), C_C63);
    stop_cheat_caller_address(ctx.anon_addr);
}

// --- REFUND recipient routing ----------------------------------------------------

#[test]
fn test_refund_routes_to_payout_not_pseudonym() {
    let ctx = setup();
    let pseudo: ContractAddress = C_ALIAS.try_into().unwrap();
    ctx.bm.mock_bounty(1, pseudo, C_ALIAS, payout_wallet(), REWARD);
    // Lock + fund through the real helper paths (alias preimage for locks).
    start_cheat_caller_address(ctx.anon_addr, stranger());
    ctx.anon.set_locks(1, lock_of('fund-s'), lock_of('refund-s'), C_C63);
    stop_cheat_caller_address(ctx.anon_addr);
    ctx.mock.mint(ctx.anon_addr, REWARD.into());
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_FUND, 1, REWARD, 'n-fund-c', 0, 'fund-s');
    stop_cheat_caller_address(ctx.anon_addr);
    // Refund: escrow must land on the payout address, NEVER the pseudonym
    // (which nobody holds a key for).
    start_cheat_caller_address(ctx.anon_addr, pool_addr());
    let _ = ctx.anon.privacy_invoke(ALLOWED_OP_REFUND, 1, REWARD, 'n-ref-c', 0, 'refund-s');
    stop_cheat_caller_address(ctx.anon_addr);
    assert(ctx.mock.balance_of(payout_wallet()) == REWARD.into(), 'payout missing');
    assert(ctx.mock.balance_of(pseudo) == 0.into(), 'pseudonym funded!');
}
