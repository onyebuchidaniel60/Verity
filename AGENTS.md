# VERITY — AI AGENT PROJECT INSTRUCTIONS

## 1\. Purpose

VERITY is developed using AI coding agents and multiple models.

Different agents may work on this repository at different times. A model may stop unexpectedly because of quota limits, context limits, connection failures, or other interruptions.

Therefore:

> \\\\\\\*\\\\\\\*Never depend on conversational memory for project continuity. The repository must contain the information required for another agent to safely continue the work.\\\\\\\*\\\\\\\*

The repository, its Git history, and its documentation are the source of truth.

\---

# 2\. Mandatory Reading Before Any Work

Before making changes, every AI coding agent MUST read:

1. `AGENTS.md`
2. `docs/AI\\\\\\\_HANDOFF.md`
3. `VERITY\\\\\\\_SPEC.md`
4. `CLINE\\\\\\\_IMPLEMENTATION\\\\\\\_PLAN.md`
5. Relevant documentation under `docs/`

If `.clinerules/` exists and the agent is Cline, its rules must also be followed.

Do not begin implementation before completing this reading.

\---

# 3\. Authority Hierarchy

Use the following hierarchy when determining what VERITY should do:

1. **Actual repository state**
2. `VERITY\\\\\\\_SPEC.md` — canonical product and technical specification
3. `CLINE\\\\\\\_IMPLEMENTATION\\\\\\\_PLAN.md` — canonical implementation and verification plan
4. Relevant project documentation under `docs/`
5. `docs/AI\\\\\\\_HANDOFF.md` — current work state
6. Git history
7. Agent assumptions

Never allow an agent assumption to override the specification or actual repository state.

If documentation conflicts with the actual code, investigate the discrepancy before changing anything.

\---

# 4\. Project Continuity

This repository may be worked on by different AI models.

A new agent MUST assume that another agent may have stopped halfway through a task.

Before continuing:

1. Read `docs/AI\\\\\\\_HANDOFF.md`.
2. Inspect `git status`.
3. Inspect recent commits.
4. Inspect the files referenced by the handoff.
5. Verify the documented state against the actual repository.
6. Determine exactly what was completed.
7. Determine exactly what remains.
8. Continue from the documented next step.

Do NOT restart the project simply because the current agent is unfamiliar with the implementation.

Do NOT redo completed work unless verification shows that the previous work is incorrect or incomplete.

\---

# 5\. Mandatory Handoff Checkpointing

`docs/AI\\\\\\\_HANDOFF.md` is a live checkpoint.

Agents MUST update it:

* before substantial implementation;
* after every major milestone;
* after significant architectural decisions;
* after discovering an important blocker;
* after significant test results;
* before a risky or multi-file change;
* after a risky or multi-file change has been verified;
* before creating a major Git commit;
* before handing work to another agent;
* whenever work may be interrupted.

The handoff must remain useful even if the current model disappears immediately afterward.

At minimum it must contain:

* current objective;
* current phase/milestone;
* current status;
* completed work;
* files changed;
* tests run;
* verification results;
* known issues;
* blockers;
* important decisions;
* exact next step.

\---

# 6\. Git Is a Checkpoint

Git commits are physical checkpoints for the implementation.

Preferred workflow:

```text
Understand
    ↓
Update AI\\\\\\\_HANDOFF.md
    ↓
Implement
    ↓
Test
    ↓
Verify
    ↓
Update AI\\\\\\\_HANDOFF.md
    ↓
Commit verified milestone
    ↓
Next milestone
```

Create meaningful commits after verified milestones.

Do not create misleading commits that claim functionality is complete when it has not been verified.

Never use Git history as a substitute for understanding the current repository state.

\---

## Git Checkpoint Rules



Git commits are mandatory verified checkpoints, not optional actions.



\### Automatic checkpoint after verified milestones



When a milestone, phase, or gate has been successfully verified:



1\. Run all required verification/tests for that milestone.

2\. Review `git status` and `git diff`.

3\. Ensure only intended project files are included.

4\. Ensure no secrets, credentials, tokens, temporary files, or unintended generated artifacts are committed.

5\. Update `docs/AI\\\\\\\_HANDOFF.md` with the completed milestone, verification evidence, current state, and next step.

6\. Create a Git commit containing the verified milestone.

7\. Record the resulting commit hash in `docs/AI\\\\\\\_HANDOFF.md`.

