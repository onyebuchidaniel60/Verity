# VERITY — AI AGENT WORKFLOW

## Purpose

This document defines the standard workflow AI coding agents should follow when working on VERITY.

The goal is to make the project resilient to:

- model quota exhaustion;
- model switching;
- context loss;
- interrupted sessions;
- multiple agents working sequentially;
- unexpected implementation failures.

---

# 1. Before Work

Every agent begins with:

```text
Read AGENTS.md
        ↓
Read docs/AI_HANDOFF.md
        ↓
Read VERITY_SPEC.md
        ↓
Read CLINE_IMPLEMENTATION_PLAN.md
        ↓
Inspect repository
        ↓
Inspect Git status/history
        ↓
Verify handoff
```

Do not start coding before this process is complete.

---

# 2. Before a Major Change

For substantial or risky work:

```text
Understand current state
        ↓
Update AI_HANDOFF.md
        ↓
Implement
        ↓
Test
        ↓
Verify
        ↓
Update AI_HANDOFF.md
```

The handoff should describe the state before the risky change and then the verified state afterward.

---

# 3. After a Milestone

Use:

```text
Implementation complete
        ↓
Run relevant tests
        ↓
Capture exact results
        ↓
Update AI_HANDOFF.md
        ↓
Git commit
        ↓
Update AI_HANDOFF.md with commit
```

A milestone is not complete merely because code was written.

---

# 4. When Something Fails

Do not immediately rewrite the implementation.

Use:

```text
Capture exact error
        ↓
Identify failing layer
        ↓
Inspect relevant code/configuration
        ↓
Check authoritative documentation
        ↓
Reproduce minimally
        ↓
Apply smallest justified fix
        ↓
Test
        ↓
Verify
```

If the issue remains unresolved, document it in `AI_HANDOFF.md`.

---

# 5. When the Model Is Running Out of Quota

Do not wait until the model is about to stop.

Before the context/quota becomes critical:

1. Stop beginning new risky work.
2. Update `docs/AI_HANDOFF.md`.
3. Record the current implementation state.
4. Record files changed.
5. Record tests and exact results.
6. Record unresolved errors.
7. Record the exact next command/action.
8. Save or commit verified work where appropriate.

Then switch models.

---

# 6. When a New Model Takes Over

The new model should receive a simple instruction:

> Continue VERITY from the current repository state. Read `AGENTS.md`, `docs/AI_HANDOFF.md`, `VERITY_SPEC.md`, and `CLINE_IMPLEMENTATION_PLAN.md`. Inspect Git status, recent commits, and the files referenced by the handoff. Verify the documented state against the actual repository. Do not restart or redo completed work. Continue from the exact documented next step.

The new model must verify before modifying anything.

---

# 7. Source of Truth

When information conflicts, use this order:

```text
Actual repository
      ↓
VERITY_SPEC.md
      ↓
CLINE_IMPLEMENTATION_PLAN.md
      ↓
Project documentation
      ↓
AI_HANDOFF.md
      ↓
Git history
      ↓
Agent assumptions
```

A handoff is a checkpoint, not an authority over the actual repository.

---

# 8. Completion Standard

Never report:

> "VERITY is complete."

unless the relevant requirements have actually been implemented and verified.

Use precise language:

- "Implemented but not yet tested."
- "Compiles successfully."
- "Unit tests pass."
- "Integration test passes."
- "Verified against the local/devnet environment."
- "Verified against the real STRK20 protocol."
- "Verified on mainnet."

These statements are not interchangeable.

---

# 9. Core Principle

> **The agent may disappear. The project must not lose its state.**

The repository should contain enough information for the next agent to understand:

- what VERITY is;
- what has been done;
- what has been verified;
- what has failed;
- why decisions were made;
- what must happen next.