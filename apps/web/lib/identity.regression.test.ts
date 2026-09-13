// VERITY private-identity regression tests (`node --test`, no bundler).
// Chain vectors MUST match the snforge constants in
// contracts/bounty_manager/tests/private_identity_test.cairo exactly —
// agreement between starknet.js and Cairo core Poseidon is the parity proof.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_CHAIN_LEN,
  OP_STAKE,
  OP_SUBMIT,
  OP_REG_PAYOUT,
  OP_UNSTAKE,
  OP_CREATE,
  chainAt,
  genesisTip,
  identityShortId,
  poseidon1,
  toFeltHex,
  normFelt,
  evidenceToFelt,
  buildStakeActions,
  buildSubmitActions,
  buildRegPayoutActions,
  buildUnstakeActions,
  buildCreateActions,
  DUST_TRANSFER_WEI,
  verifyOpConstants,
  submitGate,
  fetchInvestigatorState,
  saveIdentity,
  loadIdentity,
  clearIdentity,
  markIdentityConfirmed,
  generateIdentitySeed,
  isInvalidRequestPayloadError,
  sanitizeStrk20ActionsForLog,
  toStarknetCallsFromPrepared,
  SECRET_CALLDATA_SLOT,
} from "./identity-pure.ts";

// Node has no localStorage: minimal in-memory stub so the real
// save/load functions (not mocks) are exercised for persistence.
if (typeof (globalThis as any).localStorage === "undefined") {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
  };
}

const VECTORS: Record<string, { c1: string; c2: string; c62: string; c63: string; c64: string }> = {
  "0x1234": {
    c1: "0x4e87ec1d3eba27ee5d1fb967121d0ae123b09f545e8f7cbd83f874d704659be",
    c2: "0x46ac7287dde7cb127b5e9cb59d08b3ce94b133ce16f3bcf08dc2f6370b59066",
    c62: "0x3c64e9aeac82f58159a462ecad0a11c01949c4e804431ca89347d1042b471ce",
    c63: "0x41c8133e8ee6f0d82f7debbcd48de1c322104f8f834119a65cd439ddc51265",
    c64: "0x73e2289aade4515a4f603bfb1cc407169a05d959b51f2fc22da37f044363973",
  },
  "0xabcdef123456789": {
    c1: "0x1276cdef3c9cab6498df7022e6f0e304cb1c0823ed3dfc139ac3b7e7d630425",
    c2: "0x3e02091b0811f70428a169f8a7cc7fd53e2256d36dc769fc036054329ee59e1",
    c62: "0x5c229936e539cdcba8f78ff3bfa581e090de69676767a6035f8befa4a66e521",
    c63: "0x461b08ca930e3a78e9c2648185e31b2f01c294818d16631fe3b43f0ac5c1aec",
    c64: "0x5e64767a10b2a0e8fa4a66d76a4cf0d23b846e049d17e4bf8080613ece0fb7a",
  },
  "0x1": {
    c1: "0x579e8877c7755365d5ec1ec7d3a94a457eff5d1f40482bbe9729c064cdead2",
    c2: "0x2ae73533ad99611d0dd3effb3e80bf635a5ccc825d92ce579a9f6850b4f8996",
    c62: "0x4bf6eeef5491f9c5d398e58db1457428befc21c9d6332384fa9415d881a7d95",
    c63: "0x6baa07dbdafa467377664695cd0eab76c141686b84653cb33883c00e86caa28",
    c64: "0x2f13ff6df0f3e984f8464249cd942c5eff09af420d409a9c120f6762aa8bfce",
  },
};

