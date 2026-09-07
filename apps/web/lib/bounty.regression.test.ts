/**
 * VERITY bounty lifecycle regression tests (Bug 1/2/3).
 *
 * Run: `node --test apps/web/lib/bounty.regression.test.ts`
 * (Node 24 type-stripping; no extra test runner dependency.)
 *
 * Covers:
 *  - 10 STRK entered -> exact on-chain wei -> exact displayed reward
 *  - CREATE != FUND (status gating)
 *  - CREATED -> not eligible for submission; FUNDED -> not open;
 *    OPEN -> investigator can submit; CREATOR -> blocked.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  humanToWei,
  weiToStr,
  formatRewardWei,
  getStatusName,
  getRewardWei,
  validateFundingAmount,
  canSubmitInvestigation,
  isCreator,
  isCreatedStatus,
  isFundedStatus,
  isOpenStatus,
  normalizeAddrLower,
  toHexAddress,
  statusMeta,
  getSubmissionStatusName,
  generateSecret,
  computeLock,
} from "./bounty-pure.ts";

describe("Bug 1 — exact reward conversion (BigInt, never Number/1e18)", () => {
  const cases: Array<[string, string, string]> = [
    ["0.1", "100000000000000000", "0.1 STRK"],
    ["1", "1000000000000000000", "1 STRK"],
    ["10", "10000000000000000000", "10 STRK"],
    ["1,550", "1550000000000000000000", "1,550 STRK"],
    ["1550", "1550000000000000000000", "1,550 STRK"],
    ["0.000001", "1000000000000", "0.000001 STRK"],
  ];
  for (const [human, wei, display] of cases) {
    it(`${human} STRK -> ${wei} -> ${display}`, () => {
      assert.equal(humanToWei(human), wei);
      assert.equal(BigInt(humanToWei(human)).toString(), wei);
      assert.equal(formatRewardWei(BigInt(wei)), display);
      assert.equal(weiToStr(BigInt(wei)), human.replace(/,/g, ""));
    });
  }

  it("10 STRK round-trips exactly (the reported bug value)", () => {
    const entered = "10";
    const stored = humanToWei(entered);
    assert.equal(stored, "10000000000000000000");
    assert.equal(formatRewardWei(BigInt(stored)), "10 STRK");
    assert.equal(weiToStr(BigInt(stored)), "10");
  });

  it("never uses floating point: 0.1 + 0.2 style values stay exact", () => {
    assert.equal(humanToWei("0.1"), "100000000000000000");
    assert.equal(humanToWei("0.2"), "200000000000000000");
    assert.equal(humanToWei("0.3"), "300000000000000000");
  });

  it("getRewardWei reads ViewModel.rewardWei (not legacy reward_amount)", () => {
    // The detail-page bug: reading bounty.reward_amount from a ViewModel
    // yields undefined -> 0 STRK. getRewardWei must prefer rewardWei.
    const vm: any = { rewardWei: 10000000000000000000n, rewardStr: "10 STRK", status: "Created" };
    assert.equal(getRewardWei(vm).toString(), "10000000000000000000");
    assert.equal(formatRewardWei(getRewardWei(vm)), "10 STRK");
    // Legacy raw shapes still work
    assert.equal(getRewardWei({ reward_amount: "5000000000000000000" }).toString(), "5000000000000000000");
    assert.equal(getRewardWei(null).toString(), "0");
  });
});

describe("Bug 1 — status parsing (CairoCustomEnum + legacy shapes)", () => {
  it("parses {variant:{Created:{}}} etc", () => {
    assert.equal(getStatusName({ variant: { Created: {} } }), "Created");
    assert.equal(getStatusName({ variant: { Funded: {} } }), "Funded");
    assert.equal(getStatusName({ variant: { Open: {} } }), "Open");
    assert.equal(getStatusName({ variant: { Paid: {} } }), "Paid");
    assert.equal(getStatusName({ variant: { Refunded: {} } }), "Refunded");
  });
  it("tolerates numeric, PascalCase, and UPPER_CASE", () => {
    assert.equal(getStatusName("0"), "Created");
    assert.equal(getStatusName("2"), "Open");
    assert.equal(getStatusName("Created"), "Created");
    assert.equal(getStatusName("CREATED"), "Created");
    assert.equal(getStatusName("open"), "Open");
    assert.equal(getStatusName("OPEN"), "Open");
    assert.equal(getStatusName("WINNER_SELECTED"), "WinnerSelected");
    assert.equal(getStatusName("VOTING"), "WinnerSelected");
    assert.equal(getStatusName(2), "Open");
  });
  it("status helpers agree across representations", () => {
    assert.ok(isCreatedStatus("Created"));
    assert.ok(isCreatedStatus("CREATED"));
    assert.ok(isCreatedStatus("0"));
    assert.ok(isFundedStatus("Funded"));
    assert.ok(isOpenStatus("Open"));
    assert.ok(isOpenStatus("2"));
    assert.ok(!isOpenStatus("Created"));
    assert.ok(!isOpenStatus("Funded"));
  });
});

describe("Bug 2 — CREATE != FUND; funding validates exact reward", () => {
  it("fresh bounty is CREATED, not FUNDED/OPEN", () => {
    const s = getStatusName({ variant: { Created: {} } });
    assert.equal(s, "Created");
    assert.ok(isCreatedStatus(s));
    assert.ok(!isFundedStatus(s));
    assert.ok(!isOpenStatus(s));
  });
  it("funding amount must equal on-chain reward exactly", () => {
    const rewardWei = 10000000000000000000n; // 10 STRK on-chain
    assert.ok(validateFundingAmount("10", rewardWei).ok);
    assert.ok(!validateFundingAmount("9", rewardWei).ok);
    assert.ok(!validateFundingAmount("10.000001", rewardWei).ok);
    assert.ok(!validateFundingAmount("", rewardWei).ok);
    const bad = validateFundingAmount("5", rewardWei);
    assert.ok(!bad.ok);
    assert.match(bad.error || "", /must match the bounty reward/);
  });
  it("funding field prefill equals exact reward (weiToStr)", () => {
    assert.equal(weiToStr(10000000000000000000n), "10");
    assert.equal(weiToStr(1500000000000000000000n), "1500");
  });
});

describe("Bug 3 — submission gating (current stage, before private staking)", () => {
  const creator = "0x03643a1e507bc076e6831b31be17f08bc9c1487583c55af313bc17958e9c4b54";
  const investigator = "0x025c19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("CREATED -> not eligible for submission", () => {
    const r = canSubmitInvestigation({ status: "Created", creator, connectedAddr: investigator, evidence: "findings" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "NOT_OPEN");
  });
  it("FUNDED -> still not OPEN", () => {
    const r = canSubmitInvestigation({ status: "Funded", creator, connectedAddr: investigator, evidence: "findings" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "NOT_OPEN");
  });
  it("OPEN -> investigator can submit", () => {
    const r = canSubmitInvestigation({ status: "Open", creator, connectedAddr: investigator, evidence: "my findings + links" });
    assert.equal(r.ok, true);
  });
  it("CREATOR -> cannot submit to own bounty (UX + on-chain)", () => {
    const r = canSubmitInvestigation({ status: "Open", creator, connectedAddr: creator, evidence: "my findings" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "IS_CREATOR");
    assert.ok(isCreator(creator, creator));
    assert.ok(!isCreator(creator, investigator));
  });
  it("empty evidence blocked, disconnected blocked", () => {
    assert.equal(canSubmitInvestigation({ status: "Open", creator, connectedAddr: investigator, evidence: "  " }).reason, "EMPTY_EVIDENCE");
    assert.equal(canSubmitInvestigation({ status: "Open", creator, connectedAddr: null, evidence: "x" }).reason, "NOT_CONNECTED");
  });
});

describe("Bug 1 (ownership) — on-chain decimal felt vs wallet 0x-hex", () => {
  // starknet.js returns ContractAddress fields as DECIMAL strings
  // (Sepolia V2 bounty #5 creator), while wallets return 0x-hex.
  const creatorDecimal = "389191342076391126826946130899986783973721101849864196251820451601448045733";
  const creatorHex = toHexAddress(creatorDecimal)!;
  const creatorHexUpper = creatorHex.toUpperCase().replace("0X", "0x");

  it("toHexAddress canonicalizes decimal felt to 0x-hex", () => {
    assert.ok(creatorHex.startsWith("0x"));
    assert.equal(creatorHex.length, 66);
    assert.equal(BigInt(creatorHex).toString(), creatorDecimal);
  });

  it("normalizeAddrLower matches decimal felt against 0x-hex wallet address", () => {
    assert.equal(normalizeAddrLower(creatorDecimal), normalizeAddrLower(creatorHex));
    assert.equal(normalizeAddrLower(creatorHexUpper), normalizeAddrLower(creatorHex));
  });

  it("isCreator true when wallet A (hex) created the bounty (decimal on-chain)", () => {
    assert.ok(isCreator(creatorDecimal, creatorHex));
    assert.ok(isCreator(creatorHex, creatorDecimal));
    assert.ok(!isCreator(creatorDecimal, "0x025c19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assert.ok(!isCreator(creatorDecimal, null));
  });

  it("creator submitting own bounty blocked even across representations", () => {
    const r = canSubmitInvestigation({ status: "Open", creator: creatorDecimal, connectedAddr: creatorHex, evidence: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "IS_CREATOR");
    const r2 = canSubmitInvestigation({ status: "Open", creator: creatorDecimal, connectedAddr: "0x025c19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", evidence: "x" });
    assert.equal(r2.ok, true);
  });
});

describe("Reported scenario — wallet A creates, views as A vs B", () => {
  // Real Sepolia V2 bounty #5 shape: creator decimal felt, status Created.
  const onChainCreator = "389191342076391126826946130899986783973721101849864196251820451601448045733";
  const walletA = toHexAddress(onChainCreator)!; // the creator's wallet
  const walletB = "0x025c19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const status = getStatusName({ variant: { Created: {} } });

  it("TEST A: creator + CREATED badge, never Funded", () => {
    assert.equal(status, "Created");
    assert.equal(statusMeta(status).label, "Created");
    assert.notEqual(statusMeta(status).label, "Funded");
  });
  it("TEST B: wallet A connected → isCreator, sees Fund privately", () => {
    assert.ok(isCreator(onChainCreator, walletA));
    const showFundForm = isCreatedStatus(status) && isCreator(onChainCreator, walletA);
    const showAwaitingMsg = isCreatedStatus(status) && !!walletA && !isCreator(onChainCreator, walletA);
    assert.ok(showFundForm);
    assert.ok(!showAwaitingMsg);
  });
  it("TEST C: wallet B connected → not creator, cannot fund, sees awaiting message", () => {
    assert.ok(!isCreator(onChainCreator, walletB));
    const showFundForm = isCreatedStatus(status) && isCreator(onChainCreator, walletB);
    const showAwaitingMsg = isCreatedStatus(status) && !!walletB && !isCreator(onChainCreator, walletB);
    assert.ok(!showFundForm);
    assert.ok(showAwaitingMsg);
  });
  it("disconnected → neither creator UI nor non-creator verdict", () => {
    assert.ok(!isCreator(onChainCreator, null));
    const showAwaitingMsg = isCreatedStatus(status) && !!null && !isCreator(onChainCreator, null);
    assert.ok(!showAwaitingMsg); // must show Connect prompt instead
  });
});

describe("Phase 3 — funding secrets (Poseidon parity with the helper)", () => {
  it("generateSecret yields unique nonzero 0x felts below the prime", () => {
    const prime = 2n ** 251n + 17n * 2n ** 192n + 1n;
    const a = generateSecret();
    const b = generateSecret();
    for (const s of [a, b]) {
      assert.match(s, /^0x[0-9a-f]+$/);
      const v = BigInt(s);
      assert.ok(v > 0n && v < prime);
    }
    assert.notEqual(a, b);
  });
  it("computeLock matches the Cairo poseidon vectors (and snforge parity)", () => {
    // Same constants asserted on-chain in test_poseidon_lock_parity_with_starknet_js.
    assert.equal(
      BigInt(computeLock("0x1234")).toString(16),
      "4e87ec1d3eba27ee5d1fb967121d0ae123b09f545e8f7cbd83f874d704659be",
    );
    assert.equal(
      BigInt(computeLock("0xabcdef123456789")).toString(16),
      "1276cdef3c9cab6498df7022e6f0e304cb1c0823ed3dfc139ac3b7e7d630425",
    );
    assert.equal(
      BigInt(computeLock("0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")).toString(16),
      "2416308baf2f5b8602265616dabf30e7d35c0a804b3c3ca8fecb0c4ae9f0d91",
    );
  });
  it("locks differ per secret (fund vs refund binding)", () => {
    assert.notEqual(computeLock(generateSecret()), computeLock(generateSecret()));
  });
});

describe("Bug 2 — badge strictly follows chain status (CREATED never Funded)", () => {
  it("every canonical status maps to its own label", () => {
    assert.equal(statusMeta("Created").label, "Created");
    assert.equal(statusMeta("Funded").label, "Funded");
    assert.equal(statusMeta("Open").label, "Open");
    assert.equal(statusMeta("WinnerSelected").label, "Winner Selected");
    assert.equal(statusMeta("Claimable").label, "Claimable");
    assert.equal(statusMeta("Paid").label, "Paid");
    assert.equal(statusMeta("Refunded").label, "Refunded");
  });
  it("CREATED representations never render Funded", () => {
    for (const s of ["Created", "CREATED", "created", "0", 0, { variant: { Created: {} } }]) {
      assert.equal(statusMeta(s as any).label, "Created");
    }
  });
  it("submission statuses parse from enum and numeric shapes", () => {
    assert.equal(getSubmissionStatusName({ variant: { Accepted: {} } }), "Accepted");
    assert.equal(getSubmissionStatusName({ variant: { Reported: {} } }), "Reported");
    assert.equal(getSubmissionStatusName({ variant: { Slashed: {} } }), "Slashed");
    assert.equal(getSubmissionStatusName("1"), "Accepted");
    assert.equal(getSubmissionStatusName("Pending"), "Pending");
  });
});
