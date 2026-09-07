// VERITY private investigator identity — pure logic (no chain I/O).
// Mirrors apps/web/lib/bounty-pure.ts: unit-tested with Node's built-in
// runner (`node --test`) without a bundler.
//
// Model (docs/PRIVATE_INVESTIGATOR.md):
// - Identity = genesis tip of a Poseidon hash chain: c_0 = seed,
//   c_{k+1} = Poseidon(c_k), identity = c_64. The seed never leaves the
//   device; each submit/challenge/payout-register/unstake reveals the next
//   unrevealed preimage (single-use, consumed atomically on-chain).
// - Poseidon here is starknet.js `hash.computePoseidonHashOnElements([x])`,
//   proven equal to Cairo `poseidon_hash_span([x])` by the fund-lock parity
//   test and re-proven for chains by the vectors below (which match the
//   snforge constants in private_identity_test.cairo exactly).

import { hash, shortString } from "starknet";

export const IDENTITY_CHAIN_LEN = 64;

// Operation felts for VerityAnonymizer.privacy_invoke (short-string encoded;
// pinned by identity.regression.test.ts against encodeShortString, so a
// contract rename breaks the test instead of silently forking calldata).
export const OP_STAKE = "0x5354414b455f4944454e54495459"; // 'STAKE_IDENTITY'
export const OP_SUBMIT = "0x5355424d49545f50524956415445"; // 'SUBMIT_PRIVATE'
export const OP_REG_PAYOUT = "0x52454749535445525f5041594f5554"; // 'REGISTER_PAYOUT'
export const OP_UNSTAKE = "0x554e5354414b455f4944454e54495459"; // 'UNSTAKE_IDENTITY'

const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

/** Canonical 0x-hex felt (validates range < STARK_PRIME). */
export function toFeltHex(v: bigint | string | number): string {
  const n = BigInt(v);
  if (n < 0n || n >= STARK_PRIME) throw new Error("Value out of felt range");
  return "0x" + n.toString(16);
}

/** Normalize any felt (decimal or 0x-hex) to canonical 0x-hex. */
export function normFelt(v: string | bigint | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  try {
    return toFeltHex(BigInt(String(v).trim()));
  } catch {
    return null;
  }
}

/** One Poseidon step, matching Cairo `poseidon_hash_span([x])`. */
export function poseidon1(x: string): string {
  return toFeltHex(BigInt(hash.computePoseidonHashOnElements([x])));
}

/** c_k: Poseidon iterated k times from seed (c_0 = seed). */
export function chainAt(seedHex: string, k: number): string {
  if (!Number.isInteger(k) || k < 0 || k > IDENTITY_CHAIN_LEN) {
    throw new Error(`Chain index out of range 0..${IDENTITY_CHAIN_LEN}`);
  }
  let v = toFeltHex(BigInt(seedHex));
  for (let i = 0; i < k; i++) v = poseidon1(v);
  return v;
}

/** Genesis tip = c_64: the stable private identity commitment. */
export function genesisTip(seedHex: string): string {
  return chainAt(seedHex, IDENTITY_CHAIN_LEN);
}

/** Short display pseudonym for an identity commitment, e.g. "#A7F3". */
export function identityShortId(identityHex: string): string {
  try {
    const hex = BigInt(identityHex).toString(16).padStart(64, "0");
    return `#${hex.slice(-4).toUpperCase()}`;
  } catch {
    return "#????";
  }
}

/** New random seed (felt) for a private identity. Device-only secret. */
export function generateIdentitySeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = BigInt("0x" + Buffer.from(bytes).toString("hex")) % STARK_PRIME;
  if (v === 0n) v = 1n;
  return "0x" + v.toString(16);
}

export interface StoredIdentity {
  seed: string;
  identity: string;
  /** Next unrevealed chain index (starts at 63, decrements per use). */
  nextK: number;
  backedUp: boolean;
}

const IDENTITY_KEY = "verity_identity";

export function saveIdentity(s: StoredIdentity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(s));
  } catch {}
}

export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.seed !== "string" || typeof p?.identity !== "string") return null;
    if (!Number.isInteger(p?.nextK)) return null;
    // Integrity: identity must be the genesis of the stored seed.
    if (normFelt(p.identity)?.toLowerCase() !== genesisTip(p.seed).toLowerCase()) return null;
    return { seed: p.seed, identity: p.identity, nextK: p.nextK, backedUp: !!p.backedUp };
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {}
}

