# Cline Agent Continuity Rules

These rules apply specifically to Cline working on VERITY.

## Before Starting Work

Before making any code change:

1. Read `AGENTS.md`.
2. Read `docs/AI\\\_HANDOFF.md`.
3. Read `VERITY\\\_SPEC.md`.
4. Read `CLINE\\\_IMPLEMENTATION\\\_PLAN.md`.
5. Inspect the repository structure.
6. Run `git status`.
7. Inspect recent commits.
8. Verify the handoff against the actual repository.

Do not begin coding before completing these steps.

\---

## Handoff Discipline

`docs/AI\\\_HANDOFF.md` is a live checkpoint.

Update it:

* before substantial implementation;
* after major milestones;
* after architectural decisions;
* after important blockers;
* after significant test results;
* before risky multi-file changes;
* after verified risky changes;
* before major commits;
* before handing work to another model.

If your context or quota may become exhausted, update the handoff before continuing with additional risky work.

\---

## Phase Discipline

Follow `CLINE\\\_IMPLEMENTATION\\\_PLAN.md` exactly.

Do not:

* skip phases;
* bypass verification gates;
* proceed past a STOP gate without required approval;
* claim completion without the required evidence.

At every gate:

1. Verify.
2. Record evidence.
3. Update `docs/AI\\\_HANDOFF.md`.
4. Report.
5. STOP when instructed.

\---

## STRK20 Discipline

Use real STRK20 protocol functionality.

Never replace a required protocol operation with:

* a mock;
* fake accounting;
* simulated privacy;
* local-only balances;
* public ERC20 transfers presented as private;
* invented APIs;
* locally recreated protocol types.

If an API, type, or behavior is uncertain, verify it against authoritative STRK20 resources before implementing.

\---

## Error Discipline

When an error occurs:

1. Record the exact error.
2. Identify the failing layer.
3. Inspect relevant code and configuration.
4. Check authoritative documentation/examples.
5. Reproduce minimally.
6. Apply the smallest justified fix.
7. Test again.

Do not perform speculative chains of unrelated changes.

\---

## Git Discipline

Use Git as a checkpoint mechanism.

Before significant work:

```bash
git status
```

After verified milestones:

```bash
git status
git diff
git log -n 5 --oneline
```

Create meaningful commits only after the relevant verification succeeds.

Never claim a commit proves functionality unless the required verification actually passed.

\---
## Mandatory Git Checkpointing



Cline MUST create a Git checkpoint automatically after every successfully verified major milestone, phase, or gate.



Do not wait for the user to ask for the commit.



The required sequence is:



1\. Complete the milestone's required implementation.

2\. Run the required tests and verification.

3\. Confirm the verification actually passed.

4\. Review `git status` and `git diff`.

5\. Check for secrets, credentials, tokens, temporary files, and unintended generated artifacts.

6\. Update `docs/AI\_HANDOFF.md` with:



&#x20;  \* completed milestone

&#x20;  \* verification performed

&#x20;  \* exact results

&#x20;  \* files changed

&#x20;  \* current state

&#x20;  \* next step

7\. Create a meaningful Git commit for the verified milestone.

8\. Record the commit hash in `docs/AI\_HANDOFF.md`.

9\. Run `git status` and `git log` to verify the checkpoint.

10\. If the project plan requires stopping for user approval before the next phase, STOP after the checkpoint and wait for approval.



\### Critical distinction: checkpoint vs phase advancement



These are separate actions:



\* \*\*Creating a Git checkpoint for verified work:\*\* automatic.

\* \*\*Advancing to the next phase:\*\* requires whatever approval the project plan specifies.



For example:



> Gate 0 verification passes → commit Phase 0 → update handoff → STOP → wait for approval → Phase 1.



Never leave a successfully verified milestone uncommitted merely because the next phase requires user approval.



\### If interrupted by quota exhaustion



The agent must not rely on predicting when quota will run out.



Checkpoint verified logical units proactively.



If quota exhaustion occurs after a milestone has been verified but before the checkpoint can be created, the next model MUST inspect the repository and complete the missing checkpoint before starting new substantial work.



\### If Git commit fails



Do not silently continue.



Record the exact error, diagnose the smallest necessary fix, retry the commit, verify the commit hash, and update `docs/AI\_HANDOFF.md`.



Do not claim the milestone is checkpointed until the commit actually exists.



## Handoff Discipline

If another model will continue:

Update `docs/AI\\\_HANDOFF.md` with:

* current phase;
* current milestone;
* what was completed;
* files changed;
* commands/tests run;
* exact results;
* known issues;
* current blocker;
* exact next step;
* relevant commit hash.

The next agent must be able to continue without access to the previous conversation.

\---

## Important

The repository is the source of truth.

If the handoff says one thing but the repository says another:

**STOP and investigate the discrepancy before making changes.**

