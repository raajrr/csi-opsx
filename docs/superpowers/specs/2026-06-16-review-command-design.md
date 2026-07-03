# csi-opsx Review Command Design Spec

**Date:** 2026-06-16  
**Status:** Implemented (shipped June 2026; the harness entry point it reuses was later renamed `runReviewHarness` and moved under `src/commands/review/` — see `2026-06-19-thin-propose-design.md`)  

---

## Overview

`/csi-opsx:review <change-name>` runs the existing reviewer→proposer loop on a change whose
artifacts **already exist**, without the artifact-generation step that `/csi-opsx:propose`
performs first. In one line: it is `propose` minus Step 1 (the `/opsx:propose` generation).

The use case is resuming or re-running the automated review on a change you already have —
artifacts generated in an earlier session, written by hand, or left behind by a `propose` run
that crashed or hit its round cap — **without** re-triggering generation and risking a clobber
of existing work.

The harness engine (`runProposeHarness`) is reused as-is apart from rewording its summary lines
(see **Exit summary wording**). Everything `propose` already
provides — resumability, convergence detection, the round cap, the workspace write-sandbox, and
the trust boundary — is inherited for free. See the [main design spec](./2026-05-18-csi-opsx-design.md)
for the engine internals; this document covers only what `review` adds.

---

## Goals

- Add a standalone command that runs the review/fix loop on an existing change.
- Reuse the existing harness engine without modifying its loop logic.
- Tell the user clearly to run `/csi-opsx:propose` first when there is nothing to review.
- Keep the change small and additive — `propose`'s only visible change is the shared summary wording.

## Non-Goals

- A review-only mode that reports findings without auto-fixing (the proposer still runs).
- Any change to artifact generation, the `review-findings-N.md` format, or the sandbox.
- Concurrency (running `review` and `propose` on the same change at once stays unsupported).

---

## Relationship to `propose`

`review` and `propose` drive the **same** harness; they differ only in the agent-facing SKILL:

| | `/csi-opsx:propose` | `/csi-opsx:review` |
|---|---|---|
| Generates artifacts (`/opsx:propose`) | Yes (SKILL Step 1) | **No** |
| Change-name resolution | explicit arg → change made this session → ask | explicit arg → ask |
| "Nothing to review" message | "nothing to review" | "run `/csi-opsx:propose <name>` first" |
| Runner check | Yes | Yes (identical) |
| Harness engine | `runProposeHarness` | `runProposeHarness` (same) |
| Resumes existing `review-findings-*.md` | Yes | Yes (inherited) |

`review` drops two branches of `propose`'s cascade: "use the change I just made this session"
(it never generates one) and the single-active-change auto-pick — when no name is given it always
asks, to avoid acting on the wrong change.

---

## Behavior — `review/SKILL.md`

The new SKILL mirrors `propose/SKILL.md` with Step 1 removed and one guard message changed:

1. **Resolve the change name:**
   - explicit `/csi-opsx:review <name>` argument, else
   - ask the user which change to review (optionally listing the folders under `openspec/changes/`).

   No auto-selection: if no name was passed, always ask — even when only one change exists. The
   "nothing to review" case (named change missing or empty) is handled by the guard in Step 2.
2. **Guard (artifacts must exist).** The resolved change folder must exist and contain at least
   one artifact (`proposal.md` / `design.md` / `tasks.md` / `specs/*/spec.md`). Otherwise stop with:
   > Nothing to review for `<name>` — run `/csi-opsx:propose <name>` first.

   Do **not** invoke the harness. (This mirrors `propose`'s existing empty-guard, with a
   message that points at `propose` instead of "nothing to review.")
3. **Runner check.** Identical to `propose` Step 2 — `review` still spawns the reviewer and
   proposer subagents, so it needs a supported runner (Claude Code today).
4. **Invoke the harness:**
   ```bash
   csi-opsx run --command=review --workspace . --change <name>
   ```
   Append `--max-rounds=<integer>` only if the user passed one; otherwise the harness default (5) applies.

Resolve and guard (Steps 1–2) run before the runner check (Step 3) on purpose: a change with
nothing to review should be reported immediately, without first probing for a runner.

The guard living in the SKILL — not the harness — is deliberate and matches the existing
pattern: the SKILL resolves and validates the change, and only invokes the harness on a change
that is known to exist with artifacts. The harness's own throw on a missing change folder
(`enumerateChangeArtifacts`, artifacts.ts:31) therefore stays an internal safety net, not the
user-facing path.

Like `propose`, `review` omits a `## Skills` section: the reviewer→proposer loop *is* its
behavior, so there is nothing to customize via the skill-attachment mechanism.

---

## Engine — reused

`HARNESS_RUNNERS['review']` points at the same `runProposeHarness` as `propose`. No new loop,
resumability, or sandbox code (only the cosmetic summary rewording in **Exit summary wording**).
The internal `run --command=review` therefore behaves
identically to `--command=propose` given the same `--change`.

---

## File-by-file changes

| File | Change | Size |
|---|---|---|
| `src/lib/types.ts` | Add `'review'` to the `CommandName` union and `COMMAND_NAMES`. Required for install **and** to let the `review:` key compile in `HARNESS_RUNNERS` (typed `Partial<Record<CommandName, …>>`). | 2 small edits |
| `tsup.config.ts` | Add `'review'` to the hardcoded `COMMANDS` array (keep in sync with `COMMAND_NAMES`) so its `SKILL.md` is copied to `dist/`. | 1 edit |
| `src/bin/cli.ts` | Add the `HARNESS_RUNNERS['review']` entry (calls `runProposeHarness`); update the `--command` help text to `propose \| review`. | ~4 lines + 1 comma + 1 cosmetic |
| `src/commands/propose/harness.ts` | Reword the two hardcoded summary strings to review-flavored static text (`"✓ Review complete"` / `"⚠ Review: …"`). No loop or parameter changes. | 2 string edits |
| `src/commands/review/SKILL.md` | **New** — the agent instructions above. The real writing work. | new file |
| `README.md` | Add `/csi-opsx:review` to the slash-command list (Setup) and a short Usage note distinguishing it from `propose`. | doc edits |