/** Consume the next preimage (advances nextK). Call ONLY after confirmation. */
export function consumePreimage(s: StoredIdentity): { preimage: string; next: StoredIdentity } {
  if (s.nextK < 0) throw new Error("Identity chain exhausted — create a new investigator identity to continue.");
  const preimage = chainAt(s.seed, s.nextK);
  const next = { ...s, nextK: s.nextK - 1 };
  saveIdentity(next);
  return { preimage, next };
}

/** Peek at the next preimage without consuming (for building calldata). */
export function peekPreimage(s: StoredIdentity): string {
  if (s.nextK < 0) throw new Error("Identity chain exhausted — create a new investigator identity to continue.");
  return chainAt(s.seed, s.nextK);
}

export function randomNonceHex(): string {
  return "0x" + Math.floor(Math.random() * 0xffffffff).toString(16);
}

export function evidenceToFelt(text: string): string {
  const t = text.trim().slice(0, 31);
  if (!t) throw new Error("Please add investigation details");
  return "0x" + Buffer.from(t).toString("hex");
}

// ---- STRK20 action builders (slot table in docs/PRIVATE_INVESTIGATOR.md) ---
// privacy_invoke(operation, bounty_id: u64, amount: u128, nonce, note_id, secret)

export interface Strk20Action {
  type: string;
  [k: string]: unknown;
}

export function buildStakeActions(opts: {
  helper: string;
  token: string;
  stakeWei: string;
  identityHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  const amountFelt = toFeltHex(BigInt(opts.stakeWei));
  const identityFelt = toFeltHex(BigInt(opts.identityHex));
  return [
    { type: "withdraw", token: opts.token, amount: amountFelt, recipient: opts.helper },
    { type: "invoke", contract: opts.helper, calldata: [OP_STAKE, "0x0", amountFelt, nonce, "0x0", identityFelt] },
  ];
}

export function buildSubmitActions(opts: {
  helper: string;
  bountyId: number;
  evidenceFelt: string;
  preimageHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    {
      type: "invoke",
      contract: opts.helper,
      calldata: [
        OP_SUBMIT,
        toFeltHex(BigInt(opts.bountyId)),
        "0x0",
        nonce,
        toFeltHex(BigInt(opts.evidenceFelt)),
        toFeltHex(BigInt(opts.preimageHex)),
      ],
    },
  ];
}

export function buildRegPayoutActions(opts: {
  helper: string;
  bountyId: number;
  payoutLockHex: string;
  preimageHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    {
      type: "invoke",
      contract: opts.helper,
      calldata: [
        OP_REG_PAYOUT,
        toFeltHex(BigInt(opts.bountyId)),
        "0x0",
        nonce,
        toFeltHex(BigInt(opts.payoutLockHex)),
        toFeltHex(BigInt(opts.preimageHex)),
      ],
    },
  ];
}

export function buildUnstakeActions(opts: {
  helper: string;
  token: string;
  selfAddress: string;
  preimageHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    { type: "transfer", token: opts.token, amount: "OPEN", recipient: opts.selfAddress },
    {
      type: "invoke",
      contract: opts.helper,
      calldata: [OP_UNSTAKE, "0x0", "0x0", nonce, "${openNoteIds[0]}", toFeltHex(BigInt(opts.preimageHex))],
    },
  ];
}

/** Verify at runtime that the pinned op constants match short-string encoding. */
export function verifyOpConstants(): Record<string, boolean> {
  const enc = (s: string) => "0x" + BigInt(shortString.encodeShortString(s)).toString(16);
  return {
    STAKE_IDENTITY: enc("STAKE_IDENTITY") === OP_STAKE.toLowerCase(),
    SUBMIT_PRIVATE: enc("SUBMIT_PRIVATE") === OP_SUBMIT.toLowerCase(),
    REGISTER_PAYOUT: enc("REGISTER_PAYOUT") === OP_REG_PAYOUT.toLowerCase(),
    UNSTAKE_IDENTITY: enc("UNSTAKE_IDENTITY") === OP_UNSTAKE.toLowerCase(),
  };
}
