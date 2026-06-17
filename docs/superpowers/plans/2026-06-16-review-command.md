# Review Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/csi-opsx:review <change-name>` command that runs the existing reviewer→proposer loop on a change whose artifacts already exist, without the generation step `propose` performs first.

**Architecture:** `review` reuses the `runProposeHarness` engine unchanged. It is wired up exactly like `propose`: a `CommandName` registration, a `HARNESS_RUNNERS` entry, a bundled `SKILL.md`, and an auto-generated slash command. The only engine touch is rewording the harness's exit summary (which is review output) so it reads correctly for both commands.

**Tech Stack:** TypeScript (ESM), `tsup` build, `vitest` tests, `commander` CLI. Source in `src/`, compiled to `dist/`.

**Spec:** [`docs/superpowers/specs/2026-06-16-review-command-design.md`](../specs/2026-06-16-review-command-design.md) — see its **Decisions** section for the rationale (and rejected alternatives) behind these changes.

---

## A note on testing (read first)

This feature is mostly **wiring around an already-tested engine** plus one markdown asset. That shapes how each task is verified:

- **One task is true TDD** (Task 4 — rewording the harness summary), because it changes runtime behavior that an existing test asserts.
- **The rest are verified by `npm run typecheck`, `npm run build`, and an end-to-end smoke** (Task 6), because they are typed constants, CLI wiring, and markdown — none of which this codebase unit-tests, and two of which *can't* be unit-imported (`cli.ts` calls `program.parse()` at module load; `tsup.config.ts` is build config).

Each task says exactly how it is verified and why. Do not invent unit tests for the config tasks — the engine they feed is already covered by `harness.test.ts`, and the end-to-end smoke proves the wiring.

The spec lists one *optional* parity test (a `'review'` path assertion in `adapters.test.ts`). It is intentionally skipped here: `ClaudeAdapter` builds every path by string-interpolating the command name, so the existing `explore`/`propose` assertions already cover `review`, and the assertion cannot exhibit a red phase (vitest strips types via esbuild, so it passes with or without the registration). Add it only if you want the extra regression anchor.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/lib/types.ts` | Source of truth for the command set (`CommandName` + `COMMAND_NAMES`). Drives install + makes `'review'` a legal `HARNESS_RUNNERS` key. | Modify |
| `src/bin/cli.ts` | Routes `csi-opsx run --command=<name>` to a harness runner. | Modify |
| `src/commands/review/SKILL.md` | Agent instructions for `/csi-opsx:review` (resolve change → guard → runner check → invoke harness). | Create |
| `tsup.config.ts` | Copies each command's `SKILL.md` into `dist/` at build time. | Modify |
| `src/commands/propose/harness.ts` | The reviewer→proposer engine, shared by both commands. Only its summary strings change. | Modify |
| `src/commands/propose/__tests__/harness.test.ts` | Engine tests; one asserts the summary text. | Modify |
| `README.md` | User-facing command list + usage docs. | Modify |

---

## Task 1: Register `review` as a command name

**Files:**
- Modify: `src/lib/types.ts`

This is the prerequisite for everything else: `'review'` must be a `CommandName` before it can be a `HARNESS_RUNNERS` key (Task 2) and before the installer will copy its skill/command (it iterates `COMMAND_NAMES`).

- [x] **Step 1: Add `'review'` to the union and the array**

In `src/lib/types.ts`, change:

```ts
export type CommandName = 'explore' | 'propose' | 'apply' | 'archive';
export type AgentRole = 'reviewer' | 'proposer';
export const COMMAND_NAMES: CommandName[] = ['explore', 'propose', 'apply', 'archive'];
```

to:

```ts
export type CommandName = 'explore' | 'propose' | 'apply' | 'archive' | 'review';
export type AgentRole = 'reviewer' | 'proposer';
export const COMMAND_NAMES: CommandName[] = ['explore', 'propose', 'apply', 'archive', 'review'];
```

- [x] **Step 2: Verify types still compile**

Run: `npm run typecheck`
Expected: no errors (exit 0).

- [x] **Step 3: Verify no existing test breaks**

Run: `npm test`
Expected: all tests pass. (Per the spec, no test asserts the exact command set, so adding `'review'` is safe.)

- [x] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(review): register review as a command name"
```

