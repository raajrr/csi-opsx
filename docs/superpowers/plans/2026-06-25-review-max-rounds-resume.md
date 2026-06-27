# Review `--max-rounds` Relative-Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **NOTE:** this repo's owner executes collaboratively (they type the code; Claude guides and verifies). Do not auto-apply code via subagents unless the owner says otherwise.

**Goal:** Make `--max-rounds` a per-invocation round budget measured from the resume point, so `/csi-opsx:review <name> N` runs **N more rounds** when resuming (instead of silently doing nothing when the next round number exceeds `N`), and fix the misleading max-rounds summary that re-printed stale early-round findings.

**Architecture:** The resume engine already computes the next round from committed `review-findings-*.md`. This change leaves resume untouched and only (1) replaces the absolute loop ceiling `while (round <= maxRounds)` with a relative one `while (round <= startRound - 1 + maxRounds)`, (2) guards `maxRounds < 1`, and (3) rewrites the max-rounds exit summary to report the rounds actually run (keyed off `findLatestFindingsRound`) rather than `maxRounds`. Plus doc updates.

**Tech Stack:** TypeScript (ESM), tsup (build), vitest (tests), commander (CLI). SKILL.md files are agent-facing markdown assets, not compiled.

**Design doc:** `docs/superpowers/specs/2026-06-25-review-max-rounds-resume-design.md`

## Global Constraints

- **Resume logic is NOT changed** — `findLatestFindingsRound` / `parseStatus` / `parseIssuesFound` and the start-phase decision (`harness.ts:67-92`) stay exactly as they are. Only the loop ceiling, a new lower-bound guard, and the summary wording/enumeration change.
- **Fresh-run behavior must stay identical** — on a fresh run `startRound = 1`, so `endRound = maxRounds` (same as today). Existing fresh-run tests must stay green.
- **`maxRounds` contract is a positive integer** (`docs/superpowers/specs/2026-05-18-csi-opsx-design.md:144`). `< 1` is a usage error, handled with an explicit notice, never a silent no-op.
- **`findLatestFindingsRound` is already imported** in `harness.ts:5` — no new imports needed.
- **TDD throughout** — every code change is preceded by a test that fails first for the right reason.
- **Node.js 20.19+** — already satisfied by the dev environment.

## Branch

