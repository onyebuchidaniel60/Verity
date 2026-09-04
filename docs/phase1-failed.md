# PHASE 1 — Independent STRK20 Proof

> **Status: FAILED — NO.** Phase 1 did not complete successfully because the
> required *real* STRK20 operation could not be executed in this environment.
>
> Per `CLINE_IMPLEMENTATION_PLAN.md` §32: *"If NO → PHASE 1 FAILED. STOP. Do not
> proceed to VERITY integration."*
>
> Also per §31 (STRK20 MUST BE GENUINE) and `AGENTS.md` §8: a real wallet + real
> STRK20 pool interaction (Sepolia or mainnet) is mandatory. **A simulation or
> local accounting is explicitly not allowed** — so no fake tx hashes, balances,
> or notes are recorded here.

---

## 28.1 Phase 1 — objective (spec)

Before integrating bounty logic, prove that the selected STRK20 integration
route works **independently** of VERITY:

> wallet connection → STRK20 registration/viewing key → shield → private balance → private transfer → withdraw

## 29.1 Planned proof harness

`scripts/strk20-proof.ts`:
1. Connects a real STRK20-capable wallet (Ready/Argent X v6) via `starknet@10.5.0`
   `WalletAccountV6`.
2. Feature-detects STRK20 Wallet API via `walletV6.supportedSpecs`
   (never a balance read — `docs/STRK20_INTEGRATION.md` §7).
3. Performs a small real shield (deposit into pool `0x0254…0d91` Sepolia),
   reads the private balance via the Wallet API, performs a private transfer,
   and unshields back to the user's public address.
4. **Emits:** Sepolia tx hash(es), pool address, wallet/API response, and the
   private state returned by the real pool contract.

The harness is the *official* STRK20 "Build a private dapp" Wallet API route
(`docs/STRK20_INTEGRATION.md` §2). It contains **no mocks** and no fallback to
public ERC20 transfers labelled private.

## 29.2 Why Phase 1 could not be completed

### Environment constraints (verified 2026-09-04)

| Resource | Result | Source |
|---|---|---|
| `node` | v24.20.0 | `_envcheck.js` |
| `npm` | blocked by PowerShell execution policy (Restricted) | `npm --version` |
| `pnpm` | not installed | `where pnpm` |
| `scarb` / `snforge` | **not on PATH**; toolchain requires WSL 2 | `where scarb` |
| STRK20 wallet private key / seed | **not present** (no `.env.local`, no env var) | `_envcheck.js` |
| Funded Sepolia STRK wallet | **not available** | `_envcheck.js` |


### Conclusion

The agent cannot fabricate a funded STRK20 wallet, and the STRK20 rules forbid
presenting a public ERC20 transfer, a local balance, or a mocked
`privacy_invoke` as evidence of STRK20 integration. Therefore:

- `scripts/strk20-proof.ts` is **not authored as a runnable prover** (a script
  that would only work if a wallet existed, left unrunnable here, would mislead).
- **No fake tx hashes, balances, notes, or pool responses are recorded.**

---

## GATE 1 — STRK20 VERIFY

```text
PHASE 1 FAILED.
STOP.
```

### Required GATE 1 answers

- **STRK20 integration route:** Starknet Wallet API (`starknet@10.5.0`
  `WalletAccountV6` + `walletV6.supportedSpecs`) + STRK20 pool.
- **STRK20 pool:** Sepolia `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`;
  mainnet `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
  *(Verified against official docs in Phase 0; Phase 1 was to reconfirm **live on
  a real wallet tx**, impossible here without a wallet.)*
- **STRK20 contracts:** the live STRK20 privacy pool (no app-side STRK20 contract
  is required by VERITY).
- **Operation performed:** **None.** No real STRK20 operation was executed.
- **Transaction hash(es):** (none — no wallet available to sign)
- **Private state produced:** (none — no real op was performed)
- **How the result was verified:** environment audit (`node _envcheck.js`,
  `where scarb`, `npm --version`), review of `docs/STRK20_INTEGRATION.md` §2–§8.
- **Public information:** Sepolia public RPC is reachable (not the blocker — a
  *signing wallet* is).
- **Private information:** none available; **no private key material exists in
  this environment** and none was generated or used.
- **Mocks/simulations used:** **Zero.** None written, none run.

### Did the operation use the real STRK20 system?

```text
NO
```

There was no operation to evaluate: no wallet and no funded key were available,
so no transaction could be signed and submitted to the real STRK20 pool.

### Result

```text
PHASE 1 FAILED.
STOP.
```

Per `CLINE_IMPLEMENTATION_PLAN.md` §32: **"Do not proceed to VERITY integration."**
Re-attemptable once a real funded STRK20-capable wallet (Ready / Argent X v6,
Sepolia test STRK) is available and `npm`/`pnpm` can install `starknet@10.5.0`.

---

## What was created in this phase

Only this honest failure report (`docs/phase1-failed.md`). No production code,
no scripts, no mock artifacts, no fake evidence. The temporary `_envcheck.js`
audit will be removed before committing.