describe("poseidon chain vectors (match snforge constants)", () => {
  for (const [seed, v] of Object.entries(VECTORS)) {
    it(`seed ${seed}: c1/c2/c63/c64`, () => {
      assert.equal(chainAt(seed, 1).toLowerCase(), v.c1.toLowerCase());
      assert.equal(chainAt(seed, 2).toLowerCase(), v.c2.toLowerCase());
      assert.equal(chainAt(seed, 63).toLowerCase(), v.c63.toLowerCase());
      assert.equal(genesisTip(seed).toLowerCase(), v.c64.toLowerCase());
    });
  }
  it("chain advancement: H(c62) == c63, H(c63) == c64", () => {
    const v = VECTORS["0x1234"];
    assert.equal(poseidon1(v.c62).toLowerCase(), v.c63.toLowerCase());
    assert.equal(poseidon1(v.c63).toLowerCase(), v.c64.toLowerCase());
  });
  it("chain length is 64", () => {
    assert.equal(IDENTITY_CHAIN_LEN, 64);
  });
  it("out-of-range index rejected", () => {
    assert.throws(() => chainAt("0x1234", 65));
    assert.throws(() => chainAt("0x1234", -1));
  });
});

describe("operation constants match contract short-strings", () => {
  it("all five ops verified", () => {
    assert.deepEqual(verifyOpConstants(), {
      STAKE_IDENTITY: true,
      SUBMIT_PRIVATE: true,
      REGISTER_PAYOUT: true,
      UNSTAKE_IDENTITY: true,
      CREATE_BOUNTY: true,
    });
  });
});

describe("STRK20 action slot shapes", () => {
  const helper = "0x07aa";
  const token = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const stakeWei = "1000000000000000000";
  const identity = VECTORS["0x1234"].c64;

  it("STAKE: [withdraw stake→helper, invoke(STAKE, 0, amount, nonce, 0, identity)]", () => {
    const [w, inv] = buildStakeActions({ helper, token, stakeWei, identityHex: identity, nonceHex: "0x1" });
    assert.equal(w.type, "withdraw");
    assert.equal((w as any).recipient, helper);
    assert.equal((w as any).amount, "0xde0b6b3a7640000");
    const cd = (inv as any).calldata as string[];
    assert.equal((inv as any).type, "invoke");
    assert.equal(cd[0].toLowerCase(), OP_STAKE.toLowerCase());
    assert.equal(cd[1], "0x0"); // bounty slot unused
    assert.equal(cd[2], "0xde0b6b3a7640000"); // 1 STRK
    assert.equal(cd[4], "0x0"); // no note
    assert.equal(BigInt(cd[5]).toString(16), BigInt(identity).toString(16)); // identity, never a wallet
  });

  it("SUBMIT: [transfer dust→self, invoke(SUBMIT, bid, 0, nonce, evidence, preimage)]", () => {
    const [dust, inv] = buildSubmitActions({ helper, token, selfAddress: "0xabc", bountyId: 3, evidenceFelt: "0x6576", preimageHex: VECTORS["0x1234"].c63, nonceHex: "0x2" });
    assert.equal(dust.type, "transfer");
    assert.equal((dust as any).token, token);
    assert.equal((dust as any).amount, DUST_TRANSFER_WEI); // 1 wei anchor, pool-level only
    assert.equal((dust as any).recipient, "0xabc");
    const cd = (inv as any).calldata as string[];
    assert.equal(cd[0].toLowerCase(), OP_SUBMIT.toLowerCase());
    assert.equal(cd[1], "0x3");
    assert.equal(cd[2], "0x0");
    assert.equal(cd[4], "0x6576");
    assert.equal(BigInt(cd[5]).toString(16), BigInt(VECTORS["0x1234"].c63).toString(16));
  });

  it("REG_PAYOUT: [invoke(REG, bid, 0, nonce, lock, preimage)]", () => {
    const [inv] = buildRegPayoutActions({ helper, bountyId: 5, payoutLockHex: "0x9a910c4", preimageHex: VECTORS["0x1234"].c62, nonceHex: "0x3" });
    const cd = (inv as any).calldata as string[];
    assert.equal(cd[0].toLowerCase(), OP_REG_PAYOUT.toLowerCase());
    assert.equal(cd[1], "0x5");
    assert.equal(cd[4], "0x9a910c4");
  });

  it("CREATE: [transfer dust→self, invoke(CREATE, 0, reward, nonce, metadata, alias)]", () => {
    const [dust, inv] = buildCreateActions({ helper, token, selfAddress: "0xabc", rewardWei: "10000000000000000000", metadataFelt: "0x1234", aliasHex: VECTORS["0x1"].c64, nonceHex: "0x5" });
    assert.equal(dust.type, "transfer");
    assert.equal((dust as any).amount, DUST_TRANSFER_WEI);
    assert.equal((dust as any).recipient, "0xabc");
    const cd = (inv as any).calldata as string[];
    assert.equal(cd[0].toLowerCase(), OP_CREATE.toLowerCase());
    assert.equal(cd[1], "0x0");
    assert.equal(cd[2], "0x8ac7230489e80000"); // 10 STRK
    assert.equal(cd[4], "0x1234");
    assert.equal(BigInt(cd[5]).toString(16), BigInt(VECTORS["0x1"].c64).toString(16));
  });
  it("UNSTAKE: [transfer OPEN, invoke(UNSTAKE, 0, 0, nonce, openNoteIds[0], preimage)]", () => {
    const [t, inv] = buildUnstakeActions({ helper, token, selfAddress: "0xabc", preimageHex: VECTORS["0x1234"].c63, nonceHex: "0x4" });
    assert.equal((t as any).amount, "OPEN");
    const cd = (inv as any).calldata as string[];
    assert.equal(cd[0].toLowerCase(), OP_UNSTAKE.toLowerCase());
    assert.equal(cd[4], "${openNoteIds[0]}");
  });

  it("every numeric felt is 0x-hex (wallet FELT regex)", () => {
    const feltRe = /^0x(0|[1-9a-f][0-9a-f]{0,62})$/;
    const actions = [
      ...buildStakeActions({ helper, token, stakeWei, identityHex: identity }),
      ...buildSubmitActions({ helper, token, selfAddress: "0xabc", bountyId: 3, evidenceFelt: "0x6576", preimageHex: VECTORS["0x1234"].c63 }),
      ...buildRegPayoutActions({ helper, bountyId: 5, payoutLockHex: "0x9a910c4", preimageHex: VECTORS["0x1234"].c62 }),
    ];
    for (const a of actions) {
      for (const item of ((a as any).calldata ?? [(a as any).amount]) as string[]) {
        if (typeof item === "string" && (item.startsWith("${") || item === "OPEN")) continue;
        if (typeof item === "string" && item.startsWith("0x")) assert.match(item.toLowerCase(), feltRe, `bad felt ${item}`);
      }
    }
  });
});