8\. Verify the commit with `git status` and `git log`.

9\. Only then stop at a phase/gate requiring user approval.



\### User approval and Git commits are separate



A requirement to "STOP and wait for user approval before the next phase" does NOT mean that the agent should leave the completed current phase uncommitted.



User approval is required to \*\*advance to the next phase\*\*.



User approval is NOT required to create the normal Git checkpoint for work that has already been completed and verified, unless the user has explicitly instructed otherwise.



Therefore:



\*\*Verified milestone → automatic checkpoint commit → update handoff → STOP if approval is required → wait for user approval.\*\*



Do not interpret a phase-gate STOP instruction as permission to leave verified work uncommitted.



\### Never create a false checkpoint



Never commit work merely because a milestone is declared complete.



A checkpoint commit represents work that has actually been verified. If required tests or verification have not passed, do not label the milestone as verified and do not create a "verified milestone" commit.



If a milestone is partially complete, update `docs/AI\\\\\\\_HANDOFF.md` to reflect the partial state and exact next step.



\### Commit failure



If the Git commit fails:



1\. Do not claim the milestone is fully checkpointed.

2\. Record the exact Git error in `docs/AI\\\\\\\_HANDOFF.md`.

3\. Diagnose and fix only the Git issue preventing the checkpoint.

4\. Retry the commit.

5\. Verify the resulting commit hash.

6\. Do not advance to the next phase until the checkpoint exists, unless the user explicitly instructs otherwise.

## GitHub Remote Backup Rules



After successfully creating and verifying a Git checkpoint, push the checkpoint to the configured GitHub remote.



Required sequence:



1\. Verify the local commit exists.

2\. Verify the correct GitHub remote with `git remote -v`.

3\. Push the current branch to its configured upstream remote.

4\. Verify the push succeeded.

5\. Confirm the local branch and remote branch are synchronized.

6\. Record the commit hash and push status in `docs/AI\\\_HANDOFF.md`.



The normal completed-milestone sequence is:



\*\*VERIFY → UPDATE HANDOFF → COMMIT → VERIFY COMMIT → PUSH → VERIFY PUSH → STOP/WAIT\*\*



\### Push safety



Before pushing:



\* Never force-push unless explicitly authorized.

\* Never rewrite published history merely to resolve a conflict.

\* Never push secrets, credentials, API keys, private keys, `.env` files, or other sensitive material.

\* Never push unrelated changes.

\* Verify the destination remote and branch before pushing.



If the remote branch has changes that are not present locally, do not blindly overwrite them. Inspect the divergence and determine the safest non-destructive resolution.



\### Push failure



If the commit succeeds but the push fails:



1\. Do NOT undo or discard the local commit.

2\. Record the exact push error in `docs/AI\\\_HANDOFF.md`.

3\. Diagnose the failure.

4\. Fix only the issue necessary to establish the remote backup.

5\. Retry the push.

6\. Verify the remote contains the checkpoint.

7\. Do not claim the checkpoint is remotely backed up until the push is confirmed.



If GitHub authentication or permissions prevent the push and cannot safely be resolved automatically, leave the verified local commit intact, document the exact blocker, and STOP.



\### Phase approval



Pushing the completed phase to GitHub does not constitute permission to begin the next phase.



A phase may be fully committed and pushed while the agent still waits for explicit user approval to proceed.





# 7\. Verification Rules

Compilation is not proof of functionality.

Tests are not automatically proof of real protocol integration.

A claim that something works must be supported by the appropriate evidence.

For protocol integrations, distinguish clearly between:

* compilation;
* unit tests;
* integration tests;
* local/devnet execution;
* real protocol execution;
* real testnet execution;
* real mainnet execution.

Never describe a lower level of verification as a higher one.

Never claim real STRK20 functionality based only on mocked, simulated, local accounting, or compilation behavior.

\---

# 8\. STRK20 Rules

VERITY requires genuine STRK20 integration.

Do NOT:

* create a fake STRK20 implementation;
* simulate private balances locally;
* create fake privacy accounting;
* pretend a normal public ERC20 transfer is private;
* simulate `privacy\\\\\\\_invoke`;
* recreate STRK20 protocol types locally when the actual protocol type is required;
* invent STRK20 APIs;
* claim privacy based solely on application-side obfuscation;
* substitute mock protocol behavior for real STRK20 behavior without explicitly labeling it as a test-only mock.

