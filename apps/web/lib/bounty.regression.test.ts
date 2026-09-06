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