Installation is automatic: `installSkills`/`installCommands` iterate `COMMAND_NAMES`
(install.ts:13, :33), so once `'review'` is in that array the SKILL copies to
`{toolDir}/skills/csi-opsx-review/SKILL.md` and the slash command generates to
`.claude/commands/csi-opsx/review.md` → `/csi-opsx:review`, with no install-code changes.

### Verified `HARNESS_RUNNERS` diff (additive)

```ts
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    },                                    // ← add comma
    review: async (opts) => {             // ┐
        const { runProposeHarness } = await import('../commands/propose/harness.js');  // │ new
        await runProposeHarness(opts);    // │
    },                                    // ┘
};
```

The `run` action validates nothing beyond a presence lookup in this map
(`HARNESS_RUNNERS[opts.command]`, cli.ts:77), so the key's existence is what makes
`--command=review` real — there is no separate allow-list to update.

---

## Exit summary wording

The summary block is **review output**, not propose-specific output: its rounds,
issues-found-per-round, and `review-findings-*.md` history all describe the review loop, which runs
identically under both commands. So the harness's hardcoded `"✓ csi-opsx propose complete"`
(harness.ts:161) becomes a static **`"✓ Review complete"`** — correct for both commands, with no
per-command label.

The max-rounds notice (harness.ts:148, `"⚠ csi-opsx propose: reached max rounds…"`) is the same
kind of review-loop output and is reworded the same way (e.g. `"⚠ Review: reached max rounds…"`).

These are the only `harness.ts` changes in the design — two static string edits, no `commandLabel`
parameter and no new branching. They change `propose`'s output line too (shared code), which is
intended: the block describes the review either way.

---

## Testing

- The harness engine is already covered; `review` adds no loop logic to test.
- **No existing test breaks.** Neither `install.test.ts` nor `adapters.test.ts` asserts the exact
  command set (both use explicit per-command lists), so adding `'review'` to `COMMAND_NAMES` is
  safe. Confirm with `npm test`.
- *Optional parity:* extend `adapters.test.ts`'s "works for all command names" with a `'review'`
  path assertion.
- The SKILL's resolve-and-guard behavior is agent-driven (markdown), validated by inspection /
  manual run rather than unit tests, consistent with the other SKILLs.

---

## Documentation

`README.md` enumerates the slash commands (Setup) and documents `propose`'s usage. Add
`/csi-opsx:review` to that list and a short Usage note explaining it reviews an **existing** change
without regenerating artifacts — the complement to `propose`.

---

## Out of scope (YAGNI)

- Review-only / no-fix mode (decided against — the proposer runs).
- Harness loop changes (the only `harness.ts` edits are the two cosmetic summary strings above).
- Any change to `propose`'s behavior beyond the shared summary wording, the findings format, generation, or the sandbox.

---

## Open Questions

- None.

---

## Decisions

A consolidated record of the choices made while designing this command. Detail lives inline in the
sections above; this is the quick reference, including the alternatives we rejected and why.

1. **Reuse `runProposeHarness` unchanged.** `review` and `propose` run the identical engine —
   `review` only skips the generation step. *Rejected:* a separate review engine/mode; nothing
   differs at the loop level. (See **Engine — reused**.)
2. **Full reviewer→proposer loop, not review-only.** `review` auto-fixes via the proposer, exactly
   like `propose`. *Rejected:* a report-only mode (reviewer writes findings, a human fixes them) —
   extra code and a new harness path for a workflow `propose` already covers; revisit only if a
   genuine no-fix audit is ever wanted. (See **Non-Goals**.)
3. **One static "Review complete" summary, shared by both commands.** The summary block (rounds,
   issues-per-round, findings history) is intrinsically *review* output, so a single static wording
   is correct for both. *Rejected:* threading a per-command `commandLabel` parameter — it adds a
   conditional to a command-agnostic engine for no real benefit. (See **Exit summary wording**.)
4. **Distinct `--command=review`, mapped to the same harness.** Keeps the two commands cleanly
   separable and lets them diverge later. *Rejected:* having the `review` SKILL call
   `--command=propose` (review invoking "propose" is conceptually muddy). (See **Engine — reused**.)
5. **No `## Skills` section in `review/SKILL.md`.** Like `propose`, the reviewer→proposer loop *is*
   the behavior, so there is nothing to customize via the skill-attachment mechanism. (See **Behavior**.)
6. **Change resolution: explicit arg, otherwise always ask.** No single-active auto-pick:
   auto-selecting "the one change" silently does the wrong thing the moment a second change exists,
   and `review` mutates artifacts. *Rejected:* `propose`'s single-active auto-pick branch.
   (See **Relationship to `propose`**.)
7. **The "nothing to review" guard lives in the SKILL, not the harness.** The SKILL validates the
   change and points the user at `/csi-opsx:propose`; the harness's own throw stays an internal
   safety net. *Rejected:* a harness-level user-facing guard. (See **Behavior**.)
8. **Install and build auto-wire from `COMMAND_NAMES`.** Adding `'review'` to the union/array is
   enough — the generic adapter and the install loop pick it up with no `install.ts` change.
   *Rejected:* per-command install logic. (See **File-by-file changes**.)