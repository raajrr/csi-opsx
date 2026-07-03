# csi-opsx Thin `propose` Design Spec

**Date:** 2026-06-19  
**Status:** Implemented (merged to master as PR #3)  

---

## Overview

Now that `/csi-opsx:review` is a standalone command that owns the reviewer→proposer loop,
`/csi-opsx:propose` no longer needs to drive that loop itself. This change demotes `propose` to a
**thin, skill-customizable wrapper** around `/opsx:propose` — joining `explore`, `apply`, and
`archive` — and hands off to `review` at the end instead of invoking the harness directly.

In one line: `propose` keeps Step 1 (generate artifacts via `/opsx:propose`) and drops Steps 2–3
(runner detection + harness invocation); the loop is reached by running `/csi-opsx:review`
afterward.

As a small consistency rider, this change also adds the same empty `## Skills` extension hook to
`apply` and `archive`, so every thin command exposes it (`explore` already does).

The harness engine does not change behaviorally. It **relocates** from `src/commands/propose/` to
`src/commands/review/` (its sole owner after this change) and its entry point is renamed
`runProposeHarness` → `runReviewHarness` for honesty. The `--command=propose` harness dispatch is
removed; `--command=review` remains and is now the only harnessed command.

This reverses one earlier decision: the [review command spec](./2026-06-16-review-command-design.md)
recorded that *both* commands run the same harness via `HARNESS_RUNNERS`. After this change only
`review` does.

---

## Motivation

- **Consistency.** `explore`, `apply`, and `archive` are thin OpenSpec passthroughs, but today only
  `explore` exposes the `## Skills` extension point. This change makes the hook uniform — `propose`
  becomes thin and gains it, and `apply`/`archive` gain the same empty hook — so all four thin
  commands are customizable, while `review` is the single harnessed command. Clean mental model:
  **one generator, one reviewer, composed by the user.**
- **Removes duplication.** `propose/SKILL.md` and `review/SKILL.md` today carry the *same* ~55-line
  runner-detection block (identify tool → check supported → scan → fail messages). Slimming
  `propose` deletes that copy.
- **Customizability.** `propose` gains the `## Skills` hook, so users can attach skills to the
  generation step (the way `explore` attaches `grill-me`).
- **Honest ownership.** The harness is *already* a pure "review existing artifacts" engine
  (`runProposeHarness` never branched on command name); only prose in `propose/SKILL.md` coupled
  generation to it. Moving the code to `review/` and renaming it makes the structure match reality.

The cost — accepted in design — is that the common path becomes **two commands**
(`propose` then `review`) instead of one. We keep it discoverable with an end-of-session handoff,
mirroring the existing `explore → propose` suggestion.

---

## Goals

- Reduce `propose/SKILL.md` to a thin wrapper: generate artifacts, expose a `## Skills` hook, hand
  off to `review`.
- Relocate the harness engine (`harness.ts`, `agents.ts`, tests) from `propose/` to `review/` with
  no behavioral change, and rename its entry point to `runReviewHarness`.
- Remove the `propose` entry from `HARNESS_RUNNERS` so `--command=propose` no longer exists.
- Keep `review`'s behavior identical to today (it already calls `--command=review`).
- Add the empty `## Skills` extension hook to the remaining thin commands (`apply`, `archive`) so
  all thin passthroughs are uniformly customizable (consistency rider).

## Non-Goals

- No change to the reviewer→proposer loop logic, the `review-findings-N.md` format, the workspace
  write-sandbox, resumability, or the round cap.
- No automatic chaining: `propose` **suggests** `review`, it does not run it. (Auto-running review
  would re-introduce the coupling we are removing.)
- No change to `review/SKILL.md`.
- No removal of `propose` as a user-facing command — it stays installed, with a slash command.

---

## Relationship to `review` (after this change)

| | `/csi-opsx:propose` | `/csi-opsx:review` |
|---|---|---|
| Generates artifacts (`/opsx:propose`) | **Yes** (its only real job) | No |
| Runner detection in SKILL | **Removed** | Yes (unchanged) |
| Invokes the harness | **No** | Yes (`--command=review`) |
| `## Skills` extension point | **Yes (new, empty)** | No (the loop *is* its behavior) |
| Ends by suggesting | `/csi-opsx:review <name>` | n/a |
| Owns harness code | No (relocated out) | **Yes** (`review/harness.ts`, `review/agents.ts`) |

The two commands are now cleanly separated: `propose` is generation, `review` is the loop.

---

## Behavior — new `propose/SKILL.md`

Slimmed to roughly the size of `explore/SKILL.md`:

1. **Generate.** Keep "Follow `/opsx:propose` behavior exactly to generate initial artifacts
   (`proposal.md`, `design.md`, `tasks.md`, and any spec files)." Unchanged from current Step 1.
2. **`## Skills` section.** Add the same block `explore` uses, **with no default skill listed** —
   an empty extension point users populate per their preferences:
   ```markdown
   ## Skills
   Load and follow these skills if relevant to the work:
   ```
3. **Session-end handoff.** End with the `explore`-style suggestion, surfacing the change name that
   `/opsx:propose` just created (the agent already knows this name from the generation it just
   performed — no resolution step is needed):
   > "Artifacts generated for `<name>`. Ready to review? Run `/csi-opsx:review <name>` to run the
   > automated reviewer→proposer loop."

**Removed from `propose/SKILL.md`:**

- The entire runner-detection block (current Steps 2a–2d) — duplicated in `review/SKILL.md`; the
  runner check now happens only when `review` runs.
- The harness-invocation step (current Step 3), including the change-name resolution cascade, the
  empty-guard, and the `--max-rounds` integer argument. `/opsx:propose` handles naming; the round
  cap is now a concern of `review` only. (Generation can't yield an empty change, so no guard is
  needed; `review` guards its own entry independently.)

---

## Behavior — `apply`/`archive` (consistency rider)

`apply/SKILL.md` and `archive/SKILL.md` are currently one-liners ("Follow `/opsx:apply` /
`/opsx:archive` behavior exactly"). Add the same empty `## Skills` block used by `propose`:

```markdown
## Skills
Load and follow these skills if relevant to the work:
```

No other change — they stay thin passthroughs; the hook just lets users attach skills if they want.
`explore` already has this section, so after this change all four thin commands expose it.

---

## Engine — relocated and renamed (no behavior change)

The harness already does the same thing regardless of command — it runs the loop over artifacts on
disk. We move it to its sole owner and rename the entry point.

- `src/commands/propose/harness.ts` → `src/commands/review/harness.ts`
- `src/commands/propose/agents.ts` → `src/commands/review/agents.ts`
- `src/commands/propose/__tests__/harness.test.ts` → `src/commands/review/__tests__/harness.test.ts`
- `runProposeHarness` → `runReviewHarness` (export in `harness.ts`, calls in `cli.ts`, calls in the
  test).

**Relative imports inside the moved files do not change.** They keep the same directory depth, so
`../../lib/...`, `./agents.js` (in `harness.ts`), and `../harness.js` (in the test) all stay valid.
Only the *consumers'* paths in `cli.ts` change.

After the move, `src/commands/propose/` holds only `SKILL.md`, symmetric with `explore`/`apply`/
`archive`.

---

## CLI dispatch — drop `--command=propose`

In `src/bin/cli.ts`:

- **Import path** (line 13): `from "../commands/propose/harness.js"` →
  `from "../commands/review/harness.js"` (the `HarnessOptions` type).
- **`HARNESS_RUNNERS`** (lines 62–71): remove the `propose` entry entirely; keep a single `review`
  entry that imports from the relocated path and calls `runReviewHarness`:
  ```ts
  const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
      review: async (opts) => {
          const { runReviewHarness } = await import('../commands/review/harness.js');
          await runReviewHarness(opts);
      },
  };
  ```
- **`--command` help text** (line 76): `'command to run (propose | review)'` → `'command to run (review)'`.

The `run` action validates only by presence in the map (`HARNESS_RUNNERS[opts.command]`), so
removing the `propose` key is what makes `--command=propose` stop resolving — no separate
allow-list to touch.

---

## Files NOT changed (deliberately)

- **`src/lib/types.ts`** — `CommandName` and `COMMAND_NAMES` keep `'propose'`. It is still a
  user-facing command (installed SKILL + slash command); only the *harness* dispatch drops it. The
  `HARNESS_RUNNERS` map is `Partial<Record<CommandName, …>>`, so omitting the `propose` key
  compiles fine.
- **`tsup.config.ts`** — `COMMANDS` keeps `'propose'`; its (now-thin) `SKILL.md` still needs copying
  to `dist/`.
- **`src/commands/review/SKILL.md`** — unchanged. It already resolves the change, guards, checks the
  runner, and calls `--command=review`.
- **Harness summary wording** — already static (`"✓ Review complete"` / `"⚠ Review: …"`) from the
  review-command work. Now that the harness only ever runs under `review`, that wording is
  unambiguously correct; no edit needed.

---

## File-by-file changes

| File | Change |
|---|---|
| `src/commands/propose/SKILL.md` | Rewrite to thin wrapper: keep generation step, add empty `## Skills` section, add `review` handoff. Delete runner-detection + harness-invocation steps. |
| `src/commands/apply/SKILL.md` | Add the empty `## Skills` section (consistency rider). |
| `src/commands/archive/SKILL.md` | Add the empty `## Skills` section (consistency rider). |
| `src/commands/propose/harness.ts` | **Move** to `src/commands/review/harness.ts`; rename export `runProposeHarness` → `runReviewHarness`. No logic change. |
| `src/commands/propose/agents.ts` | **Move** to `src/commands/review/agents.ts`. No change. |
| `src/commands/propose/__tests__/harness.test.ts` | **Move** to `src/commands/review/__tests__/harness.test.ts`; update `runProposeHarness` references to `runReviewHarness`. Relative import `../harness.js` unchanged. |
| `src/bin/cli.ts` | Update `HarnessOptions` import path; remove `propose` entry from `HARNESS_RUNNERS`; rename call to `runReviewHarness`; update `--command` help text. |
| `README.md` | Update `propose`'s description from "generates + auto-reviews" to "generates artifacts (thin wrapper), then suggests `review`." Reflect the two-step flow. |
| `.claude/CLAUDE.md` | Update the Architecture section: `propose` is now a thin wrapper that hands off to `review`; `review` owns the relocated/renamed harness; note the `## Skills` hook on the thin commands. |

---

## Testing

- **Relocated harness test** (`review/__tests__/harness.test.ts`) must pass unchanged in substance —
  only the function name updates. It still covers the loop, resumability, convergence, and round cap.
- **`npm run typecheck`** catches any missed `runProposeHarness` reference or stale import path.
- **`npm test`** confirms no regression. `install.test.ts` / `adapters.test.ts` use explicit
  per-command lists and don't assert harness wiring, so they're unaffected.
- The thin `propose/SKILL.md` is agent-driven markdown, validated by inspection / manual run, like
  the other thin SKILLs.
- *Manual check:* run `/csi-opsx:propose` end-to-end and confirm it generates artifacts and prints
  the `review` handoff without invoking the harness.

---

## Documentation

- `README.md`: update the `propose` usage note to describe the thin wrapper + handoff, and make
  clear `propose` then `review` is the normal two-step flow.
- `.claude/CLAUDE.md`: the Architecture section currently says `propose` "generates the artifacts
  first (via OpenSpec) and then loops" and that both commands drive `runProposeHarness`. Update it
  to reflect that `propose` is now a thin wrapper that hands off to `review`, and that `review` owns
  the relocated/renamed harness, and that the thin commands expose a `## Skills` hook. (Part of this
  change — see File-by-file.)

---

## Out of scope (YAGNI)

- Auto-running `review` from `propose` (re-introduces the coupling; rejected).
- Collapsing the now-single-valued `--command` option away — keep it for structural clarity and
  future commands.
- Any default skill in the thin commands' `## Skills` sections — left empty for users to populate.
- Changes to the loop, findings format, or sandbox.

---

## Open Questions

- None.

---

## Decisions

A consolidated record of the choices made while designing this change.

1. **Thin `propose` + handoff, not full decouple or status quo.** `propose` becomes a thin wrapper
   that *suggests* `review`. *Rejected:* (a) fully silent decouple — `review` too easy to forget,
   loses the discoverable path; (b) keeping the auto-review loop in `propose` — keeps it "fat", with
   duplicated runner prose and no `## Skills` hook. (See **Motivation**, **Behavior**.)
2. **Relocate the harness to `review/` and rename to `runReviewHarness`.** `review` is now its sole
   owner, so the code lives there and the name stops lying. *Rejected:* leaving it in `propose/`
   under the old name — `propose` no longer uses it. (See **Engine — relocated**.)
3. **Remove the `propose` key from `HARNESS_RUNNERS`; keep `--command=review` only.** *Rejected:*
   keeping a dead `propose` dispatch path. (See **CLI dispatch**.)
4. **Empty `## Skills` section on all thin commands.** Add the header as an extension point (no
   default skill) to `propose`, and fold the same empty hook into `apply` and `archive` so every
   thin command is uniformly customizable (`explore` already has it). Users add skills per
   preference. *Rejected:* omitting the section (loses the hook / inconsistent with `explore`) and
   seeding a default skill (none is the obvious default). (See **Behavior**.)
5. **Keep `'propose'` in `CommandName`/`COMMAND_NAMES`/`tsup` `COMMANDS`.** It is still a
   user-facing command; only harness dispatch drops it. *Rejected:* removing it (would
   un-install the command). (See **Files NOT changed**.)
6. **No auto-chaining; handoff is a suggestion.** Matches the existing `explore → propose` idiom and
   keeps generation and review decoupled. (See **Non-Goals**.)