Start on a feature branch before Task 1 (we're on `master`):

```bash
git checkout -b fix-review-max-rounds-resume
```

## File Structure

| Path | Responsibility after this change |
|---|---|
| `src/commands/review/harness.ts` | Relative round budget (`endRound`), `maxRounds < 1` guard, honest max-rounds summary keyed off `findLatestFindingsRound`. |
| `src/commands/review/__tests__/harness.test.ts` | New tests: relative budget on resume, `maxRounds < 1` guard, summary reports real highest round. Existing `respects maxRounds` assertion robustified. |
| `src/bin/cli.ts` | `--max-rounds` help text clarified (per-invocation budget). |
| `src/commands/review/SKILL.md` | Clarify the integer is *additional* rounds, not an absolute ceiling. |
| `README.md` | Round-cap wording → round-budget / relative-on-resume. |
| `.claude/CLAUDE.md` | Resumability section notes the relative `--max-rounds` semantics. |

---

### Task 1: Relative round budget + lower-bound guard

**Files:**
- Modify: `src/commands/review/harness.ts` (loop ceiling near line 94; new guard after line 45)
- Test: `src/commands/review/__tests__/harness.test.ts`

**Interfaces:**
- Consumes: `runReviewHarness(opts: HarnessOptions): Promise<void>` and `HarnessOptions = { workspace: string; changeName: string; maxRounds?: number }` (unchanged).
- Produces: no signature change. Behavioral change only: `maxRounds` is now a per-invocation budget.

- [x] **Step 1: Write the failing test (relative budget on resume)**

In `src/commands/review/__tests__/harness.test.ts`, add this test immediately **after** the `'resumes status=addressed …'` test (after its closing `});` on line 105):

```typescript
it('treats maxRounds as additional rounds to run when resuming, not an absolute ceiling', async () => {
    /* Three rounds already completed on disk; the latest is `addressed`, so resume
       would begin at round 4. With maxRounds=2 the user means "run 2 MORE rounds"
       (rounds 4 and 5) — not "stop at round 2", which would run nothing. */
    writeFileSync(join(changeDir, REVIEW_FINDINGS_1), findings(4, 1, 'addressed'));
    writeFileSync(join(changeDir, REVIEW_FINDINGS_2), findings(2, 2, 'addressed'));
    writeFileSync(join(changeDir, 'review-findings-3.md'), findings(2, 3, 'addressed'));
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
        isAvailable: () => true,
        run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
            n++;
            const round = 3 + Math.ceil(n / 2); // n=1,2 -> round 4; n=3,4 -> round 5
            const file = `review-findings-${round}.md`;
            if (n % 2 === 1)
                // reviewer: always finds 1 issue so the loop never converges early
                writeFileSync(join(workspaceDir, file), findings(1, round, 'open') + '## Issue\nis-solved: false\nx');
            else
                // proposer: addresses the issue
                writeFileSync(join(workspaceDir, file), findings(1, round, 'addressed'));
            return { exitCode: 0, stdout: '', stderr: '' };
        }),
    });
    await runReviewHarness({ workspace: projectRoot, changeName: CHANGE, maxRounds: 2 });
    expect(n).toBe(4); // 2 more rounds (4 and 5) x (reviewer + proposer)
    expect(existsSync(join(changeDir, 'review-findings-4.md'))).toBe(true);
    expect(existsSync(join(changeDir, 'review-findings-5.md'))).toBe(true);
});
```

- [x] **Step 2: Run the test, verify it FAILS for the right reason**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts -t "additional rounds to run when resuming"
```
Expected: FAIL — `expected 4, got 0`. Resume sets `round = 4`, and the current `while (4 <= 2)` is false, so the loop body never runs (`n` stays 0). This is the silent no-op the change fixes.

- [x] **Step 3: Implement the relative ceiling in `src/commands/review/harness.ts`**

Replace the `while` line (currently line 94) and add the budget computation just above it:

```ts
// before
    while (round <= maxRounds) {
        const findingsName = `review-findings-${round}.md`;

// after
    // maxRounds is a per-invocation budget measured from the resume point, not an absolute
    // ceiling: fresh runs start at round 1 (unchanged); a resume runs `maxRounds` more rounds
    // beyond the rounds already committed on disk.
    const startRound = round;
    const endRound = startRound - 1 + maxRounds;
    while (round <= endRound) {
        const findingsName = `review-findings-${round}.md`;
```

- [x] **Step 4: Run the test, verify it PASSES**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts -t "additional rounds to run when resuming"
```
Expected: PASS (`n === 4`; findings-4 and findings-5 exist).

- [x] **Step 5: Write the failing test (`maxRounds < 1` guard)**

Add this test right after the one from Step 1:

```typescript
it('does nothing and warns when maxRounds is below 1', async () => {
    const runSpy = vi.fn();
    vi.mocked(resolveRunner).mockReturnValue({ isAvailable: () => true, run: runSpy });
    const log = vi.spyOn(console, 'log');
    await runReviewHarness({ workspace: projectRoot, changeName: CHANGE, maxRounds: 0 });
    expect(runSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('--max-rounds must be at least 1'));
});
```

- [x] **Step 6: Run it, verify it FAILS**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts -t "maxRounds is below 1"
```
Expected: FAIL — without the guard, `maxRounds: 0` falls through to the max-rounds summary (`endRound = 0`, loop skipped) and logs a "ran 0 rounds" notice, never the `--max-rounds must be at least 1` message.

- [x] **Step 7: Implement the guard in `src/commands/review/harness.ts`**

Add the guard immediately after the options are destructured (currently line 45):

```ts
// before
    const { changeName, maxRounds = DEFAULT_MAX_ROUNDS } = opts;

    validateChangeName(changeName);

// after
    const { changeName, maxRounds = DEFAULT_MAX_ROUNDS } = opts;
    if (maxRounds < 1) {
        console.log(`⚠ csi-opsx: --max-rounds must be at least 1 (got ${maxRounds}). Nothing to do.`);
        return;
    }

    validateChangeName(changeName);
```

- [x] **Step 8: Run the whole harness test file, verify all green**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts
```
Expected: PASS — the two new tests plus all existing cases (the fresh-run `respects maxRounds` test still passes because `startRound = 1` keeps `endRound = maxRounds`).

- [ ] **Step 9: Commit**

```bash
git add src/commands/review/harness.ts src/commands/review/__tests__/harness.test.ts
git commit -m "fix: make review --max-rounds a per-invocation budget so resume runs N more rounds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Honest max-rounds exit summary

**Files:**
- Modify: `src/commands/review/harness.ts` (summary block, currently lines 146-152)
- Test: `src/commands/review/__tests__/harness.test.ts`

**Interfaces:**
- Consumes: `findLatestFindingsRound(changeDir)` and `issuesPerRound(changeDir, rounds)` (both already in this file).
- Produces: no signature change. The summary now reads the real highest round on disk instead of `maxRounds`.

- [x] **Step 1: Robustify the existing `respects maxRounds` assertion**

The reworded notice drops the phrase "reached max rounds" but keeps "without converging to 0 issues". Update the existing assertion (currently line 180) to the stable substring so it survives the rewording (it stays GREEN now and after Step 3):

```ts
// before
        expect(log).toHaveBeenCalledWith(expect.stringContaining('reached max rounds'));
// after
        expect(log).toHaveBeenCalledWith(expect.stringContaining('without converging to 0 issues'));
```

Run to confirm still green:

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts -t "respects maxRounds"
```
Expected: PASS (current message still contains "without converging to 0 issues").

- [x] **Step 2: Write the failing test (summary reports the real highest round)**

Add this test after the `'maxRounds is below 1'` test:

```typescript
it('the max-rounds summary reports the actual highest round and its issue counts, not maxRounds', async () => {
    // One round already committed (addressed) -> resume starts at round 2.
    writeFileSync(join(changeDir, REVIEW_FINDINGS_1), findings(5, 1, 'addressed'));
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
        isAvailable: () => true,
        run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
            n++;
            if (n === 1)
                // round 2 reviewer: finds 1 issue
                writeFileSync(join(workspaceDir, REVIEW_FINDINGS_2), findings(1, 2, 'open') + '## Issue\nis-solved: false\nx');
            else
                // round 2 proposer: addresses it
                writeFileSync(join(workspaceDir, REVIEW_FINDINGS_2), findings(1, 2, 'addressed'));
            return { exitCode: 0, stdout: '', stderr: '' };
        }),
    });
    const log = vi.spyOn(console, 'log');
    // budget of 1 round from the resume point -> runs round 2 only, then hits the summary
    await runReviewHarness({ workspace: projectRoot, changeName: CHANGE, maxRounds: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('through round 2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('5, 1')); // findings-1 (5) + findings-2 (1)
});
```

- [x] **Step 3: Run it, verify it FAILS**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts -t "actual highest round"
```
Expected: FAIL — the current summary reads `issuesPerRound(changeDir, maxRounds=1)` → only `[5]`, and prints "reached max rounds (1)". Neither "through round 2" nor "5, 1" appears.

- [x] **Step 4: Implement the summary rewrite in `src/commands/review/harness.ts`**

Replace the max-rounds exit block (currently lines 146-152):

```ts
// before
    const counts = issuesPerRound(changeDir, maxRounds);
    console.log([
        `⚠ Review: reached max rounds (${maxRounds}) without converging to 0 issues.`,
        `  Issues found per round: ${counts.join(', ')}`,
        `  Review history: ${Array.from({ length: maxRounds }, (_, i) => `review-findings-${i + 1}.md`).join(', ')}`,
        '  Review the artifacts and the findings files manually.',
    ].join('\n'));

// after
    const highestRound = findLatestFindingsRound(changeDir);
    const counts = issuesPerRound(changeDir, highestRound);
    console.log([
        `⚠ Review: ran ${maxRounds} round${maxRounds === 1 ? '' : 's'} this pass (through round ${highestRound}) without converging to 0 issues.`,
        `  Issues found per round: ${counts.join(', ')}`,
        `  Review history: ${Array.from({ length: highestRound }, (_, i) => `review-findings-${i + 1}.md`).join(', ')}`,
        '  Run /csi-opsx:review again to run more rounds, or review the artifacts and findings files manually.',
    ].join('\n'));
```

- [x] **Step 5: Run the whole harness test file, verify all green**

```bash
npx vitest run src/commands/review/__tests__/harness.test.ts
```
Expected: PASS — new summary test passes; `respects maxRounds` still passes (stable substring); all resume tests pass.

- [x] **Step 6: Commit**

```bash
git add src/commands/review/harness.ts src/commands/review/__tests__/harness.test.ts
git commit -m "fix: report actual rounds run in review max-rounds summary instead of maxRounds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `src/bin/cli.ts:75`
- Modify: `src/commands/review/SKILL.md` (lines 92-93)
- Modify: `README.md` (lines 79-80 and 94-97)
- Modify: `.claude/CLAUDE.md` (Resumability section)

**Interfaces:** none — doc/help-text only.

- [x] **Step 1: `src/bin/cli.ts` — clarify the `--max-rounds` help text (line 75)**

```ts
// before
    .option('--max-rounds <n>', 'maximum reviewer→proposer rounds (default 5)', (v) => parseInt(v, 10))
// after
    .option('--max-rounds <n>', 'reviewer→proposer rounds to run this invocation; on resume these are added to the rounds already completed (default 5)', (v) => parseInt(v, 10))
```

- [x] **Step 2: `src/commands/review/SKILL.md` — clarify the integer (lines 92-93)**

```markdown
// before
If the user invoked `/csi-opsx:review` with an integer (e.g. `/csi-opsx:review <name> 3`), append
`--max-rounds=<integer>`. Otherwise, omit it (harness default is 5).

// after
If the user invoked `/csi-opsx:review` with an integer (e.g. `/csi-opsx:review <name> 3`), append
`--max-rounds=<integer>`. The integer is the number of rounds to run **this** invocation — when
resuming a change that already has `review-findings-N.md`, the harness runs that many *more* rounds
beyond the ones already completed (it is not an absolute round-number ceiling). Otherwise, omit it
(harness default is 5).
```

- [x] **Step 3: `README.md` — round budget wording (lines 79-80)**

```markdown
// before
automated reviewer→proposer loop over those artifacts, and accepts an optional round cap,
e.g. `/csi-opsx:review <change-name> 3` (the default is 5).

// after
automated reviewer→proposer loop over those artifacts, and accepts an optional round budget,
e.g. `/csi-opsx:review <change-name> 3` runs up to 3 rounds this pass (the default is 5). On a
resume, the number is how many *more* rounds to run beyond those already completed.
```

- [x] **Step 4: `README.md` — resume note (lines 94-97)**

```markdown
// before
`review` is also how you re-review or resume a change whose artifacts already exist — one you
generated in an earlier session, wrote by hand, or left behind by a `review` run that crashed or hit
its round cap. If the change doesn't exist or has no artifacts, it tells you to run
`/csi-opsx:propose` first. It resumes from any existing `review-findings-N.md`.

// after
`review` is also how you re-review or resume a change whose artifacts already exist — one you
generated in an earlier session, wrote by hand, or left behind by a `review` run that crashed or ran
out its round budget. If the change doesn't exist or has no artifacts, it tells you to run
`/csi-opsx:propose` first. It resumes from any existing `review-findings-N.md`, and re-running it runs
more rounds from where the last pass stopped — pass an integer to control how many.
```

- [x] **Step 5: `.claude/CLAUDE.md` — note the relative semantics in the Resumability section**

Append a sentence to the existing Resumability paragraph:

```markdown
// before
### Resumability

On startup the harness scans for `review-findings-*.md` files, finds the highest round, and inspects its `status` to determine whether to start the reviewer or proposer for that round.

// after
### Resumability

On startup the harness scans for `review-findings-*.md` files, finds the highest round, and inspects its `status` to determine whether to start the reviewer or proposer for that round.

`--max-rounds` is a per-invocation budget relative to that resume point: the loop runs `maxRounds` rounds beyond the highest committed round (`endRound = startRound - 1 + maxRounds`), so on a fresh run it behaves as an absolute cap (rounds `1..maxRounds`) and on a resume it runs that many *more* rounds.
```

- [x] **Step 6: Build to confirm the SKILL asset still copies**

```bash
npm run build
```
Expected: exits 0; `tsup`'s `onSuccess` hook copies `src/commands/review/SKILL.md` → `dist/commands/review/SKILL.md`.

- [x] **Step 7: Verify the docs by reading the changed regions**

Read the edited regions of `src/bin/cli.ts`, `src/commands/review/SKILL.md`, `README.md`, and `.claude/CLAUDE.md` and confirm no remaining claim that `--max-rounds` is an absolute ceiling.

- [ ] **Step 8: Commit**

```bash
git add src/bin/cli.ts src/commands/review/SKILL.md README.md .claude/CLAUDE.md
git commit -m "docs: describe review --max-rounds as a per-invocation, resume-relative budget

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification

After all three tasks, run the full gate once and confirm green:

```bash
npm run build && npm run typecheck && npm test
```
Expected: build succeeds (SKILL.md assets copied), typecheck clean, all tests pass (including the three new harness tests).

Optional manual smoke (requires `claude` on PATH and an OpenSpec project with an existing reviewed change): run `/csi-opsx:review <name> 2` on a change that already has `review-findings-1.md … review-findings-3.md` and confirm it runs rounds 4–5 (not a no-op) and the summary names the real highest round.

## Self-Review (completed by plan author)

- **Design-doc coverage:** relative ceiling (Task 1 Steps 1-4) ✓; `maxRounds < 1` guard (Task 1 Steps 5-7) ✓; honest summary keyed off `findLatestFindingsRound` (Task 2) ✓; fresh-run parity (Global Constraints + `respects maxRounds` stays green) ✓; cli/SKILL/README/CLAUDE.md docs (Task 3) ✓; flag-rename and issues-found-decrement explicitly out of scope (no task) ✓.
- **Placeholder scan:** every code/test/doc step shows full before/after content; no TBD/TODO/"handle edge cases".
- **Type consistency:** `startRound`, `endRound`, `highestRound` are local `number`s; `runReviewHarness`/`HarnessOptions` unchanged; `findLatestFindingsRound`/`issuesPerRound` used with existing signatures.