---

## Task 2: Route `--command=review` to the harness

**Files:**
- Modify: `src/bin/cli.ts`

`review` reuses the same engine as `propose`, so its `HARNESS_RUNNERS` entry calls the same `runProposeHarness`.

> **Why no unit test here:** `cli.ts` calls `program.parse()` at module load, so importing it in vitest would execute the CLI. Routing is therefore verified by `typecheck` (the entry must compile) plus the end-to-end smoke in Task 6. The harness it routes to is already covered by `harness.test.ts`.

- [x] **Step 1: Add the `review` entry to `HARNESS_RUNNERS`**

In `src/bin/cli.ts`, change:

```ts
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    }
};
```

to:

```ts
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    },
    review: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    }
};
```

- [x] **Step 2: Update the `--command` help text**

In the same file, change:

```ts
    .requiredOption('--command <name>', 'command to run (propose)')
```

to:

```ts
    .requiredOption('--command <name>', 'command to run (propose | review)')
```

- [x] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors (exit 0).

- [x] **Step 4: Commit**

```bash
git add src/bin/cli.ts
git commit -m "feat(review): route --command=review to the propose harness"
```

---

## Task 3: Create `review/SKILL.md` and copy it in the build

**Files:**
- Create: `src/commands/review/SKILL.md`
- Modify: `tsup.config.ts`

The SKILL is the agent-facing behavior. It mirrors `propose/SKILL.md` but drops Step 1 (generation), resolves the change by asking when no name is given, guards on artifacts existing, and points the user at `propose` when there is nothing to review. The runner-check messages are review-specific (no "artifacts generated via /opsx:propose" lines, since `review` never generates).

- [x] **Step 1: Create `src/commands/review/SKILL.md`**

Create the file with exactly this content:

````markdown
# csi-opsx Review

Run the automated reviewer→proposer loop on a change whose artifacts **already exist** — without
generating new artifacts. Use this to re-review or resume a change you created earlier, wrote by
hand, or one left behind by a `propose` run that crashed or hit its round cap.

## Step 1: Resolve the change name

Determine which change to review:

- If the user passed an explicit name to `/csi-opsx:review <name>`, use it.
- Otherwise, list `openspec/changes/` and ask the user which change to review.

Always ask when no name was given — do not auto-select, even if only one change exists.

## Step 2: Guard — the change must have artifacts to review

Verify the resolved change folder exists at `openspec/changes/<name>/` and contains at least one
artifact (`proposal.md`, `design.md`, `tasks.md`, or `specs/*/spec.md`).

If the folder is missing or has no artifacts, stop and tell the user — do NOT invoke the harness:

```
Nothing to review for <name> — run /csi-opsx:propose <name> first.
```

## Step 3: Check for a supported runner

**3a — Identify the current tool.**

Determine which AI tool (the CLI or IDE) is running this session — not the underlying model. For
example: Claude Code is the tool; Claude is the model. A tool like Cursor may run Claude as its
model, but the tool is Cursor.

If you cannot determine which tool is running, treat it as unsupported and proceed to 3c.

**3b — Check if the current tool is supported.**

Currently supported runners: Claude Code.

If the current tool is supported, verify its CLI is available by running the following via Bash:

```bash
claude --version
```

If the command exits with code 0, proceed to Step 4.

If the check fails:

```
⚠ csi-opsx: Claude Code CLI not found.
  Automated review loop unavailable.
  Ensure the Claude Code CLI is installed and on your PATH, then try again.
```

**3c — If the current tool is not supported (or uncertain), inform the user.**

```
⚠ csi-opsx: [current tool] is not a supported runner.
  Supported runners: Claude Code.
  Would you like me to check if a supported runner is installed on your system?
```

