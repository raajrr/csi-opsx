# csi-opsx Review `--max-rounds` Relative-Resume Design

**Date:** 2026-06-25
**Status:** Draft

---

## Overview

`--max-rounds` is currently an **absolute round-number ceiling**: the harness loops
`while (round <= maxRounds)` (`src/commands/review/harness.ts:94`). The review SKILL maps the
trailing integer of `/csi-opsx:review <name> N` **directly** to `--max-rounds=N`
(`review/SKILL.md:92-93`). Both the user and that SKILL treat `N` as *"run N (more) rounds"*, but
the engine reads it as *"stop when the round counter reaches N"*. The two meanings coincide **only**
on a fresh run that starts at round 1; on any **resume** they diverge.

This change reinterprets `--max-rounds` as a **per-invocation round budget relative to the resume
point**: "run up to N more rounds starting from wherever we pick up." On a fresh run (`startRound = 1`)
the behavior is identical to today, so this is a strict superset of the current contract.

## Problem (root cause)

Resumability already works — the harness scans `review-findings-*.md`, takes the highest round, and
reads its `status` to decide whether to start that round's proposer or the next round's reviewer
(`harness.ts:67-92`). The defect is purely the ceiling semantics, plus a misleading exit summary:

1. **Silent no-op on resume.** When a prior run left findings through round *K* (`status: addressed`),
   resume computes `round = K + 1`. If the user passes a small `N ≤ K`, the guard `while (K+1 <= N)`
   is false, so **the loop body never executes** — the harness does zero work.

2. **Misleading "did nothing" summary.** After running zero iterations it still falls through to the
   max-rounds notice, which reads `issuesPerRound(changeDir, maxRounds)` and enumerates
   `review-findings-1.md … review-findings-{maxRounds}.md` (`harness.ts:146,150`). With `maxRounds = 2`
   that re-reads the *stale* findings-1 (4 issues) and findings-2 (2 issues) and prints
   `Issues found per round: 4, 2`. A reader (human or orchestrating agent) sees the old `4, 2`
   convergence trace and reasonably — but wrongly — concludes *"it restarted from round 1 and doesn't
   resume across sessions."* That misdiagnosis is exactly what happened in the
   `review-command-resume.txt` session: the harness never re-ran rounds 1–2; the summary just
   re-printed their committed numbers.

## Decision

Interpret `maxRounds` as **the number of rounds to run this invocation, measured from the resume
point** — not an absolute round-number ceiling.

```ts
// after the resume block has set `round`/`phase`:
const startRound = round;                 // the round we actually begin executing
const lastRound  = startRound - 1 + maxRounds;
while (round <= lastRound) { /* … */ }
```

- Fresh run: `startRound = 1` ⇒ `lastRound = maxRounds` ⇒ identical to today.
- Resume from round `K+1` with `N`: `lastRound = K + N` ⇒ runs rounds `K+1 … K+N` = **N more rounds**.
- Because any `N ≥ 1` gives `lastRound ≥ startRound`, the loop **always runs at least one round** on
  resume — the silent no-op disappears by construction.

A "round" remains one reviewer pass plus (when issues are found) one proposer pass, sharing the same
round number. Resuming mid-round (at the proposer of round `K`, `status: open`) counts that finishing
proposer pass as part of the first budgeted round, so `startRound = K` and the budget still spans `N`
distinct round numbers.

### Why relative, not "keep absolute + compute in the SKILL"

The rejected alternative keeps `maxRounds` absolute and teaches `review/SKILL.md` to read the current
highest round and pass `--max-rounds = highest + N`. Rejected because it pushes the critical
arithmetic into **markdown instructions an LLM must execute correctly every time** — read the change
folder, count findings files, add — which is precisely the step that already failed in the recorded
session. Putting the budget math in **deterministic code** (one place, unit-tested) is more reliable,
keeps the SKILL simple, and makes the silent no-op impossible rather than merely unlikely.

## Secondary fix — honest exit summary

The max-rounds notice must report the rounds **actually run**, not `maxRounds`. Key the counts and the
history list off the real highest round on disk (`findLatestFindingsRound`), and reword so it no longer
claims a "reached max rounds" ceiling was hit:

```ts
const highestRound = findLatestFindingsRound(changeDir);
const counts  = issuesPerRound(changeDir, highestRound);
const history = Array.from({ length: highestRound }, (_, i) => `review-findings-${i + 1}.md`);
console.log([
    `⚠ Review: ran ${maxRounds} round${maxRounds === 1 ? '' : 's'} this pass ` +
        `(through round ${highestRound}) without converging to 0 issues.`,
    `  Issues found per round: ${counts.join(', ')}`,
    `  Review history: ${history.join(', ')}`,
    '  Run /csi-opsx:review <name> again to run more rounds, or review the artifacts and findings manually.',
].join('\n'));
```

