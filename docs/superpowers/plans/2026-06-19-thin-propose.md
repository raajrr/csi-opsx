# Thin `propose` + Review-Owned Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **NOTE:** this repo's owner executes collaboratively (they type the code; Claude guides and verifies). Do not auto-apply code via subagents unless the owner says otherwise.

**Goal:** Demote `/csi-opsx:propose` to a thin, skill-customizable OpenSpec wrapper that hands off to `/csi-opsx:review`, and make `review` the sole owner of the relocated, renamed reviewer→proposer harness.

**Architecture:** The harness engine is already command-agnostic (`runProposeHarness` never branched on command). This change moves it from `src/commands/propose/` to `src/commands/review/`, renames it `runReviewHarness`, drops the `propose` dispatch key, rewrites `propose/SKILL.md` to a thin generate-then-suggest wrapper, and (consistency rider) adds the empty `## Skills` hook to `apply`/`archive`.

**Tech Stack:** TypeScript (ESM), tsup (build), vitest (tests), commander (CLI), bundled `@fission-ai/openspec`. SKILL.md files are agent-facing markdown assets, not compiled.

**Spec:** `docs/superpowers/specs/2026-06-19-thin-propose-design.md`

## Global Constraints

- **No loop-logic changes** — the reviewer→proposer loop, `review-findings-N.md` format, resumability, round cap, and workspace write-sandbox are untouched. This is a relocation/rename + SKILL rewrite only.
- **Keep `'propose'` in `CommandName`, `COMMAND_NAMES` (`src/lib/types.ts`), and `tsup.config.ts` `COMMANDS`** — `propose` is still a user-facing command (installed SKILL + slash command). Only the *harness dispatch* drops it.
- **`review/SKILL.md` is NOT changed** — it already resolves the change, guards, checks the runner, and calls `--command=review`.
- **Do NOT collapse the `--command` option** even though it becomes single-valued — keep it for future commands and to avoid editing `review/SKILL.md`.
- **`## Skills` sections stay empty** — header + intro line only, no default skill listed.
- **Node.js 20.19+** (bundled OpenSpec floor) — already satisfied by the dev environment.

## File Structure

| Path | Responsibility after this change |
|---|---|
| `src/commands/propose/SKILL.md` | Thin wrapper: generate via `/opsx:propose`, expose empty `## Skills`, hand off to `review`. **Only file left in `propose/`.** |
| `src/commands/review/harness.ts` | (Moved) the reviewer→proposer loop engine, entry point `runReviewHarness`. |
| `src/commands/review/agents.ts` | (Moved) `ReviewerAgent` / `ProposerAgent` prompt builders. |
| `src/commands/review/__tests__/harness.test.ts` | (Moved) engine tests, referencing `runReviewHarness`. |
| `src/commands/review/SKILL.md` | Unchanged — the single harnessed command. |
| `src/commands/apply/SKILL.md` | Thin passthrough **+ new empty `## Skills` hook**. |
| `src/commands/archive/SKILL.md` | Thin passthrough **+ new empty `## Skills` hook**. |
| `src/bin/cli.ts` | `HARNESS_RUNNERS` has only `review` → `runReviewHarness`; import path + `--command` help text updated. |
| `README.md`, `.claude/CLAUDE.md` | Docs reflecting thin `propose` + review-owned harness. |

---

### Task 1: Relocate + rename the harness engine; fix CLI dispatch

This is a **pure refactor** — behavior is identical, so the existing engine test must stay **green** throughout (there is no red-first step). The whole task is atomic: the build is broken between the file move and the consumer edits, so verification runs only at the end.

**Files:**
- Move: `src/commands/propose/harness.ts` → `src/commands/review/harness.ts`
- Move: `src/commands/propose/agents.ts` → `src/commands/review/agents.ts`
- Move: `src/commands/propose/__tests__/harness.test.ts` → `src/commands/review/__tests__/harness.test.ts`
- Modify: `src/commands/review/harness.ts` (rename export)
- Modify: `src/commands/review/__tests__/harness.test.ts` (rename references)
- Modify: `src/bin/cli.ts:13`, `:62-71`, `:76`

**Interfaces:**
- Produces: `runReviewHarness(opts: HarnessOptions): Promise<void>` exported from `src/commands/review/harness.ts` (was `runProposeHarness` in `src/commands/propose/harness.ts`). `HarnessOptions` is unchanged: `{ workspace: string; changeName: string; maxRounds?: number }`.
- Consumes: nothing new. `harness.ts` keeps importing `./agents.js` and `../../lib/*` (same relative depth → no path edits inside moved files).

