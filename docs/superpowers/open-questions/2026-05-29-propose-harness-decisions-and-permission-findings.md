# Propose Harness — Decisions & Permission Findings (Session 2026-05-29)

**Status:** Active — design decided, sandbox needs rework, spec/plan edits pending.
**Continues:** [`2026-05-28-harness-artifact-trust-boundary.md`](./2026-05-28-harness-artifact-trust-boundary.md) (the "trust boundary" doc).
**Why this doc exists:** A long working session. This is the single place to re-load everything — what we decided, what we discovered, what's still open — so the next session can pick up seamlessly.

---

## TL;DR (read this first)

1. We committed to the **"enumerate the change folder"** restructure from the trust-boundary doc. Five design decisions are locked (see §2).
2. We reviewed that design and found several real issues (see §4). Most are cheap fixes folded into the plan. **One is foundational.**
3. The foundational one: we **empirically tested the permission sandbox** (`claude -p` probes) and proved the **current `permissions.ts` is non-functional** — with the committed config the agent can write *nothing at all*. The propose loop, as designed in Tasks 5/8, cannot run. (See §5 — this is the important part.)
4. **Decision:** rework the sandbox so the **temp workspace + selective copy-back is the real boundary**, and reduce Claude permissions to a coarse "don't write outside the workspace" guard. Acceptance must be a **real `claude -p` integration test**, not a JSON-shape unit test.
5. **Not yet done:** the exact "coarse guard" mechanism (one key spike remains — see §5.5), the spec update, and the plan revision.

---

## How to resume (next-session checklist)

