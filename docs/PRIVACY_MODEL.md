# VERITY Privacy Model

Canonical source: [`VERITY_SPEC.md`](../VERITY_SPEC.md) §20 ("Public vs Private
Information"). STRK20 is the privacy layer; VERITY does not implement its own.

## What stays public / is potentially observable (per transaction)

- The existence and timing of blockchain transactions.
- Public interaction with the STRK20 privacy pool (deposit/withdrawal edges).
- Deposit: the depositor's address, token, and amount (`Deposit(user, token, amount)`)
  — shielding is NOT private. The pool also applies mandatory deposit screening
  (FPI signs every deposit; the pool verifies the signature on-chain).
- Withdrawals: destination address and amount.
- Payout/swap amounts and timing for anonymizer-mediated DeFi actions
  (amount/timing of the public leg).
- Application-level information VERITY deliberately exposes (bounty records,
  submission hashes, votes, winner — VERITY's own on-chain data).

## What STRK20 keeps private

- In-pool private sender → receiver relationships.
- In-pool private amounts (note-to-note transfers emit only an encrypted note
  and a nullifier: no amount, no parties).
- Notes and shielded balances (UTXO model with viewing keys).
- Which deposit a withdrawal came from.
- Who performed a private in-pool operation (private txs are submitted by
  rotating shared relayers; the user's address appears nowhere in calldata).

## VERITY's honest claims

- Private *bounty funding* and *winner payout* move value through the STRK20
  pool; in-pool movement is shielded.
- Bounty *business state* is public by design (that is what makes adjudication
  auditable).
- The UI must explain this model. It must NOT claim "nobody can see anything"
  or that funding deposits are invisible.

## Rules VERITY must never break

1. `private_balance[user] += amount` (local accounting) is never STRK20.
2. A local `struct OpenNoteDeposit` mirror is never the real STRK20 type.
3. A public ERC20 transfer presented as private is a hard violation.
4. The winner's *entitlement* (CLAIMABLE) is distinct from the *actual STRK20
   private payout transaction* (SPEC §17, §19).