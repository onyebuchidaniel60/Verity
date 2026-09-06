//! Milestone 2.0 — VerityAnonymizer pool-only privacy_invoke boundary tests.
//!
//! These are local Cairo unit/integration tests (snforge). They prove:
//!   1. Correct pool caller is accepted
//!   2. Non-pool caller is rejected
//!   3. Replay protection rejects same nonce twice
//!   4. Invalid operation is rejected
//!   5. Real OpenNoteDeposit type flows through the boundary (empty and non-empty)
//!
//! They are NOT Gate 2 on-chain proof — that requires a real Sepolia
//! wallet-signed STRK20 invoke (Milestone 2.1).

#[feature("deprecated-starknet-consts")]
use core::num::traits::Zero;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use verity_anonymizer::verity_anonymizer::{IVerityAnonymizerDispatcher, IVerityAnonymizerDispatcherTrait, ALLOWED_OP_PROOF};
use privacy::objects::OpenNoteDeposit;

// Helper: declare and deploy VerityAnonymizer with a given pool address.
fn deploy_anonymizer(pool: ContractAddress) -> (ContractAddress, IVerityAnonymizerDispatcher) {
    let contract_class = declare("VerityAnonymizer").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    pool.serialize(ref calldata);
    let (address, _) = contract_class.deploy(@calldata).unwrap();
    (address, IVerityAnonymizerDispatcher { contract_address: address })
}

fn pool_address() -> ContractAddress {
    // Deterministic dummy pool address for local tests.
    starknet::contract_address_const::<0x123456789012345678901234567890123456789a>()
}

fn other_address() -> ContractAddress {
    starknet::contract_address_const::<0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef>()
}

#[test]
fn test_pool_caller_accepted() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    start_cheat_caller_address(addr, pool);
    let span = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 'nonce1', 0);
    stop_cheat_caller_address(addr);
    // Empty span is valid when note_id == 0 (no open note to fill).
    assert(span.len() == 0, 'expected empty span');
}

#[test]
fn test_pool_caller_returns_deposit_when_note_id_nonzero() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    start_cheat_caller_address(addr, pool);
    let note_id = 0xabc;
    let span = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 'nonce2', note_id);
    stop_cheat_caller_address(addr);
    assert(span.len() == 1, 'expected one deposit');
    let deposit: OpenNoteDeposit = *span.at(0);
    assert(deposit.note_id == note_id, 'note_id mismatch');
    // Token should be STRK and amount 1 per Milestone 2.0 impl.
    assert(deposit.amount == 1, 'amount mismatch');
    assert(deposit.token.is_non_zero(), 'token zero');
}

#[test]
#[should_panic(expected: 'NOT_POOL')]
fn test_non_pool_caller_rejected() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    let attacker = other_address();
    start_cheat_caller_address(addr, attacker);
    // This should panic with NOT_POOL.
    let _ = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 'nonce3', 0);
    stop_cheat_caller_address(addr);
}

#[test]
#[should_panic(expected: 'REPLAY')]
fn test_replay_protection_rejects_second_use_of_nonce() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    start_cheat_caller_address(addr, pool);
    // First use succeeds.
    let _ = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 'replay_nonce', 0);
    // Second use of same nonce must revert.
    let _ = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 'replay_nonce', 0);
    stop_cheat_caller_address(addr);
}

#[test]
#[should_panic(expected: 'INVALID_OP')]
fn test_invalid_operation_rejected() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    start_cheat_caller_address(addr, pool);
    let _ = dispatcher.privacy_invoke('WRONG_OP', 'nonce4', 0);
    stop_cheat_caller_address(addr);
}

#[test]
#[should_panic(expected: 'NONCE_ZERO')]
fn test_zero_nonce_rejected() {
    let pool = pool_address();
    let (addr, dispatcher) = deploy_anonymizer(pool);
    start_cheat_caller_address(addr, pool);
    let _ = dispatcher.privacy_invoke(ALLOWED_OP_PROOF, 0, 0);
    stop_cheat_caller_address(addr);
}

#[test]
fn test_get_pool_and_version() {
    let pool = pool_address();
    let (_addr, dispatcher) = deploy_anonymizer(pool);
    let version = dispatcher.version();
    assert(version == 'VERITY_ANONYMIZER_V0', 'version mismatch');
    let got_pool = dispatcher.get_pool();
    assert(got_pool == pool, 'pool mismatch');
}

#[test]
fn test_real_open_note_deposit_type_compiles() {
    // Direct construction of the real privacy type — proves we imported the
    // genuine `privacy::objects::OpenNoteDeposit`, not a local mirror.
    let token = pool_address();
    let deposit = OpenNoteDeposit { note_id: 0x42, token, amount: 100 };
    assert(deposit.note_id == 0x42, 'note_id');
    assert(deposit.amount == 100, 'amount');
    assert(deposit.token == token, 'token');
}