Wait for the user's response. If yes, proceed to 3d. If no, stop — the developer reviews the
artifacts manually.

**3d — Scan for any supported runner.**

Run each of the following shell commands in order via Bash, stopping at the first that exits with
code 0:
- Claude Code: `claude --version`

If one is found, proceed to Step 4. The harness will detect and use the available runner automatically.

If none are found:

```
⚠ csi-opsx: No supported runner detected.
  Automated review loop unavailable.
  Install a supported runner (e.g. Claude Code) to run the automated review.
```

## Step 4: Run the harness

Run via Bash (the harness enumerates the change folder itself):

```bash
csi-opsx run --command=review --workspace . --change <name>
```

If the user invoked `/csi-opsx:review` with an integer (e.g. `/csi-opsx:review <name> 3`), append
`--max-rounds=<integer>`. Otherwise, omit it (harness default is 5).

Wait for the harness to complete. Surface the exit summary to the session.
````

- [x] **Step 2: Add `'review'` to the tsup copy list**

In `tsup.config.ts`, change:

```ts
const COMMANDS = ['explore', 'propose', 'apply', 'archive'] as const;
```

to:

```ts
const COMMANDS = ['explore', 'propose', 'apply', 'archive', 'review'] as const;
```

- [x] **Step 3: Build and confirm the SKILL is copied to `dist/`**

Run: `npm run build`
Expected: build succeeds (exit 0).

Then confirm the copy happened:

Run: `node -e "console.log(require('fs').existsSync('dist/commands/review/SKILL.md'))"`
Expected: prints `true`.

- [x] **Step 4: Commit**

```bash
git add src/commands/review/SKILL.md tsup.config.ts
git commit -m "feat(review): add review SKILL and copy it in the build"
```

---

## Task 4: Reword the harness exit summary as review output (TDD)

**Files:**
- Modify: `src/commands/propose/__tests__/harness.test.ts:61`
- Modify: `src/commands/propose/harness.ts:148` and `:161`

The summary block (rounds, issues-per-round, findings history) describes the **review loop**, which runs identically under both commands. So the static text becomes "Review complete" rather than "propose complete". One existing test asserts the old text and must be updated first.

- [x] **Step 1: Update the failing assertion (write the test first)**

In `src/commands/propose/__tests__/harness.test.ts`, change line 61:

```ts
        expect(log).toHaveBeenCalledWith(expect.stringContaining('csi-opsx propose complete'));
```

to:

```ts
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Review complete'));
```

- [x] **Step 2: Run the harness tests to verify the new assertion fails**

Run: `npx vitest run src/commands/propose/__tests__/harness.test.ts`
Expected: FAIL — the test "exits cleanly when the first review finds 0 issues" fails because the code still prints `'✓ csi-opsx propose complete'`, not `'Review complete'`.

- [x] **Step 3: Reword the success summary**

In `src/commands/propose/harness.ts`, inside `printSummary` (around line 161), change:

```ts
        '✓ csi-opsx propose complete',
```

to:

```ts
        '✓ Review complete',
```

- [x] **Step 4: Reword the max-rounds notice**

In `src/commands/propose/harness.ts` (around line 148), change:

```ts
        `⚠ csi-opsx propose: reached max rounds (${maxRounds}) without converging to 0 issues.`,
```

to:

```ts
        `⚠ Review: reached max rounds (${maxRounds}) without converging to 0 issues.`,
```

(The existing test asserting `'reached max rounds'` still matches this string, so it stays green.)

- [x] **Step 5: Run the harness tests to verify they pass**

Run: `npx vitest run src/commands/propose/__tests__/harness.test.ts`
Expected: PASS — both the updated "Review complete" assertion and the unchanged "reached max rounds" assertion pass.

- [x] **Step 6: Commit**

```bash
git add src/commands/propose/harness.ts src/commands/propose/__tests__/harness.test.ts
git commit -m "refactor(harness): word the exit summary as review output"
```

---

## Task 5: Document `review` in the README

**Files:**
- Modify: `README.md`

The README enumerates the commands in three places. Update all three so the docs stay complete.