describe("submit gate (chain reads only — never localStorage/popup)", () => {
  it("loading while reads pending — wallet must not open", () => {
    assert.equal(submitGate({ loaded: false, privateEligible: false, legacyEligible: false }), "loading");
    assert.equal(submitGate({ loaded: false, privateEligible: true, legacyEligible: true }), "loading");
  });
  it("eligible via either chain-read path", () => {
    assert.equal(submitGate({ loaded: true, privateEligible: true, legacyEligible: false }), "eligible");
    assert.equal(submitGate({ loaded: true, privateEligible: false, legacyEligible: true }), "eligible");
    assert.equal(submitGate({ loaded: true, privateEligible: true, legacyEligible: true }), "eligible");
  });
  it("blocked when reads done and neither path passes (NOT_STAKED otherwise)", () => {
    assert.equal(submitGate({ loaded: true, privateEligible: false, legacyEligible: false }), "blocked");
  });
});

describe("helpers", () => {
  it("identityShortId is a 4-hex pseudonym, not an address", () => {
    const s = identityShortId(VECTORS["0x1234"].c64);
    assert.match(s, /^#[0-9A-F]{4}$/);
    assert.ok(!s.includes("0x"));
  });
  it("toFeltHex rejects out-of-range", () => {
    assert.throws(() => toFeltHex(2n ** 251n + 17n * 2n ** 192n + 1n));
    assert.equal(toFeltHex(0), "0x0");
  });
  it("normFelt unifies decimal and hex", () => {
    assert.equal(normFelt("38919134"), "0x" + BigInt("38919134").toString(16));
    assert.equal(normFelt("0xABC"), "0xabc");
  });
  it("evidenceToFelt encodes text, rejects empty", () => {
    assert.equal(evidenceToFelt("hi"), "0x6869");
    assert.throws(() => evidenceToFelt("   "));
  });
});

describe("investigator-state refresh (stake -> eligible without reload)", () => {
  // Live Sepolia V3 fixtures (read 2026-09-07 from 0x04315e84...): a staked
  // identity reports registered=true, rep 60/60, unslashed, eligible=true,
  // 1 STRK escrow. starknet.js returns named objects with bigint numerics.
  const STAKED_VIEWS: Record<string, unknown> = {
    get_identity_reputation: { rep: 60n },
    is_identity_registered: { registered: true },
    is_identity_slashed: { slashed: false },
    is_identity_eligible: { eligible: true },
    get_identity_stake: { amount: 1000000000000000000n },
    get_minimum_reputation: { min: 60 },
    get_stake_amount: { amt: 1000000000000000000n },
  };
  const UNSTAKED_VIEWS: Record<string, unknown> = {
    get_identity_reputation: { rep: 0 },
    is_identity_registered: { registered: false },
    is_identity_slashed: { slashed: false },
    is_identity_eligible: { eligible: false },
    get_identity_stake: { amount: 0n },
    get_minimum_reputation: { min: 60 },
    get_stake_amount: { amt: 1000000000000000000n },
  };
  const mockCall = (views: Record<string, unknown>) => async (fn: string) => {
    if (!(fn in views)) throw new Error(`unexpected view ${fn}`);
    return views[fn];
  };
  const identity = VECTORS["0x1234"].c64;

  it("staked chain state derives eligible + 1 STRK + rep 60/60", async () => {
    const r = await fetchInvestigatorState(mockCall(STAKED_VIEWS), identity);
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, {});
    assert.equal(r.state?.eligible, true);
    assert.equal(r.state?.registered, true);
    assert.equal(r.state?.reputation, 60);
    assert.equal(r.state?.minRep, 60);
    assert.equal(r.state?.escrowWei, 1000000000000000000n);
    assert.equal(r.state?.slashed, false);
    // The refreshed state opens the submit gate (no reload needed).
    assert.equal(submitGate({ loaded: true, privateEligible: r.state!.eligible, legacyEligible: false }), "eligible");
  });

  it("eligibility flips false -> true after stake (pre/post refresh)", async () => {
    const before = await fetchInvestigatorState(mockCall(UNSTAKED_VIEWS), identity);
    assert.equal(before.ok, true);
    assert.equal(before.state?.eligible, false);
    assert.equal(submitGate({ loaded: true, privateEligible: before.state!.eligible, legacyEligible: false }), "blocked");
    const after = await fetchInvestigatorState(mockCall(STAKED_VIEWS), identity);
    assert.equal(after.state?.eligible, true);
    assert.equal(submitGate({ loaded: true, privateEligible: after.state!.eligible, legacyEligible: false }), "eligible");
  });

  it("one flaky read is reported, never a silent 'not staked'", async () => {
    const flaky = { ...STAKED_VIEWS };
    const r = await fetchInvestigatorState(async (fn: string) => {
      if (fn === "is_identity_eligible") throw new Error("RPC timeout");
      return (flaky as Record<string, unknown>)[fn];
    }, identity);
    assert.equal(r.ok, false);
    assert.equal(r.state, null);
    assert.match(r.errors["is_identity_eligible"] ?? "", /timeout/);
  });

  it("raw + named response shapes both parse", async () => {
    const r = await fetchInvestigatorState(async (fn: string) => {
      switch (fn) {
        case "get_identity_reputation": return 60n;
        case "is_identity_registered": return true;
        case "is_identity_slashed": return false;
        case "is_identity_eligible": return 1n;
        case "get_identity_stake": return 1000000000000000000n;
        case "get_minimum_reputation": return 60;
        case "get_stake_amount": return "1000000000000000000";
        default: throw new Error(`unexpected view ${fn}`);
      }
    }, identity);
    assert.equal(r.ok, true);
    assert.equal(r.state?.eligible, true);
    assert.equal(r.state?.reputation, 60);
  });

  it("identity persists across reload (save -> load round-trip)", () => {
    clearIdentity();
    assert.equal(loadIdentity(), null);
    const seed = generateIdentitySeed();
    const tip = genesisTip(seed);
    saveIdentity({ seed, identity: tip, nextK: 63, backedUp: false });
    const reloaded = loadIdentity(); // models a page refresh
    assert.ok(reloaded);
    assert.equal(reloaded!.identity.toLowerCase(), tip.toLowerCase());
    assert.equal(reloaded!.nextK, 63);
    clearIdentity();
  });

  it("tampered stored identity is rejected, never used for reads", () => {
    const seed = generateIdentitySeed();
    saveIdentity({ seed, identity: genesisTip(seed), nextK: 63, backedUp: false });
    const raw = (globalThis as any).localStorage.getItem("verity_identity") as string;
    const parsed = JSON.parse(raw);
    parsed.identity = "0x1234"; // attacker/corruption edit
    (globalThis as any).localStorage.setItem("verity_identity", JSON.stringify(parsed));
    assert.equal(loadIdentity(), null);
    clearIdentity();
  });

  it("pre-flag records (no confirmed field) load as confirmed", () => {
    clearIdentity();
    const seed = generateIdentitySeed();
    const tip = genesisTip(seed);
    // Old shape without `confirmed` (backward compat for existing stakes).
    (globalThis as any).localStorage.setItem("verity_identity", JSON.stringify({ seed, identity: tip, nextK: 63, backedUp: false }));
    const reloaded = loadIdentity();
    assert.ok(reloaded);
    assert.equal(reloaded!.confirmed, true);
    clearIdentity();
  });

  it("pending identity persists pre-submit and confirms without reseed", () => {
    clearIdentity();
    const seed = generateIdentitySeed();
    const tip = genesisTip(seed);
    // stakePrivate saves pending BEFORE the wallet submits.
    saveIdentity({ seed, identity: tip, nextK: 63, backedUp: false, confirmed: false });
    const pending = loadIdentity(); // models reload while the prover runs
    assert.ok(pending);
    assert.equal(pending!.confirmed, false);
    assert.equal(pending!.identity.toLowerCase(), tip.toLowerCase());
    // Wallet acceptance (or chain recovery) flips the flag; the seed never changes.
    const confirmed = markIdentityConfirmed(pending!);
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.seed, seed);
    const reloaded = loadIdentity();
    assert.ok(reloaded);
    assert.equal(reloaded!.confirmed, true);
    assert.equal(reloaded!.seed, seed);
    clearIdentity();
  });
});