- [ ] **Step 1: Move the three files (git mv preserves history)**

The test's target directory doesn't exist yet, so create it first, then move all three:

```bash
mkdir -p src/commands/review/__tests__
git mv src/commands/propose/harness.ts src/commands/review/harness.ts
git mv src/commands/propose/agents.ts src/commands/review/agents.ts
git mv src/commands/propose/__tests__/harness.test.ts src/commands/review/__tests__/harness.test.ts
```

After this, `src/commands/propose/` should contain only `SKILL.md`. Confirm:

```bash
ls src/commands/propose
```
Expected: `SKILL.md` (and nothing else).

- [ ] **Step 2: Rename the export in `src/commands/review/harness.ts`**

Change the function declaration (currently around line 43):

```ts
// before
export async function runProposeHarness(opts: HarnessOptions): Promise<void> {
// after
export async function runReviewHarness(opts: HarnessOptions): Promise<void> {
```

There are no recursive self-calls, so this is the only edit in this file. The internal imports (`./agents.js`, `../../lib/...`) stay exactly as they are.

- [ ] **Step 3: Rename every reference in the moved test**

In `src/commands/review/__tests__/harness.test.ts`, replace **all** occurrences of `runProposeHarness` with `runReviewHarness` (the import on line 9, the `describe(...)` label on line 14, and the 7 call sites). The relative imports (`../harness.js`, `../../../lib/...`) stay unchanged.

```ts
// line 9 — before / after
import { runProposeHarness } from '../harness.js';
import { runReviewHarness } from '../harness.js';

// line 14 — before / after
describe('runProposeHarness', () => {
describe('runReviewHarness', () => {

// every call site — before / after
await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
await runReviewHarness({ workspace: projectRoot, changeName: CHANGE });
```

- [ ] **Step 4: Update `src/bin/cli.ts` — import path (line 13)**

```ts
// before
import type { HarnessOptions } from "../commands/propose/harness.js";
// after
import type { HarnessOptions } from "../commands/review/harness.js";
```

- [ ] **Step 5: Update `src/bin/cli.ts` — `HARNESS_RUNNERS` (lines 62–71)**

Remove the `propose` entry entirely; keep a single `review` entry pointing at the relocated, renamed function:

```ts
// before
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    },
    review: async (opts) => {
        const {runProposeHarness} = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    }
};

// after
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    review: async (opts) => {
        const { runReviewHarness } = await import('../commands/review/harness.js');
        await runReviewHarness(opts);
    }
};
```

- [ ] **Step 6: Update `src/bin/cli.ts` — `--command` help text (line 76)**

```ts
// before
.requiredOption('--command <name>', 'command to run (propose | review)')
// after
.requiredOption('--command <name>', 'command to run (review)')
```

- [ ] **Step 7: Typecheck (catches any missed reference or stale path)**

```bash
npm run typecheck
```
Expected: exits 0, no errors. (A missed `runProposeHarness` or a stale `propose/harness.js` import would surface here.)

- [ ] **Step 8: Run the relocated engine test**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts
```
Expected: PASS (all cases green — behavior is unchanged by the move/rename).

- [ ] **Step 9: Run the full suite (no regression)**

```bash
npm test
```
Expected: all tests pass. `install.test.ts` / `adapters.test.ts` use explicit per-command fixtures and don't assert harness wiring, so they're unaffected.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: relocate review harness to review/ and rename runReviewHarness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Slim `propose/SKILL.md` to a thin wrapper

**Files:**
- Modify (full rewrite): `src/commands/propose/SKILL.md`

**Interfaces:** none (agent-facing markdown). Removes the SKILL's call to `csi-opsx run --command=propose` — which is why Task 1's removal of that dispatch key leaves no orphaned caller.

- [ ] **Step 1: Replace the entire contents of `src/commands/propose/SKILL.md`**

Mirror the shape of `explore/SKILL.md` (behavior → `## Skills` → handoff). New full content:

```markdown
# csi-opsx Propose

## Propose Behavior

Follow `/opsx:propose` behavior exactly to generate the initial artifacts
(`proposal.md`, `design.md`, `tasks.md`, and any spec files).

## Skills
Load and follow these skills if relevant to the work:

## Session End

When the artifacts are generated, surface the change name you just created
(you already know it from the `/opsx:propose` run — no lookup needed) and
suggest the review step:

> "Artifacts generated for `<name>`. Ready to review? Run
> `/csi-opsx:review <name>` to run the automated reviewer→proposer loop."
```

