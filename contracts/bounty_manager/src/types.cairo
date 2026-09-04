//! Bounty domain types (Phase 0 scaffolding).
//!
//! The canonical bounty lifecycle (VERITY_SPEC.md §7) is:
//!
//! CREATED → FUNDED → OPEN → VOTING → WINNER_SELECTED → CLAIMABLE → PAID
//! plus REFUNDED from CREATED/FUNDED.
//!
//! Domain types are intentionally NOT defined yet: defining product semantics
//! before the STRK20 integration route is proven would lock in unverified
//! design. They will be introduced with the core bounty mechanics in Phase 4
//! (or earlier where strictly required by a STRK20 gate).