describe("bare-invoke diagnostics (submit/create 114)", () => {
  it("classifies the production Strk20WalletApiError shape", () => {
    const prod = {
      name: "WalletRPCError",
      message: "An error occurred (INVALID_REQUEST_PAYLOAD)",
      data: { code: "INVALID_REQUEST_PAYLOAD", httpStatus: 500, path: "privacy.strk20Invoke", name: "Strk20WalletApiError" },
      cause: { message: "An error occurred (INVALID_REQUEST_PAYLOAD)" },
    };
    assert.equal(isInvalidRequestPayloadError(prod), true);
    assert.equal(isInvalidRequestPayloadError({ code: 114 }), true);
    assert.equal(isInvalidRequestPayloadError({ code: "114" }), true);
    assert.equal(isInvalidRequestPayloadError({ data: { cause: { code: 114 } } }), true);
  });
  it("does not misclassify other failures (no fallback prompt storms)", () => {
    assert.equal(isInvalidRequestPayloadError(new Error("USER_REFUSED")), false);
    assert.equal(isInvalidRequestPayloadError({ code: 118, message: "NOT_REGISTERED" }), false);
    assert.equal(isInvalidRequestPayloadError({ message: "INSUFFICIENT_PRIVATE_BALANCE" }), false);
    assert.equal(isInvalidRequestPayloadError(null), false);
    assert.equal(isInvalidRequestPayloadError(undefined), false);
    // A tx hash containing "114" must NOT trigger the fallback path.
    assert.equal(isInvalidRequestPayloadError({ message: "tx 0xab114cd failed" }), false);
    assert.equal(isInvalidRequestPayloadError({ block: 114 }), false);
  });
  it("sanitizer logs the exact stake request with secret slot redacted", () => {
    const stake = buildStakeActions({
      helper: "0x03602dc4",
      token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      stakeWei: "1000000000000000000",
      identityHex: VECTORS["0x1234"].c64,
      nonceHex: "0x1",
    });
    const s = sanitizeStrk20ActionsForLog(stake);
    assert.equal(s.length, 2);
    assert.equal(s[0].type, "withdraw");
    assert.equal(s[0].amount, "0xde0b6b3a7640000");
    assert.equal(s[1].type, "invoke");
    assert.equal(s[1].calldata!.length, 6);
    assert.deepEqual(s[1].calldata![0], { index: 0, value: OP_STAKE, jsType: "string", chars: OP_STAKE.length });
    // Secret slot redacted, length preserved for shape correlation.
    assert.equal(s[1].calldata![SECRET_CALLDATA_SLOT].value, "<secret-redacted>");
    assert.equal(s[1].calldata![SECRET_CALLDATA_SLOT].chars, VECTORS["0x1234"].c64.length);
    assert.deepEqual(s[1].extraKeys, []);
  });
  it("sanitizer passes OPEN and placeholders through verbatim with types", () => {
    const un = buildUnstakeActions({
      helper: "0x03602dc4",
      token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      selfAddress: "0xabc",
      preimageHex: VECTORS["0x1234"].c63,
      nonceHex: "0x4",
    });
    const s = sanitizeStrk20ActionsForLog(un);
    assert.equal(s[0].amount, "OPEN"); // never hex-normalized
    const invokeCd = s[1].calldata!;
    assert.equal(invokeCd[4].value, "${openNoteIds[0]}"); // placeholder verbatim
    assert.equal(invokeCd[4].jsType, "string");
    assert.equal(invokeCd[3].value, "0x4"); // nonce fully visible
    assert.equal(invokeCd[5].value, "<secret-redacted>"); // preimage hidden
  });
  it("sanitizer captures the dust-anchored submit shape (transfer + invoke)", () => {
    const sub = buildSubmitActions({ helper: "0x03602dc4", token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", selfAddress: "0xabc", bountyId: 3, evidenceFelt: "0x6576", preimageHex: VECTORS["0x1234"].c63, nonceHex: "0x2" });
    const s = sanitizeStrk20ActionsForLog(sub);
    assert.equal(s.length, 2); // dust transfer + invoke (Option A, §47.7)
    assert.equal(s[0].type, "transfer");
    assert.equal(s[0].amount, DUST_TRANSFER_WEI);
    assert.equal(s[1].type, "invoke");
    assert.deepEqual(s[1].calldata!.map((c) => c.value), [OP_SUBMIT, "0x3", "0x0", "0x2", "0x6576", "<secret-redacted>"]);
  });
  it("prepared-call mapping round-trips wallet shape to starknet shape", () => {
    const calls = toStarknetCallsFromPrepared({
      contract_address: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
      entry_point: "execute",
      calldata: ["0x1", "0x2"],
    });
    assert.deepEqual(calls, [{
      contractAddress: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
      entrypoint: "execute",
      calldata: ["0x1", "0x2"],
    }]);
    assert.throws(() => toStarknetCallsFromPrepared(null), /malformed call/);
    assert.throws(() => toStarknetCallsFromPrepared({ contract_address: "0x1" }), /malformed call/);
    assert.throws(() => toStarknetCallsFromPrepared({ contract_address: "0x1", entry_point: "x", calldata: "nope" }), /malformed call/);
  });
});
