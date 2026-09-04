//! Phase 0 foundation smoke test for the `verity_anonymizer` package.
//!
//! This is a toolchain smoke test only — it proves Scarb + Starknet Foundry
//! work end to end. It is deliberately NOT a STRK20 or privacy test and
//! nothing here is evidence of integration.

#[test]
fn foundation_assert_works() {
    assert(2 + 2 == 4, '2 + 2 should equal 4');
}