Use current official STRK20 documentation, examples, starter resources, SDK/API definitions, and protocol types.

Verify APIs and types before implementing against them.

Privacy claims must accurately reflect what STRK20 actually hides and what remains publicly observable.

\---

# 9\. VERITY Architecture Rules

`VERITY\\\\\\\_SPEC.md` is the canonical definition of the VERITY product.

Do not redesign the product requirements without explicit user approval.

The implementation must preserve the intended separation between:

* VERITY's bounty/entitlement logic;
* STRK20's private value movement;
* the VerityAnonymizer integration layer;
* the requester;
* investigators/verifiers;
* winner payout.

BountyManager determines application-level entitlement.

STRK20 is responsible for the private value movement.

Do not move application responsibilities into the privacy layer merely because doing so appears technically convenient.

\---

# 10\. No Speculative Engineering

When encountering an error:

1. Capture the exact error.
2. Identify which layer produced it.
3. Determine whether the error is environmental, dependency-related, protocol-related, contract-related, frontend-related, or test-related.
4. Consult authoritative documentation or working examples when appropriate.
5. Reproduce the problem minimally.
6. Make the smallest justified change.
7. Re-run the relevant verification.

Do not repeatedly make speculative changes without understanding the failure.

Do not change multiple architectural components simultaneously to "see what works."

\---

# 11\. Phase Discipline

When `CLINE\\\\\\\_IMPLEMENTATION\\\\\\\_PLAN.md` defines implementation phases and verification gates, agents MUST follow them.

Do not silently skip a phase.

Do not silently proceed beyond a STOP/VERIFY gate.

At a verification gate:

1. Perform the required verification.
2. Record exact evidence.
3. Update `docs/AI\\\\\\\_HANDOFF.md`.
4. Report the result.
5. Stop when the plan requires user approval.

\---

# 12\. File Safety

Before modifying an unfamiliar file:

* inspect it;
* understand its purpose;
* check whether it is referenced elsewhere;
* inspect relevant Git history when useful.

Do not delete, replace, or restructure existing implementation simply because it is unfamiliar.

Do not overwrite working code with a speculative rewrite.

\---

# 13\. Dependency and Version Discipline

Do not arbitrarily upgrade, downgrade, replace, or remove dependencies.

Before changing a dependency:

1. Determine why it is currently present.
2. Check compatibility with the project.
3. Check relevant official documentation.
4. Determine what code/tests depend on it.
5. Make the smallest justified change.
6. Record important decisions in `docs/AI\\\\\\\_HANDOFF.md`.

\---

# 14\. Model Switching

If a model reaches its quota or otherwise stops:

The next agent must be able to continue using:

```text
AGENTS.md
+
docs/AI\\\\\\\_HANDOFF.md
+
VERITY\\\\\\\_SPEC.md
+
CLINE\\\\\\\_IMPLEMENTATION\\\\\\\_PLAN.md
+
Git
+
actual repository state
```

The new agent MUST verify the handoff rather than blindly trusting it.

Recommended continuation instruction:

> Continue VERITY from the current repository state. Read `AGENTS.md`, `docs/AI\\\\\\\_HANDOFF.md`, `VERITY\\\\\\\_SPEC.md`, and `CLINE\\\\\\\_IMPLEMENTATION\\\\\\\_PLAN.md` first. Inspect Git status, recent commits, and the files referenced by the handoff. Verify the documented state against the actual repository. Do not restart or redo completed work. Identify the exact point where the previous agent stopped and continue from the documented next step.

\---

# 15\. Communication Rules

When reporting progress, be precise.

Distinguish between:

* implemented;
* compiled;
* tested;
* locally verified;
* protocol verified;
* mainnet verified;
* blocked;
* assumed.

Never use vague statements such as:

* "It should work."
* "The integration is basically complete."
* "STRK20 is working" when only compilation succeeded.
* "Everything is done" when required verification remains.

When blocked, report:

1. exact failure;
2. affected component;
3. evidence;
4. attempted fixes;
5. current hypothesis, clearly labeled as a hypothesis;
6. recommended next step.

\---

# 16\. Final Rule

The most important rule is:

> \\\\\\\*\\\\\\\*Do not depend on the model's memory. Make the repository remember for it.\\\\\\\*\\\\\\\*