This removes the stale-`4, 2` illusion and tells the user how to continue (run again for more rounds).

## Relationship to prior decisions (this reverses one)

Two earlier design records explicitly froze the round cap as *unchanged*:

- `docs/superpowers/specs/2026-06-16-review-command-design.md:21` — lists "the round cap" among the
  behaviors the review command inherits unchanged.
- `docs/superpowers/plans/2026-06-19-thin-propose.md:15` and its design doc (Non-Goals, line 69) —
  "resumability, round cap … are untouched."

Those statements were true for those changes. This change deliberately **redefines the round cap's
semantics** (absolute → per-invocation relative). Recording it here is the counter-trail so a future
reader of the "untouched" notes knows where the meaning changed and why.

## Edge cases

- **`maxRounds < 1`.** The original CLI contract already requires a *positive integer*
  (`docs/superpowers/specs/2026-05-18-csi-opsx-design.md:144`). Guard defensively: if `maxRounds < 1`,
  print a one-line notice and return without running — never silently do nothing.
- **Default (5).** Unchanged on a fresh run (rounds 1–5). On resume it now means "up to 5 more
  rounds," a reasonable and strictly-more-useful default.
- **Convergence after resume.** Because every budgeted round begins with a reviewer pass, running
  "N more rounds" gives N verification passes — so a resume can now actually reach 0-issue convergence
  (a reviewer round after the proposer's last pass), which a too-small absolute cap previously
  prevented. `issues-found` is still never decremented by the proposer (`agents.ts:96-97`); convergence
  is still defined solely as a reviewer round reporting 0.

## Files changed

| File | Change |
|---|---|
| `src/commands/review/harness.ts` | Compute `lastRound = startRound - 1 + maxRounds`; loop on `lastRound`. Add the `maxRounds < 1` guard. Rewrite the max-rounds summary to key off `findLatestFindingsRound`. |
| `src/commands/review/__tests__/harness.test.ts` | New test: relative budget runs N more rounds on resume. New/updated test: summary reports the real highest round. Update the existing `respects maxRounds` wording assertion. |
| `src/bin/cli.ts:75` | Clarify `--max-rounds` help text (rounds **per invocation**, added to rounds already completed when resuming). |
| `src/commands/review/SKILL.md` | Clarify that the integer is *additional rounds to run*, not an absolute ceiling. |
| `README.md` | Update the round-cap wording (lines 79–80, 94–97) to the relative meaning. |
| `.claude/CLAUDE.md` | Note the relative `--max-rounds` semantics in the harness/resumability section. |

## Testing

- **RED first** for the core behavior: a resume scenario with findings through round 3 and
  `maxRounds: 2` must run rounds 4 and 5 (4 runner calls). Fails under current code (0 calls).
- **RED first** for the summary: the max-rounds notice reflects the actual highest round, not
  `maxRounds`.
- The existing `respects maxRounds` fresh-run test stays valid (its assertion wording updates with the
  reworded notice).
- `npm run typecheck`, `npm test`, and `npm run build` all green.

## Out of scope (YAGNI)

- **Renaming the `--max-rounds` flag.** "Max rounds per invocation" stays defensible; renaming would
  ripple through CLI, SKILL, docs, and tests for no functional gain. Clarified help text instead.
- **Decrementing `issues-found` as the proposer resolves issues.** Convergence stays reviewer-driven.
- **Auto-continuing past the budget.** The summary *suggests* re-running; it does not loop forever.

## Open Questions

- None.

## Decisions

1. **`--max-rounds` becomes a per-invocation budget relative to the resume point** (`lastRound =
   startRound - 1 + maxRounds`). *Rejected:* keep it absolute and do the arithmetic in `review/SKILL.md`
   (fragile LLM-side math; the recorded failure mode).
2. **Fix the max-rounds summary to report actual rounds run**, keyed off `findLatestFindingsRound`.
   *Rejected:* leave it keyed off `maxRounds` (reproduces the stale `4, 2` illusion).
3. **Guard `maxRounds < 1` with an explicit notice + return.** *Rejected:* silently running nothing
   (the very confusion this change removes).
4. **Keep the flag name `--max-rounds`; clarify docs instead of renaming.** *Rejected:* rename churn
   for no functional gain.