This deletes the old Step 2 (runner detection, ~55 lines) and Step 3 (harness invocation, change-name cascade, empty-guard, `--max-rounds` integer arg).

- [ ] **Step 2: Verify the file by reading it**

Read `src/commands/propose/SKILL.md` and confirm: (a) no runner-detection block, (b) no `csi-opsx run --command=...` invocation, (c) a `## Skills` section with no bullets, (d) the `review` handoff message present.

- [ ] **Step 3: Build to confirm the asset still copies**

```bash
npm run build
```
Expected: exits 0; `tsup`'s `onSuccess` hook copies `src/commands/propose/SKILL.md` → `dist/commands/propose/SKILL.md` without error.

- [ ] **Step 4: Commit**

```bash
git add src/commands/propose/SKILL.md
git commit -m "refactor: make csi-opsx propose a thin wrapper that hands off to review

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add the empty `## Skills` hook to `apply` and `archive`

**Files:**
- Modify: `src/commands/apply/SKILL.md`
- Modify: `src/commands/archive/SKILL.md`

**Interfaces:** none. Pure consistency rider so all four thin commands expose the hook (`explore` already does).

- [ ] **Step 1: Replace `src/commands/apply/SKILL.md` contents**

```markdown
# csi-opsx Apply

Follow `/opsx:apply` behavior exactly.

## Skills
Load and follow these skills if relevant to the work:
```

- [ ] **Step 2: Replace `src/commands/archive/SKILL.md` contents**

```markdown
# csi-opsx Archive

Follow `/opsx:archive` behavior exactly.

## Skills
Load and follow these skills if relevant to the work:
```

- [ ] **Step 3: Build to confirm both assets copy**

```bash
npm run build
```
Expected: exits 0; both SKILL.md files copy to `dist/commands/{apply,archive}/`.

- [ ] **Step 4: Commit**

```bash
git add src/commands/apply/SKILL.md src/commands/archive/SKILL.md
git commit -m "feat: add empty ## Skills hook to apply and archive commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Update documentation (README + CLAUDE.md)

**Files:**
- Modify: `README.md` (What it does, Prerequisites, Usage, Commands table)
- Modify: `.claude/CLAUDE.md` (Architecture intro, Propose harness loop section)

**Interfaces:** none. Doc-only; reflects the new two-step flow and review-owned harness.

- [ ] **Step 1: README — rewrite the "What it does" bullets (lines 11–19)**

```markdown
// before
- `explore`, `apply`, `archive` — thin passthroughs to OpenSpec behaviour.
- `propose` — the harnessed command. It runs an AI reviewer against your change
  artifacts (`proposal.md`, `design.md`, `tasks.md`, `specs/*/spec.md`), feeds the
  findings to an AI proposer that revises the artifacts, and re-reviews — looping until
  the reviewer reports zero issues or `--max-rounds` is reached. Each agent runs in a
  temporary workspace where the project is read-only and only the change artifacts are
  writable, so a run can never corrupt your project.
- `review` — the same reviewer→proposer loop as `propose`, run on a change whose artifacts
    already exist (no generation). For re-reviewing or resuming a change.

// after
- `explore`, `propose`, `apply`, `archive` — thin passthroughs to OpenSpec behaviour.
  `propose` generates your change artifacts (`proposal.md`, `design.md`, `tasks.md`,
  `specs/*/spec.md`) and then suggests running `review` on them.
- `review` — the harnessed command. It runs an AI reviewer against your change artifacts,
  feeds the findings to an AI proposer that revises them, and re-reviews — looping until
  the reviewer reports zero issues or `--max-rounds` is reached. Each agent runs in a
  temporary workspace where the project is read-only and only the change artifacts are
  writable, so a run can never corrupt your project.
```

- [ ] **Step 2: README — fix the Prerequisites runner note (lines 24–26)**

```markdown
// before
- **A supported AI runner** for the propose loop — currently **Claude Code** (`claude`
  on your `PATH`). Without it, `propose` still generates artifacts via OpenSpec, but the
  automated review loop is skipped.

// after
- **A supported AI runner** for the review loop — currently **Claude Code** (`claude`
  on your `PATH`). Without it, `propose` still generates artifacts via OpenSpec, but
  `review` cannot run the automated loop.
```

- [ ] **Step 3: README — rewrite the Usage section (lines 71–84)**

```markdown
// before
Inside your AI tool, drive the workflow with the slash commands. The headline one:

