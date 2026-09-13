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
export const OP_CREATE = "0x4352454154455f424f554e5459"; // 'CREATE_BOUNTY'

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
  /** False while the staking transaction is still being confirmed: the seed
   *  is persisted BEFORE the wallet submits so a landed-but-unconfirmed stake
   *  (wallet promise lost, tab closed, slow prover) is never orphaned. The
   *  next load() that sees the chain registered flips this to true
   *  (recovery). Records written before this flag existed are treated as
   *  confirmed. Only an UNCONFIRMED record may be replaced by a new stake. */
  confirmed?: boolean;
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
    // Pre-flag records (no `confirmed` field) are confirmed stakes.
    const confirmed = p?.confirmed === undefined ? true : !!p.confirmed;
    return { seed: p.seed, identity: p.identity, nextK: p.nextK, backedUp: !!p.backedUp, confirmed };
  } catch {
    return null;
  }
}

/** Flip a pending identity to confirmed (after wallet acceptance / when a
 *  later read proves the chain registered it). Returns the updated record. */
export function markIdentityConfirmed(s: StoredIdentity): StoredIdentity {
  const next = { ...s, confirmed: true as const };
  saveIdentity(next);
  return next;
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

/** Derive the correct nextK from an on-chain tip by walking the local
 *  chain (pure; §47.11). Tip found at c_k  =>  next correct preimage is
 *  c_{k-1}  =>  nextK = k-1. Returns {found:false} when the tip is nowhere
 *  in [c_0..c_64] — i.e., a wrong-seed record that callers must NEVER
 *  silently overwrite (surface "wrong device record" instead). Stale reads
 *  cannot fake !found (every historical tip is in-walk); k=0 match means
 *  fully consumed (nextK -1, exhausted — truthful, handle as such). */
export function deriveNextKFromTip(seedHex: string, chainTipHex: string): { found: boolean; nextK: number | null } {
  try {
    const tipN = normFelt(chainTipHex);
    if (!tipN) return { found: false, nextK: null };
    const tipL = tipN.toLowerCase();
    let v = normFelt(seedHex);
    if (!v) return { found: false, nextK: null };
    for (let k = 0; k <= IDENTITY_CHAIN_LEN; k++) {
      if (v.toLowerCase() === tipL) return { found: true, nextK: k - 1 };
      v = poseidon1(v);
    }
    return { found: false, nextK: null };
  } catch {
    return { found: false, nextK: null };
  }
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

/** Dust anchor (1 wei) for the Option-A value-leg prefix (§47.7): a
 *  shielded self-transfer that gives the wallet backend a note-touching
 *  leg to assemble/prove while the helper-side invoke stays byte-identical.
 *  Pool-level only — the helper never sees this leg. Pinned by tests. */
export const DUST_TRANSFER_WEI = "0x1";

export interface Strk20Action {
  type: string;
  [k: string]: unknown;
}

/** Option-A dust anchor (§47.7): shielded 1-wei self-transfer prepended to
 *  SUBMIT / CREATE / REGISTER_PAYOUT / REFUND action lists so the wallet
 *  backend has a note-touching leg to assemble/prove. Pool-level only —
 *  the helper invoke that follows is byte-identical with or without it. */
export function buildDustAnchorAction(token: string, selfAddress: string): Strk20Action {
  return { type: "transfer", token, amount: DUST_TRANSFER_WEI, recipient: selfAddress };
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
  token: string;
  selfAddress: string;
  bountyId: number;
  evidenceFelt: string;
  preimageHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    // Option-A dust anchor (§47.7): shielded 1-wei self-transfer so the
    // wallet backend has a note-touching leg. The invoke below is
    // byte-identical to the former bare-invoke shape.
    buildDustAnchorAction(opts.token, opts.selfAddress),
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
  token: string;
  selfAddress: string;
  bountyId: number;
  payoutLockHex: string;
  preimageHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    // Option-A dust anchor (§47.8): same pattern as SUBMIT/CREATE. The
    // invoke below is byte-identical to the former bare-invoke shape.
    buildDustAnchorAction(opts.token, opts.selfAddress),
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

// ---- STRK20 request diagnostics + bare-invoke submission path -------------
// Production finding (Sepolia + Ready X): `wallet_strk20InvokeTransaction`
// with an INVOKE-ONLY action list is rejected by the wallet backend
// (`privacy.strk20Invoke`, INVALID_REQUEST_PAYLOAD), while the identical
// invoke leg paired with a value leg (withdraw/transfer) is accepted
// (fund, stake). starknet.js forwards `actions` verbatim, and every
// bare-invoke value is a valid felt, so the discriminator is the absence of
// any deposit/withdraw/transfer leg — not a malformed field. Since §47.7,
// SUBMIT and CREATE carry an Option-A dust-transfer prefix (1 wei to self,
// pool-level only; helper invoke byte-identical); REGISTER_PAYOUT gained
// the same prefix in §47.8. Only refund remains a bare invoke (deferred).
// The helpers below (a) log the EXACT request sanitized for secrets,
// (b) classify the
// 114 error across wallet error shapes, (c) map a prepared call back to
// starknet.js shape for the spec-sanctioned prepare -> addInvokeTransaction
// two-step path (`executeWithProof`), which needs NO contract change.

/** Index of the secret slot in our 6-slot privacy_invoke convention
 *  (op, bounty_id, amount, nonce, note_id, secret). Always redacted in logs:
 *  single-use preimages, fund/refund secrets, or identity/alias commitments. */
export const SECRET_CALLDATA_SLOT = 5;

/** True when `e` is a wallet/backend INVALID_REQUEST_PAYLOAD (code 114 in
 *  any `code` field, or the literal in any message/name string). Numeric 114
 *  only counts as a `code` field so hashes/counters containing 114 elsewhere
 *  can never misclassify. */
export function isInvalidRequestPayloadError(e: unknown): boolean {
  const queue: unknown[] = [e];
  const seen = new Set<unknown>();
  for (let i = 0; i < queue.length && i < 50; i++) {
    const cur = queue[i];
    if (cur === null || cur === undefined) continue;
    if (typeof cur === "string") {
      if (cur.includes("INVALID_REQUEST_PAYLOAD")) return true;
      continue;
    }
    if (typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const o = cur as Record<string, unknown>;
    if (o.code === 114 || o.code === "114") return true;
    queue.push(o.message, o.name, o.data, o.cause);
  }
  return false;
}

export interface Strk20LogItem {
  index: number;
  value: string;
  jsType: string;
  chars: number;
}

export interface Strk20LoggedAction {
  actionIndex: number;
  type: unknown;
  token?: unknown;
  amount?: unknown;
  recipient?: unknown;
  contract?: unknown;
  calldata?: Strk20LogItem[];
  extraKeys?: string[];
}

/** Sanitized 1:1 summary of the EXACT actions array about to hit the wallet:
 *  every action type/contract/calldata with per-item index, value, JS type
 *  and length. Literal "OPEN" and `${openNoteIds[N]}`/`${poolAddress}`
 *  placeholders pass through VERBATIM (never hex-normalized). Invoke
 *  calldata at SECRET_CALLDATA_SLOT is redacted (length shown for shape
 *  correlation). Seeds/keys never enter builders, so never appear here. */
export function sanitizeStrk20ActionsForLog(actions: unknown[]): Strk20LoggedAction[] {
  return (actions ?? []).map((a, actionIndex) => {
    if (typeof a !== "object" || a === null) return { actionIndex, type: typeof a };
    const o = a as Record<string, unknown>;
    const out: Strk20LoggedAction = { actionIndex, type: o.type };
    for (const k of ["token", "amount", "recipient", "contract"] as const) {
      if (o[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = o[k];
    }
    if (Array.isArray(o.calldata)) {
      out.calldata = (o.calldata as unknown[]).map((item, index) => {
        if (index === SECRET_CALLDATA_SLOT && typeof item === "string") {
          return { index, value: "<secret-redacted>", jsType: "string", chars: item.length };
        }
        const s = typeof item === "string" ? item : String(item);
        return { index, value: s, jsType: typeof item, chars: s.length };
      });
    }
    const known = new Set(["type", "token", "amount", "recipient", "contract", "calldata"]);
    out.extraKeys = Object.keys(o).filter((k) => !known.has(k));
    return out;
  });
}

/** Console.info the exact sanitized wallet request; returns the summary for
 *  tests. `extra` carries non-secret context (pool, token, versions...). */
export function logStrk20Request(
  tag: string,
  method: string,
  actions: unknown[],
  extra?: Record<string, unknown>,
): Strk20LoggedAction[] {
  const summary = sanitizeStrk20ActionsForLog(actions);
  let safe: unknown = null;
  try {
    safe = JSON.parse(JSON.stringify({ method, actionCount: summary.length, actions: summary, ...(extra ?? {}) }));
  } catch {
    safe = { method, actionCount: summary.length, note: "(unsanitizable summary)" };
  }
  console.info(`[${tag}] ${method} request`, safe);
  return summary;
}

export interface StarknetJsCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/** Map a wallet-shaped prepared call
 *  `{contract_address, entry_point, calldata}` (from
 *  `wallet_strk20PrepareInvoke`) to starknet.js shape for `executeWithProof`.
 *  Throws on malformed input BEFORE anything reaches the wallet. */
export function toStarknetCallsFromPrepared(preparedCall: unknown): StarknetJsCall[] {
  const c = preparedCall as Record<string, unknown> | null | undefined;
  if (!c || typeof c.contract_address !== "string" || typeof c.entry_point !== "string" || !Array.isArray(c.calldata)) {
    throw new Error("strk20 prepare returned a malformed call (expected {contract_address, entry_point, calldata})");
  }
  return [{
    contractAddress: c.contract_address,
    entrypoint: c.entry_point,
    calldata: (c.calldata as unknown[]).map((x) => String(x)),
  }];
}

/** Submit-gate decision from CHAIN-READ eligibility only.
 *  - 'loading': reads pending → wallet must not open.
 *  - 'eligible': private identity OR legacy stake path passes.
 *  - 'blocked': reads done, neither path passes → show stake CTA, keep
 *    Submit disabled (the contract would reject with NOT_STAKED).
 *  Never consults localStorage or popup outcomes. */
export function submitGate(opts: {
  loaded: boolean;
  privateEligible: boolean;
  legacyEligible: boolean;
}): "loading" | "eligible" | "blocked" {
  if (!opts.loaded) return "loading";
  if (opts.privateEligible || opts.legacyEligible) return "eligible";
  return "blocked";
}

/** Verify at runtime that the pinned op constants match short-string encoding. */
export function verifyOpConstants(): Record<string, boolean> {
  const enc = (s: string) => "0x" + BigInt(shortString.encodeShortString(s)).toString(16);
  return {
    STAKE_IDENTITY: enc("STAKE_IDENTITY") === OP_STAKE.toLowerCase(),
    SUBMIT_PRIVATE: enc("SUBMIT_PRIVATE") === OP_SUBMIT.toLowerCase(),
    REGISTER_PAYOUT: enc("REGISTER_PAYOUT") === OP_REG_PAYOUT.toLowerCase(),
    UNSTAKE_IDENTITY: enc("UNSTAKE_IDENTITY") === OP_UNSTAKE.toLowerCase(),
    CREATE_BOUNTY: enc("CREATE_BOUNTY") === OP_CREATE.toLowerCase(),
  };
}

// ---- Authoritative investigator-state refresh (single source of truth) ----
// fetchInvestigatorState performs the seven chain reads that determine
// private-staking eligibility. Each read is isolated: one flaky RPC call can
// no longer silently nuke the whole state (the old Promise.all + bare catch
// set identityInfo=null on ANY single failure, indistinguishable from "not
// staked"). Callers log `raw` (commitments only — seeds/preimages never leave
// the device and are never logged) to prove which case holds: chain-staked
// vs not-staked vs read-failed vs wrong-identity.

export interface InvestigatorState {
  registered: boolean;
  reputation: number;
  minRep: number;
  escrowWei: bigint;
  eligible: boolean;
  slashed: boolean;
  stakeAmountWei: bigint;
}

export interface InvestigatorStateRefresh {
  /** True only when every read succeeded and values derived cleanly. */
  ok: boolean;
  /** Derived values (null unless ok). Drives eligible UI + submit gate. */
  state: InvestigatorState | null;
  /** Per-entrypoint failure messages (empty when ok). */
  errors: Record<string, string>;
  /** Raw view results (bigint-safe via replacer when logging). */
  raw: Record<string, unknown>;
}

function boolView(r: unknown): boolean {
  const v = (r as any)?.eligible ?? (r as any)?.registered ?? (r as any)?.slashed ?? r;
  return v === true || v === 1 || v === 1n || String(v).toLowerCase() === "true";
}

function numView(r: unknown, key: string, fallback: number): number {
  const n = Number((r as any)?.[key] ?? r);
  return Number.isFinite(n) ? n : fallback;
}

function bigView(r: unknown, key: string): bigint {
  return BigInt((r as any)?.[key] ?? r);
}

/** Refresh investigator state for one identity commitment.
 *  `callFn` is Contract.call in production, a stub in tests. */
export async function fetchInvestigatorState(
  callFn: (entrypoint: string, calldata: string[]) => Promise<unknown>,
  identityHex: string,
): Promise<InvestigatorStateRefresh> {
  const idFelt = toFeltHex(BigInt(identityHex));
  const jobs: Array<[string, string[]]> = [
    ["get_identity_reputation", [idFelt]],
    ["is_identity_registered", [idFelt]],
    ["is_identity_slashed", [idFelt]],
    ["is_identity_eligible", [idFelt]],
    ["get_identity_stake", [idFelt]],
    ["get_minimum_reputation", []],
    ["get_stake_amount", []],
  ];
  const raw: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    jobs.map(async ([fn, args]) => {
      try {
        raw[fn] = await callFn(fn, args);
      } catch (e) {
        errors[fn] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  if (Object.keys(errors).length > 0) return { ok: false, state: null, errors, raw };
  try {
    const state: InvestigatorState = {
      reputation: numView(raw["get_identity_reputation"], "rep", 0),
      registered: boolView(raw["is_identity_registered"]),
      slashed: boolView(raw["is_identity_slashed"]),
      eligible: boolView(raw["is_identity_eligible"]),
      escrowWei: bigView(raw["get_identity_stake"], "amount"),
      minRep: numView(raw["get_minimum_reputation"], "min", 60),
      stakeAmountWei: bigView(raw["get_stake_amount"], "amt"),
    };
    return { ok: true, state, errors, raw };
  } catch (e) {
    return { ok: false, state: null, errors: { derive: e instanceof Error ? e.message : String(e) }, raw };
  }
}

// ---- Private creator identity (same hash-chain scheme, own namespace) -----
// Creator control auth per bounty; no reputation attached. Stored per bounty
// (`verity_creator_<id>`): { seed, alias, nextK }. The alias (genesis tip) is
// the stable pseudonym shown as "Anonymous Creator #xxxx".

export interface StoredCreator {
  seed: string;
  alias: string;
  nextK: number;
}

function creatorKey(id: number): string {
  return `verity_creator_${id}`;
}

export function saveCreator(id: number, s: StoredCreator): void {
  try {
    localStorage.setItem(creatorKey(id), JSON.stringify(s));
  } catch {}
}

export function loadCreator(id: number): StoredCreator | null {
  try {
    const raw = localStorage.getItem(creatorKey(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.seed !== "string" || typeof p?.alias !== "string") return null;
    if (!Number.isInteger(p?.nextK)) return null;
    if (normFelt(p.alias)?.toLowerCase() !== genesisTip(p.seed).toLowerCase()) return null;
    return { seed: p.seed, alias: p.alias, nextK: p.nextK };
  } catch {
    return null;
  }
}

// ---- Pending creator (§47.9): pre-broadcast persistence --------------------
// A private create is relayer-delayed: the single-shot read-back
// (count → loadBounty → alias check) can run against pre-inclusion state,
// throw a FALSE "alias mismatch", and orphan the seed (bounties #5/#6).
// The pending record is written BEFORE the wallet submits, promoted to
// `verity_creator_<id>` after alias verification, and adopted by the
// detail page when chain alias matches (same recovery shape as §44
// pending identities). One outstanding slot is enough (serial creates).
export interface PendingCreator {
  seed: string;
  alias: string;
  rewardWei: string;
  createdAt: number;
}

const PENDING_CREATOR_KEY = "verity_creator_pending";

export function savePendingCreator(s: PendingCreator): void {
  try {
    localStorage.setItem(PENDING_CREATOR_KEY, JSON.stringify(s));
  } catch {}
}

export function loadPendingCreator(): PendingCreator | null {
  try {
    const raw = localStorage.getItem(PENDING_CREATOR_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.seed !== "string" || typeof p?.alias !== "string") return null;
    if (normFelt(p.alias)?.toLowerCase() !== genesisTip(p.seed).toLowerCase()) return null;
    return { seed: p.seed, alias: p.alias, rewardWei: String(p.rewardWei ?? ""), createdAt: Number(p.createdAt ?? 0) };
  } catch {
    return null;
  }
}

export function clearPendingCreator(): void {
  try {
    localStorage.removeItem(PENDING_CREATOR_KEY);
  } catch {}
}

/** Poll `check` until true or tries exhausted (delayMs between tries).
 *  For post-tx read-after-write lag: capture count BEFORE broadcast, poll
 *  until it increments. Pure callback shape — node-testable. */
export function pollUntil(check: () => Promise<boolean>, tries = 10, delayMs = 3000): Promise<boolean> {
  return (async () => {
    for (let i = 0; i < tries; i++) {
      try {
        if (await check()) return true;
      } catch {}
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  })();
}

/** Stable, BigInt-safe digest of readable chain state for change detection
 *  (guard re-poll). Key-order stable; bigints serialized exactly. */
export function stateDigest(o: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return `bigint:${v.toString()}`;
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = norm((v as Record<string, unknown>)[k]);
      return out;
    }
    return v ?? null;
  };
  return JSON.stringify(norm(o));
}

/** Peek at the next creator preimage without consuming. */
export function peekCreatorPreimage(s: StoredCreator): string {
  if (s.nextK < 0) throw new Error("Creator chain exhausted for this bounty.");
  return chainAt(s.seed, s.nextK);
}

/** Consume the next creator preimage. Call ONLY after confirmation. */
export function consumeCreatorPreimage(s: StoredCreator): { preimage: string; next: StoredCreator } {
  if (s.nextK < 0) throw new Error("Creator chain exhausted for this bounty.");
  const preimage = chainAt(s.seed, s.nextK);
  return { preimage, next: { ...s, nextK: s.nextK - 1 } };
}

/** CREATE: dust-anchored pool-routed invoke (Option A, §47.7).
 *  privacy_invoke(CREATE_BOUNTY, bounty_id=0, amount=reward, nonce,
 *                 note_id=metadata_hash, secret=creator_alias). The invoke is
 *  byte-identical to the former bare shape; the leading dust self-transfer
 *  is pool-level only (helper never sees it). */
export function buildCreateActions(opts: {
  helper: string;
  token: string;
  selfAddress: string;
  rewardWei: string;
  metadataFelt: string;
  aliasHex: string;
  nonceHex?: string;
}): Strk20Action[] {
  const nonce = opts.nonceHex ?? randomNonceHex();
  return [
    buildDustAnchorAction(opts.token, opts.selfAddress),
    {
      type: "invoke",
      contract: opts.helper,
      calldata: [
        OP_CREATE,
        "0x0",
        toFeltHex(BigInt(opts.rewardWei)),
        nonce,
        toFeltHex(BigInt(opts.metadataFelt)),
        toFeltHex(BigInt(opts.aliasHex)),
      ],
    },
  ];
}