- [x] **Step 1: Add a `review` bullet to "What it does"**

In `README.md`, find the `propose` bullet (the paragraph beginning "- `propose` — the harnessed command.") and add this bullet immediately after it:

```markdown
- `review` — the same reviewer→proposer loop as `propose`, run on a change whose artifacts
  already exist (no generation). For re-reviewing or resuming a change.
```

- [x] **Step 2: Add `/csi-opsx:review` to the Setup command list**

In `README.md`, change:

```markdown
become available as `/csi-opsx:explore`, `/csi-opsx:propose`, `/csi-opsx:apply`, and
`/csi-opsx:archive`.
```

to:

```markdown
become available as `/csi-opsx:explore`, `/csi-opsx:propose`, `/csi-opsx:review`,
`/csi-opsx:apply`, and `/csi-opsx:archive`.
```

- [x] **Step 3: Add a Usage subsection for `review`**

In `README.md`, find the end of the `propose` usage paragraph — it ends with "...left in your change folder for inspection." Immediately after that paragraph, and before the `## Customising a command's behaviour with skills` heading, insert:

```markdown
### Reviewing an existing change

```
/csi-opsx:review <change-name>
```

`review` runs the same automated review loop as `propose`, but **skips artifact generation** — use
it on a change whose artifacts already exist: one you generated earlier, wrote by hand, or left
behind by a `propose` run that crashed or hit its round cap. If the change doesn't exist or has no
artifacts, it tells you to run `/csi-opsx:propose` first. Like `propose`, it resumes from any
existing `review-findings-N.md` and accepts an optional round cap, e.g.
`/csi-opsx:review <change-name> 3` (the default is 5).
```

- [x] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(review): document the review command"
```

---

## Task 6: Full verification and end-to-end smoke

**Files:** none (verification only).

This is the definition-of-done gate. It proves the whole suite is green and that `--command=review` actually routes to the harness (the one thing no unit test covers).

- [x] **Step 1: Typecheck, test, and build all green**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: build succeeds and `dist/commands/review/SKILL.md` exists.

- [x] **Step 2: Smoke-test the routing**

Create an empty change folder, run the command against it, then clean up:

```bash
node -e "require('fs').mkdirSync('openspec/changes/__smoke__',{recursive:true})"
node dist/bin/cli.js run --command=review --workspace . --change __smoke__
node -e "require('fs').rmSync('openspec/changes/__smoke__',{recursive:true,force:true})"
```

Expected: the middle command prints `no artifacts found in openspec/changes/__smoke__. Nothing to review.` and does **NOT** print `Unknown command __smoke__`. Reaching the harness's own "no artifacts" notice proves `--command=review` is wired to `runProposeHarness`. (An empty folder is used deliberately: the harness exits at its `artifacts.length === 0` check, *before* runner resolution, so the result is clean and deterministic whether or not `claude` is installed.)

- [x] **Step 3: (Optional) Smoke-test install**

If you have a scratch project with OpenSpec initialized (or run `csi-opsx init` in one), confirm the review skill and command were installed:

Run: `node -e "const fs=require('fs'); console.log(fs.existsSync('.claude/commands/csi-opsx/review.md'), fs.existsSync('.claude/skills/csi-opsx-review/SKILL.md'))"`
Expected: prints `true true` (run from the scratch project root after `csi-opsx init`).

- [x] **Step 4: Final commit (if anything is uncommitted)**

```bash
git status
# If the working tree is clean, nothing to do. Otherwise commit any stragglers.
```

---

## Done criteria

- `npm run typecheck`, `npm test`, and `npm run build` all pass.
- `dist/commands/review/SKILL.md` exists after a build.
- Running `--command=review` against an empty change folder prints the harness's "no artifacts" notice (no "Unknown command") — proving the route.
- After `csi-opsx init` in a project, `/csi-opsx:review` is installed as both a skill and a command.
- The exit summary reads "✓ Review complete" / "⚠ Review: reached max rounds …" for both `propose` and `review`.