```
/csi-opsx:propose <change-name>
```

This generates the change artifacts (via OpenSpec's propose behaviour) and then runs the
automated review loop over `openspec/changes/<change-name>/`. Pass an integer to cap the
rounds, e.g. `/csi-opsx:propose <change-name> 3` (the default is 5).

When the loop finishes it prints a summary: the number of rounds, the issue count per
round (the convergence trace), and whether it converged or hit the round limit. The
revised artifacts and the `review-findings-N.md` files are left in your change folder for
inspection.

// after
Inside your AI tool, drive the workflow with the slash commands. The usual two steps:

```
/csi-opsx:propose <change-name>
/csi-opsx:review <change-name>
```

`propose` generates the change artifacts (via OpenSpec's propose behaviour) under
`openspec/changes/<change-name>/`, then suggests running `review`. `review` drives the
automated reviewer→proposer loop over those artifacts (see below).
```

(The convergence-summary paragraph already lives in the "Reviewing an existing change" section, so it isn't duplicated here.)

- [ ] **Step 4: README — fix the Commands table `csi-opsx run` row (line 128)**

```markdown
// before
| `csi-opsx run` | Internal — invoked by the propose skill to drive the harness. Not meant to be run by hand. |
// after
| `csi-opsx run` | Internal — invoked by the review skill to drive the harness. Not meant to be run by hand. |
```

- [ ] **Step 5: CLAUDE.md — rewrite the Architecture command summary (line 31)**

```markdown
// before
`explore`, `apply`, and `archive` are thin passthroughs to OpenSpec behavior. `propose` and `review` are the harnessed commands: each runs a reviewer→proposer loop in isolated temp workspaces until the reviewer reports zero issues. `propose` generates the artifacts first (via OpenSpec) and then loops; `review` runs the same loop on a change whose artifacts already exist (no generation).

// after
`explore`, `propose`, `apply`, and `archive` are thin passthroughs to OpenSpec behavior (each exposes a `## Skills` hook for customization). `review` is the harnessed command: it runs a reviewer→proposer loop in isolated temp workspaces until the reviewer reports zero issues. `propose` generates the artifacts (via OpenSpec) and then suggests running `review`; `review` drives the loop over a change whose artifacts already exist.
```

- [ ] **Step 6: CLAUDE.md — rewrite the "Propose harness loop" heading + intro (lines 51–53)**

```markdown
// before
### Propose harness loop

Both `propose` and `review` drive this loop through the same `runProposeHarness` function, dispatched from `HARNESS_RUNNERS` in `src/bin/cli.ts`. The only difference is upstream in the SKILL.md files: `propose` generates the artifacts first, while `review` runs the loop on artifacts that already exist.

// after
### Review harness loop

`review` drives this loop through `runReviewHarness` (`src/commands/review/harness.ts`), dispatched from `HARNESS_RUNNERS` in `src/bin/cli.ts`. `propose` no longer drives the harness — it generates artifacts and hands off to `review`, which runs the loop on artifacts that already exist.
```

- [ ] **Step 7: Verify both docs by reading the changed sections**

Read the edited regions of `README.md` and `.claude/CLAUDE.md` and confirm no remaining claim that `propose` runs the loop, and no stale `runProposeHarness` reference.

- [ ] **Step 8: Commit**

```bash
git add README.md .claude/CLAUDE.md
git commit -m "docs: thin propose + review-owned harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification

After all four tasks, run the full gate once more and confirm green:

```bash
npm run build && npm run typecheck && npm test
```
Expected: build succeeds (all SKILL.md assets copied), typecheck clean, all tests pass.

Optional manual smoke (requires `claude` on PATH and an OpenSpec project): run `/csi-opsx:propose <name>` and confirm it generates artifacts and prints the `review` handoff **without** invoking the harness; then `/csi-opsx:review <name>` runs the loop.

## Self-Review (completed by plan author)

- **Spec coverage:** thin `propose` (Task 2) ✓; harness relocate + rename (Task 1) ✓; drop `--command=propose` (Task 1) ✓; `review` unchanged (no task — by omission) ✓; `apply`/`archive` `## Skills` (Task 3) ✓; README + CLAUDE.md (Task 4) ✓; "files NOT changed" (`types.ts`, `tsup`) — correctly have no task ✓.
- **Placeholder scan:** every code/asset step shows full content; no TBD/TODO; no "handle edge cases."
- **Type consistency:** `runReviewHarness` and `HarnessOptions` named identically across Tasks 1's harness, test, and `cli.ts` edits.