1. Skim this whole doc (it's the recap). The original trust-boundary doc has the deeper *why* behind the restructure if needed.
2. ✅ **DONE (2026-05-30).** Ran the spike — see §5.6. Mechanism: `acceptEdits` + `cwd = workspace` is a two-way boundary; re-grant read with `additionalDirectories: [projectRoot]` and keep the project read-only with `deny: [Write/Edit(//c/<proj>/**)]` (MSYS `//c/` glob form on Windows); don't allow Bash; assert **file state** in tests.
3. ✅ **DONE (2026-05-30).** Spec updated: added "Trust Boundary" + "Workspace Isolation & Write Sandbox" sections, replaced `--artifacts` with `--change`, removed the broken `settings.json` example, refuted "Read is unrestricted," and updated the mermaid diagrams + Open Questions.
4. **Revise Plan 2** (`docs/superpowers/plans/2026-05-18-csi-opsx-propose-harness.md`) via the `writing-plans` skill: add the artifacts-module task, rework the permissions task (Task 5), revise Tasks 7/8/9, and add the integration-test + verification gates.
5. **Implement** (user types the code) with TDD, in the simple/step-by-step style.

---

## 1. The thread, in one paragraph

`csi-opsx` wraps OpenSpec and adds an automated reviewer→proposer loop for `propose`. Plan 2 (the harness) is **mid-flight at Task 6**; Tasks 7–9 are unbuilt — which is exactly where these changes land, so we get to fold them in rather than retrofit. The trust-boundary doc argued the harness should stop trusting a git-diff'd file list and instead treat **the change folder as the unit of review**. This session turned that argument into concrete decisions, reviewed them, and stress-tested the riskiest assumption (the write sandbox).

---

## 2. Design decisions locked this session

| # | Decision | Why (short) |
|---|----------|-------------|
| 1 | **Enumerate the change folder** — drop the `git status` snapshot/diff flow entirely. | Fixes the trust boundary *and* the "explore-written content never gets reviewed" gap in one move. Mostly *deletes* code. |
| 2 | **Enumeration runs in the harness; CLI takes `--change <name>`** (not `--artifacts <csv>`). | Deterministic (filesystem in → same list out, no LLM in the path-selection step) and the CLI never receives a path list to inject into. |
| 3 | **The skill resolves the change name via a cascade:** (a) explicit `/csi-opsx:propose <name>` → (b) the change it just created/continued via `/opsx:propose` this session → (c) scan active changes, ask the user if more than one. It always passes one concrete `--change`. | The orchestrating agent already knows the change it just made; the harness must stay non-interactive, so disambiguation happens in the skill. |
| 4 | **Matching is hand-rolled, no glob library.** Check 3 known filenames (`proposal.md`, `design.md`, `tasks.md`) for existence, plus one scan of `specs/` for `spec.md`. | The filenames are known; the only variable part is the capability sub-dirs under `specs/`. picomatch would solve a non-problem. |
| 5 | **`review-findings-N.md` lives *inside* the change folder** (`openspec/changes/<name>/review-findings-N.md`). | It's both the review history *and* the resumability state. Per-change location means the resume scan can't confuse one change's findings for another's. The enumerator naturally ignores findings (it only selects the 4 artifact types). |

**Artifacts that count** (relative to `openspec/changes/<name>/`): `proposal.md`, `design.md`, `tasks.md`, and any `specs/**/spec.md`. **Excluded:** `.openspec.yaml` (metadata) and the `review-findings-*.md` files themselves.

---

## 3. The design, file by file (consolidated)

> Note: the `writablePaths → settings.json` plumbing below is **superseded by §5** (the sandbox rework). Everything else stands.

| File | Change |
|------|--------|
| `src/lib/artifacts.ts` *(new)* | `enumerateChangeArtifacts(workspace, changeName)` → returns the artifact paths. Plus a `getChangeDir(workspace, name)` helper. **Must validate `changeName` is a single safe path segment** (see finding A). |
| `src/lib/__tests__/artifacts.test.ts` *(new)* | Unit tests: optional files present/absent, multiple capabilities, findings + `.openspec.yaml` correctly excluded, missing/empty change folder errors, `changeName` traversal rejected. |
| `src/commands/propose/harness.ts` | `HarnessOptions` → `{ workspace, changeName, maxRounds? }`. Enumerate once, then run the loop. Pass the **change dir** (not project root) to `findLatestFindingsRound`/`getFindingsPath`. Error if the change folder is missing or has zero artifacts. |
| `src/lib/loop.ts` | **No signature change** — already directory-parameterized. (Finish the two stubbed functions from Task 6.) |
| `src/commands/propose/agents.ts` (Task 7) | Findings filename in both prompts becomes the change-folder-relative path. Make prompts explicit: "edit the copies in your working directory, not the originals." |
| `src/bin/cli.ts` (Task 8) | `run` command: `--artifacts <csv>` → `--change <name>`; keep `--max-rounds`. |
| `src/commands/propose/SKILL.md` | Delete the git-snapshot/diff steps. New flow: resolve change name (cascade) → run `/opsx:propose` → `csi-opsx run --command=propose --workspace . --change <name> [--max-rounds=N]`. **Keep the empty-guard** (finding F). |
| `src/lib/runner/claude/permissions.ts` (Task 5) | **Rework** per §5 — current version is non-functional. |
| Spec `2026-05-18-csi-opsx-design.md` | Fix the wrong example; add "Trust Boundary" + "Write sandbox" sections. |
| Plan `2026-05-18-csi-opsx-propose-harness.md` | Add artifacts-module task; rework Task 5; revise Tasks 7/8/9; add integration test + verification gates. |

**Why the churn is small:** `workspace.ts` needs *no* change (it already copies by relative path, so nested paths "just work"), and `loop.ts` keeps its signatures. The restructure mostly deletes the diff dance and adds one focused module.

---

## 4. Design-review findings (whole-design pass)

Severity is "in the context of this project," not nit-picks.

| ID | Finding | Status / plan |
|----|---------|---------------|
| **A** | **Path traversal via `--change`.** We replaced an untrusted *path list* with an untrusted *change name*. `--change ..` would escape the change folder (e.g. resolve to `openspec/` and pull in the real apply-time specs). | **Fold in:** harness validates `changeName` matches `^[A-Za-z0-9._-]+$`, rejects `.`/`..`/separators, *before* building any path. |
| **B** | **Permission sandbox is non-functional.** Verified empirically. | **Rework** — this is §5. The big one. |
| **C** | **Stale-findings short-circuit on re-run.** Harness exits "complete" if the latest findings say `issues-found: 0`. But re-running `/csi-opsx:propose` after `/opsx:propose` modified artifacts would exit *without reviewing the new content*. | **Fold in:** a fresh invocation must start a new round and run the reviewer; don't treat a prior "0 issues" as "nothing to do." (Cheap: if truly unchanged, the reviewer returns 0 again and exits after one round.) |
| **D** | **Windows path separators.** Reconciled with §5: permission matching uses *absolute* paths, so the enumerator's relative paths are only for fs-copy and prompt text. Still: emit **forward slashes** there for prompt readability and cross-platform copy. | **Fold in** (minor). |
| **E** | **Writable set frozen at enumeration.** The proposer can't create a brand-new artifact (e.g. a missing capability spec) mid-loop. | **Decided: freeze it** (scope discipline). The reviewer should phrase such gaps as "add before applying," handled in a fresh propose pass. |
| **F** | **Don't lose the empty-guard** when deleting the SKILL.md diff steps: no change/zero artifacts → stop, don't invoke the harness. | **Fold in.** |
| **G** | **OpenSpec tolerance.** `openspec validate`/`apply`/`archive` may not expect `review-findings-*.md` inside the change folder. | **Verify early.** If it errors, fall back to a dedicated `.csi-opsx/` location for findings. |
| H/I/J | Full-folder re-review raises mild non-convergence risk (bounded by `maxRounds`); context-read redundancy (handled by clearer prompts in Task 7); `openspec list --json` fallback format unverified (prefer a robust directory listing in the skill cascade). | **Notes only.** |

---

## 5. Finding B — the permission investigation (the important part)

### 5.1 Why we probed
The trust-boundary doc flagged that the sandbox's behavior (does the allow-list work? does deny override allow? does `Write(*)` cover nested paths?) was **assumed, never tested** — the unit tests only assert the *shape* of `.claude/settings.json`, never run `claude -p`. We tested it for real.

### 5.2 How we probed (so we can resume probing if needed)
- `claude -p "<prompt>" --allowedTools ... --setting-sources project --permission-mode default --model haiku --max-budget-usd 1 --output-format json`
- The JSON result has a **`permission_denials`** array listing each denied tool call *with the exact path it tried* — that's the ground truth (don't infer from file existence; the model's behavior is noisy).
- **Caveat for future probes:** we ran in a `%TEMP%` dir that is *not* a git project. Claude Code's path-rule resolution may behave differently in a recognized project root, which likely explains why scoped *allow* rules never matched in our temp dir. Re-test inside a real project (or with `--add-dir`) before concluding about scoped-allow.

### 5.3 The four established facts (high confidence)
1. **The Write tool resolves paths to ABSOLUTE form.** The *relative* patterns `permissions.ts` emits (e.g. `Write(openspec/changes/x/proposal.md)`) **never match** — the engine sees `C:\…\proposal.md`.
2. **`deny: ["Write(*)"]` denies ALL writes and OVERRIDES allow** (deny wins; `*` is a catch-all). Proven: identical run wrote the file *without* the deny and was blocked *with* it.
3. **`--allowedTools Read,Write` blanket-allows Write to every path** — with no deny, the agent freely wrote a non-listed file (no scoping at all).
4. **`--allowedTools` ignores `Write(path)` specifiers** (bare tool names only), and **omitting `Write` from `--allowedTools` disables the Write tool entirely**, regardless of `settings.allow`.

### 5.4 The headline
Put facts 1 + 2 together against the committed `permissions.ts` (relative allow-list **plus** `deny: ["Write(*)"]`): the allow-list matches nothing **and** the deny blocks everything and wins. In the real harness config, **the agent can write nothing — the reviewer can't even create its findings file. The loop cannot run.** Unit tests are green because they only check JSON shape. *This is the structure-vs-behavior testing gap in its purest form.*

### 5.5 Decided direction + the one remaining spike
**Decision (your call): make the temp workspace the real boundary.**
- The harness already copies *only* enumerated artifacts *into* the workspace and copies *only* enumerated artifacts *back*. So anything the agent writes inside the sandbox that isn't an artifact is discarded — the copy-back list, not the permission engine, is what controls what reaches the real project.
- The only residual risk is the agent writing to an **absolute path outside the workspace** (real project files, secrets). That's what the "coarse guard" must prevent.

**KEY UNRESOLVED SPIKE (run this first next session):**
> With `cwd = workspace` and `--allowedTools Read,Write` and **no** settings restrictions, does a write to an absolute path **outside** the workspace get auto-denied?

- We proved a write *inside* the workspace succeeds (fact 3) but never tested an *outside* write under blanket Write.
- If Claude Code's default already scopes writes to the project/cwd (+`--add-dir`) and auto-denies outside writes in `-p` mode → **the workspace boundary is essentially free; `permissions.ts` can be deleted or reduced to almost nothing.** Best case.
- If outside writes are *not* auto-denied → we need an explicit guard, and we must find the working scoped-allow syntax (re-test in a real project root per §5.2, or consult Claude Code's permission docs directly rather than black-box probing).

**Acceptance criterion (non-negotiable):** a real `claude -p` integration test that proves (a) an allowed artifact write succeeds and (b) an out-of-workspace write is blocked. JSON-shape assertions are not enough — they're exactly what hid this bug.

### 5.6 RESOLUTION (2026-05-30) — spike run, mechanism found

We ran the spike (and several follow-ups) with real `claude -p`, reading both the JSON `permission_denials` array and the actual **file state** (CLI v2.1.158, on Windows).

**Established facts (in addition to §5.3):**

5. `--allowedTools Read,Write` blanket-allows writes to **every** path, including absolute paths *outside* the workspace. The §5.5 "best case" (a free boundary under blanket Write) is **false** — there is no implicit cwd jail under `--allowedTools`.
6. **`--permission-mode acceptEdits` + `cwd = workspace` is itself a two-way boundary:** inside-cwd writes (incl. nested dirs) auto-accept; outside-cwd **writes _and_ reads** are denied (→ auto-deny in `-p`). This **refutes the `CLAUDE.md` line** "agents read context from absolute paths… Read is unrestricted." Read is *not* unrestricted.
7. `additionalDirectories: [dir]` (≡ `--add-dir`) re-grants `dir` for **both read and write**, so it alone can't be a read-only context grant.
8. **Permission globs work on Windows only in MSYS form** — `//c/Users/…` (`//` prefix, drive letter as a **lowercase path segment with no colon**). The forms tried in Probe 3 (`//C:/`, `/C:/`, `C:/`, `C:\`) all silently fail to match — *that* was the Probe-3 mystery. Unix form: `//Users/…` (the absolute path with an extra leading `/`).
9. The **Bash tool is the only bypass** of a Write/Edit deny (it's path-agnostic). With no `--allowedTools`, Bash requires approval → auto-denied under `-p`, so the bypass is closed by default (verified).
10. **A `deny`-rule block leaves `permission_denials` EMPTY** (it's a pre-emptive block, not an interactive auto-deny). Ground truth for the block is the **file state** (file absent/unchanged), so tests must assert that.

**Adopted mechanism (the user's read-in-place + deny-write design):**

```
claude -p --permission-mode acceptEdits --setting-sources project   (cwd = workspace)
workspace/.claude/settings.json:
  permissions:
    additionalDirectories: [ <projectRoot> ]            # read project context in place
    deny: [ "Write(//c/<projectRoot>/**)",              # project is read-only…
            "Edit(//c/<projectRoot>/**)" ]              # …deny beats allow AND the mode
  (do NOT pass --allowedTools Bash → no shell-write bypass)
```

- Agent **reads** real project files (CLAUDE.md, openspec/specs/, docs/) in place — **no context copying needed.**
- Agent **writes** only inside the workspace; the harness still copy-backs only the enumerated artifacts.
- **`permissions.ts` is reworked, not deleted:** it must emit platform-correct absolute deny patterns (MSYS `//c/…` on Windows, `//…` on Unix) + `additionalDirectories`; this needs a small fs-path→glob helper.
- This *restores* the original "read context from absolute paths, no copying" architecture — but now the read scope is **explicit** (workspace + project via `additionalDirectories`) and writes to the project are **enforced** read-only, rather than assumed.

**Spike status: CLOSED.** Remaining work is documentation (spec), plan revision, and implementation — with the integration test asserting **file state**, per fact 10.

---

## 6. Open questions / TODO carried forward

1. **[Spike]** The §5.5 outside-write test — decides how simple the sandbox is.
2. **[Verify]** §4-G: does OpenSpec tolerate `review-findings-*.md` in the change folder?
3. **[Verify]** Skill cascade step (c): what does `openspec list --json` actually return? Prefer a plain directory listing of `openspec/changes/` as the robust fallback.
4. **[Design]** Exact "coarse guard" mechanism, pending the §5.5 result.
5. **[Confirm]** Is `design.md`/`tasks.md` always created or schema-conditional? The enumerator tolerates absence either way, but the harness must not *require* them.

---

## 7. Code & file state at end of session

- `src/commands/propose/harness.ts` — **still the stub** (`console.log('not yet implemented')`).
- `src/lib/artifacts.ts` — **does not exist yet.**
- `src/lib/loop.ts` — `parseIssuesFound` + `parseStatus` done; `findLatestFindingsRound` + `getFindingsPath` are **empty stubs** (mid-Task-6).
- `src/lib/runner/claude/permissions.ts` — exists but **proven non-functional** (relative allow + `deny: Write(*)`).
- `src/lib/workspace.ts` — fine; copies by relative path; **no change needed**.
- `src/commands/propose/SKILL.md` — **still uses the old git-status-diff flow** (Steps 1 & 3 to be deleted).
- `src/bin/cli.ts` — still uses `--artifacts <csv>`.
- Plan 2: `docs/superpowers/plans/2026-05-18-csi-opsx-propose-harness.md` (Tasks 7–9 unbuilt).
- Spec: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` (has the wrong artifact-path example; needs Trust Boundary + Write sandbox sections).

---

## 8. Cross-references

- Original analysis: [`2026-05-28-harness-artifact-trust-boundary.md`](./2026-05-28-harness-artifact-trust-boundary.md)
- Plan 2: `docs/superpowers/plans/2026-05-18-csi-opsx-propose-harness.md`
- Spec: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md`
- OpenSpec source skills consulted (artifact structure): the `openspec-explore` / `openspec-propose` `SKILL.md` files in the ReadyHands project.
