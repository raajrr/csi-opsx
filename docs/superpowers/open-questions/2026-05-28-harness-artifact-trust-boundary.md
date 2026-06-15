# Harness Artifact Trust Boundary

**Status:** Open — needs decision and implementation before harness ships to other users.
**Identified:** 2026-05-28
**Affects:** Task 8 (harness orchestration), Task 7 (agent prompts may reference wrong paths), Plan 2 spec, SKILL.md.
**Severity:** Medium-to-high. Mostly latent — the *normal* `/opsx:propose` flow doesn't produce sensitive artifacts, so the bug is exposure to edge cases (concurrent edits, mtime weirdness, misconfiguration). But the architecture *trusts* the artifact list rather than *verifying* it, which is a design smell worth fixing before the tool is used on projects containing secrets.

> **Update 2026-05-29:** This doc's direction was adopted and advanced. See [`2026-05-29-propose-harness-decisions-and-permission-findings.md`](./2026-05-29-propose-harness-decisions-and-permission-findings.md) for the locked design decisions and a major new finding — the write-permission sandbox was empirically proven **non-functional** (`claude -p` probes) and is being reworked. Start there to resume.

---

## TL;DR

The propose harness blindly trusts the artifact list passed to `csi-opsx run --artifacts <csv>` and (1) copies every file in that list into a temp workspace, (2) grants the agent Write access to each, and (3) copies any modifications back to the project. None of these steps verify that the listed files are actually OpenSpec propose artifacts. If a sensitive file (e.g. `.env`, a key file, a config containing secrets) ever ends up in the artifact list — whether by mtime accident, concurrent edit during propose, or future change to OpenSpec's output — it flows through all three steps with no safety check.

The proposed fix is an **allowlist of known propose-artifact path patterns**, applied inside the harness immediately after parsing `--artifacts`, before any other operation. Anything not matching is silently dropped (with a log line for transparency).

---

## How the issue was discovered

While walking through how `.claude/settings.json` write restrictions work, the conversation turned to whether the user's existing user-level Read denies (in `~/.claude/settings.json`) would protect sensitive files. The trace surfaced that:

1. Read denies *might* apply, depending on Claude's permission precedence — fragile.
2. More importantly, the harness's `createWorkspace` step uses Node's `fs.copyFileSync` — which doesn't consult Claude's permission system at all. The file content is materialized in the temp workspace before any permission check happens.
3. The harness's `writePermissions` step writes `Write(<filename>)` allow rules for every artifact — potentially colliding with the user's user-level deny rules. Precedence resolution determines who wins.
4. `copyBack` mirrors everything in the workspace back to the project, propagating any agent modifications.

Result: anything in the artifact list is treated as fair game. No structural safety check exists.

---

## Where the exposure lives — three layers

### Layer 1: Copy-in bypasses Claude's permission system entirely

`createWorkspace` uses `fs.copyFileSync` — a plain Node OS operation. Whatever is in the artifact list lands in the temp workspace before any permission engine has a vote. Even if the user has `Read(secret.md)` denied at the user level, the harness has already produced a copy.

This means: a file the user did not want the agent to see now exists outside the project, on disk in a tmp directory. The agent's Read deny rule *may* still prevent reading from that location (depending on whether the pattern matches the new path), but the bytes are physically present.

### Layer 2: Temp workspace settings collide with user-level denies

`writePermissions` writes `allow: ["Write(secret.md)", ...], deny: ["Write(*)"]` into the workspace's `.claude/settings.json`. The user may have `deny: ["Write(secret.md)"]` in `~/.claude/settings.json`.

What happens when both apply depends on Claude Code's permission precedence:
- If deny-wins-over-allow across settings layers (likely), the user is protected.
- If more-specific-wins (project-level allow overrides user-level deny), the user is exposed.

We are *outsourcing* safety to the permission engine without verifying it favours the user's deny. This is fragile because:
- Precedence rules may change between Claude versions.
- Different pattern shapes (absolute path vs filename glob vs subdir) resolve differently.
- We don't currently assert or test this resolution.

### Layer 3: Copy-back propagates anything in the workspace

`copyBack` re-copies every artifact from the temp workspace back to the project. If the agent *did* manage to write to `secret.md` (because permissions resolved the wrong way, because of a tool variant that bypassed checks, because of prompt injection), the modified content gets copied back. If the agent didn't touch it, the copy is a no-op-rewrite — but still a write to the project filesystem and a possible mtime bump.

---

## Why this is a real concern (the threat model)

Two distinct concerns sit behind the layers above:

| Concern | When it matters | Worst case |
|---|---|---|
| **Read exposure** | File contains secrets the model shouldn't see (API keys, credentials, sensitive prompts) | Model has the content in its context; could echo it in findings or proposed changes; copy of file exists on disk in temp location for the run's duration |
| **Write exposure** | File's content matters and must not be altered | Silent corruption — sensitive file modified by the agent and propagated back to the project |

The Read exposure is the subtler and more important one. Even if Claude perfectly denies the Read at the agent level, the file *existed* in the temp workspace. The bytes were copied. That copy is a real artifact, however brief.

---

## What is *not* a defense (and why)

A few things that might seem like protections but aren't sufficient:

- **"User-level deny rules will catch it"** — partially. They only catch the agent's *tool* attempts (Read, Write). They don't prevent our `copyFileSync`. And their effectiveness depends on Claude's precedence rules favouring the user.
- **"Sensitive files won't normally be in the artifact list"** — true in normal flow but not guaranteed. Concurrent edits, IDE save bumps, weird file system timestamps — any of these could land a sensitive file in the mtime diff. The architecture should not rely on "normal flow" for safety.
- **"The temp dir is in `tmpdir()` with user-only permissions"** — true for confidentiality from other OS users, but irrelevant to the concern that the *model itself* processed the content.

---

## Solutions considered

Five directions, increasing in scope:

### Option A: Project-level exclude file (`.csi-opsx-ignore`)

A file at the project root lists patterns that should never enter the harness loop (gitignore-like).

**Pros:** Simple, explicit, transparent. Familiar pattern. Zero dependency on Claude's permission engine.
**Cons:** Users have to know to set it. Pure denylist — only as good as the author's threat imagination.

### Option B: Sensible-default exclude patterns + Option A

Ship the harness with a built-in default exclude list (`.env`, `.env.*`, `*.key`, `*.pem`, `.git/**`, `node_modules/**`, `secrets/**`, `credentials/**`, `.ssh/**`, `*.pfx`, `*.p12`), with Option A as an additive opt-in for project-specific patterns.

**Pros:** Safe-by-default for the common cases.
**Cons:** Heuristic is never complete; false negatives are silent. Users may want to opt *out* of defaults occasionally.

### Option C: Consult Claude's existing settings before copy-in

Parse `~/.claude/settings.json` and project `.claude/settings.json` before copy-in. If the user has a Read or Write deny on an artifact, exclude it.

**Pros:** Reuses the user's existing trust posture; no new config to learn.
**Cons:** Permissions parsing is non-trivial; pattern semantics (glob vs absolute) need careful interpretation; adds a dependency on Claude's settings format remaining stable.

### Option D: Architectural shift — never copy, always read by absolute path

Reframe how the agent gets at artifacts:
- **Reviewer:** already reads context from absolute project paths. Has it write *only* `review-findings-N.md` in the temp workspace. No artifacts copied in.
- **Proposer:** writes its changes to a different output format (e.g., `proposed-changes.json` or a unified diff in the workspace), which the harness applies back to the project file-by-file. Each apply is auditable; sensitive files can be skipped at apply time.

**Pros:** The cleanest architecture. No sensitive content ever materializes outside the project. The user's existing Read/Write rules on the project files apply uniformly to the agent.
**Cons:** Significant refactor. Proposer's output shape changes from "modified files" to "patch instructions." Patch parsing and application add complexity.

### Option E: Allowlist of known propose artifacts (the recommended fix)

Instead of trusting the mtime-snapshot-diff to determine artifacts, intersect that diff with a built-in allowlist of paths that match what `/opsx:propose` actually produces. The harness filters before any workspace operation.

**Pros:**
- **Allowlist beats denylist for unknown-threat scenarios** — correct-by-default rather than depending on enumeration of bad things.
- **Single source of truth** — the patterns live in one constant.
- **No new user config** — safety is invisible by default.
- **No dependency on Claude's permission engine** — sensitive files never reach the temp workspace at all.
- **Self-documenting contract** — the patterns *are* the trust boundary.

**Cons:**
- The patterns must be correct and kept current with OpenSpec's output structure.
- If OpenSpec adds a new artifact type, csi-opsx needs an update before that artifact participates in the loop.

---

## Why Option E is preferred

It moves the safety check to the most upstream point possible — *selection*. Instead of:

```
[opaque file list] → copy → permission engine → copy back → hope
```

It becomes:

```
[opaque file list] → allowlist filter → [vetted files] → copy → ...
```

Sensitive content can't even *get into the system*. Every downstream layer (workspace, permissions, copyBack) operates on data that's already been vetted. That's a categorically different posture than "downstream layers might catch it."

This is the same principle behind:
- `--allowedTools Read,Write` being an allowlist not a denylist
- Type-safe deserialisation at HTTP boundaries
- Capability passing in OS design
- Prepared statements vs string concatenation

In each case, constraining inputs aggressively at the system boundary collapses whole classes of downstream defensive-coding cost.

Compared to the other options:
- (A) `.csi-opsx-ignore` and (B) sensible defaults are denylists — only as good as the author's threat imagination.
- (C) Reading Claude's settings is implicit and engine-dependent.
- (D) Never-copy is the cleanest end state but a much larger refactor; (E) achieves ~90% of (D)'s safety properties with ~10% of the work.

---

## OpenSpec's actual artifact structure (verified from skills)

After reading `D:\Development\Personal Projects\ReadyHands\.claude\skills\openspec-explore\SKILL.md` and `D:\Development\Personal Projects\ReadyHands\.claude\skills\openspec-propose\SKILL.md`, the structure is clearer than the existing csi-opsx design spec suggested.

`/opsx:propose` creates a change folder and populates it:

```
openspec/changes/<change-id>/
├── .openspec.yaml         ← metadata (scaffolded by `openspec new change`)
├── proposal.md            ← what & why
├── design.md              ← how (sometimes — depends on schema's apply.requires)
├── tasks.md               ← implementation steps
└── specs/                 ← delta specs against existing capabilities
    └── <capability>/
        └── spec.md
```

Key observations:

1. **All artifacts live under `openspec/changes/<change-id>/`** — never at the project root.
2. **The csi-opsx design spec's example showing root-level `proposal.md`/`design.md`/`tasks.md` plus `openspec/specs/auth.md` is wrong.** Spec deltas during propose are under `openspec/changes/<id>/specs/<capability>/spec.md`, not `openspec/specs/<capability>.md`. The `openspec/specs/...` path is only modified at *apply* time (when changes are promoted), and `/csi-opsx:apply` is a passthrough — not in the harness scope.
3. **`spec.md` is the standard basename** for per-capability specs, in a per-capability subdirectory. The existing csi-opsx example's `auth.md` basename is non-standard.
4. **`.openspec.yaml` is metadata, not an artifact for review.** It's scaffolding for OpenSpec itself. Should be excluded from the harness loop.
5. **`design.md` is conditional** — only present when the schema's `apply.requires` includes it. The whitelist should accommodate its absence.
6. **`tasks.md` is conditional similarly** — actually, looking at `openspec-propose` step 4b, `applyRequires` is the gate.

This means the existing csi-opsx Task 7 agent prompts (which reference `${artifactsDir}/openspec/specs/`) and the spec's example output also need updating. The trust boundary fix and the path-correctness fix are coupled.

---

## Concrete proposal

### The allowlist patterns

```ts
// src/lib/artifacts.ts (new module)

/**
 * Path patterns that match files /opsx:propose can legitimately produce or modify.
 * Used to filter the artifact list before any workspace operation, so files that
 * happen to appear in the mtime diff but aren't propose artifacts never enter the
 * harness loop.
 *
 * Patterns use glob syntax: `*` matches a single path segment, `**` matches any depth.
 * Paths are relative to the project root.
 *
 * Maintenance: update this list when OpenSpec adds a new artifact type. The
 * trust boundary depends on the list being current.
 */
export const PROPOSE_ARTIFACT_PATTERNS: readonly string[] = [
    'openspec/changes/*/proposal.md',
    'openspec/changes/*/design.md',
    'openspec/changes/*/tasks.md',
    'openspec/changes/*/specs/**/spec.md',
] as const;

export function filterToKnownArtifacts(paths: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const p of paths) {
        if (PROPOSE_ARTIFACT_PATTERNS.some(pattern => matchesGlob(p, pattern))) {
            kept.push(p);
        } else {
            dropped.push(p);
        }
    }
    return { kept, dropped };
}
```

**Excluded by design:**
- `.openspec.yaml` — metadata, not for review
- Anything at the project root (`proposal.md`, `design.md`, etc. at root) — does not match OpenSpec's actual structure
- Anything under `openspec/specs/` directly — those are modified at apply time, not propose time

### Where the gate lives — strong preference for the harness

Two options:
- **In SKILL.md:** the skill filters before invoking `csi-opsx run`.
- **In the harness:** `csi-opsx run` filters internally regardless of what it was given.

**Put it in the harness.** Three reasons:

1. **Single source of truth.** One constant in one file. Future agent-specific skills (Cursor, Gemini variants) don't need to reimplement.
2. **Defense in depth, not delegation.** A skill is an instruction document the agent follows. If the agent skips the filter step or misunderstands, sensitive files flow through. A CLI-side filter is structural — it runs regardless of agent behaviour.
3. **Auditable behaviour.** The CLI can log dropped files: `"skipped foo.md — not a known propose artifact pattern"`. The user sees explicitly what was excluded.

The skill can optionally do its own sanity filter for early feedback (so the user sees the right list before the CLI runs), but the harness's filter is the *enforced* one.

### Implementation outline

1. **Create `src/lib/artifacts.ts`** with `PROPOSE_ARTIFACT_PATTERNS` and `filterToKnownArtifacts`. Add tests in `src/lib/__tests__/artifacts.test.ts`.
2. **Wire it into the harness.** Call `filterToKnownArtifacts(artifacts)` at the top of `runProposeHarness` in `src/commands/propose/harness.ts`. Use the `kept` list for everything downstream; log the `dropped` list.
3. **Update Task 8 in the plan** to include this filter as a sub-step.
4. **Fix Task 7 agent prompts** if they reference `openspec/specs/` for propose-time reads — they should reference `openspec/changes/<id>/specs/` or the change folder directly. (This is a separate path-correctness fix, but discovered during the trust boundary review.)
5. **Update the spec.**
   - Fix the example output (`openspec/specs/auth.md` → `openspec/changes/<id>/specs/<capability>/spec.md`).
   - Add a "Trust Boundary" section under File Access Enforcement describing the allowlist and what's excluded.
6. **Update SKILL.md** to document that the harness applies a structural filter; the skill itself can pass the raw diff.
7. **Consider a glob-matching dependency** vs. hand-rolled matcher. `picomatch` is the standard lightweight choice and is already a transitive dep of Vitest. Or roll a small matcher for the patterns we use (they're simple enough — `*` between slashes and `**` for any depth).

### What this does NOT cover

**Content-level exposure within whitelisted files.** If a user types an API key into a `proposal.md` during the propose conversation, that key is now in scope for the agent. The whitelist doesn't help — `proposal.md` is on the list.

Defenses for this are different:
- Prompt-level guidance ("never echo verbatim content from artifacts in your output").
- User discipline (don't paste secrets into spec files).
- Optional: post-hoc redaction pass before findings are written.

This is a different threat model — secrets *inside* intended artifacts — and is much smaller in surface area than "any file the diff happened to catch." Leave out of scope for the trust boundary fix. Worth a separate note if we want to harden further.

---

## Open questions for the next session

1. **Verify the exact `applyRequires` set.** The propose skill's step 4 says artifacts are determined by the schema's `apply.requires`. Confirm: is `design.md` always created or schema-conditional? If conditional, the whitelist tolerates its absence (no problem) but the harness shouldn't *require* it either.

2. **Should we also include changes to `openspec/specs/**/spec.md` directly?** Looking at the OpenSpec workflow more carefully:
   - `/opsx:propose` writes deltas to `openspec/changes/<id>/specs/<capability>/spec.md`.
   - `/opsx:apply` (passthrough — not in harness) promotes those deltas to `openspec/specs/<capability>/spec.md`.
   - So during propose, only the change folder is touched. Confirmed.
   - But what if the user is *modifying* an existing change mid-propose? Same paths apply.

3. **Pattern matcher: dependency or hand-roll?** `picomatch` is ~5KB and battle-tested. A hand-rolled matcher for 4 patterns is ~30 lines but project-specific. Probably picomatch is the right call but worth a moment's thought.

4. **What does the harness do with `.openspec.yaml`?** Currently excluded from the whitelist (correctly), but it's also not something the agent should modify. If it ever appears in the diff (it shouldn't, after change creation), we just drop it.

5. **Where exactly does the path-correctness fix for Task 7 land?** The agent prompts in the plan's Task 7 reference `${artifactsDir}/openspec/specs/`. Those should be `${artifactsDir}/openspec/changes/<change-id>/` or just point at the change folder. This is a separate but coupled fix.

6. **Should the harness validate that every artifact is inside the same change folder?** I.e., are we processing one change at a time? OpenSpec's `/opsx:propose` creates a single change, so yes — but the harness should probably assert this rather than handling cross-change artifact lists silently.

7. **Logging of dropped files: where does it go?** stdout? A log file? A console.warn? The user needs to see it but it shouldn't drown the normal output.

8. **Should we also gate copy-back independently?** Even if a file passes the input filter, copy-back could fail closed if the file in the temp workspace doesn't match a writable-back pattern. Belt-and-braces — probably overkill if input is already filtered, but worth considering.

---

## What to do in the next session

Open this doc by name (`2026-05-28-harness-artifact-trust-boundary.md`) for the recap. The session should:

1. **Read the TL;DR and "Concrete proposal" sections** to re-load the context.
2. **Decide on the open questions above** (especially the path-correctness fix scope and glob matcher choice).
3. **Update the plan and spec** to incorporate the allowlist as part of Task 8 (or a new sub-task between Task 7 and Task 8 if the path-correctness fix to agent prompts also lands).
4. **Implement the artifacts module** with TDD discipline as usual.
5. **Update SKILL.md and the spec** to document the trust boundary explicitly.

---

## Cross-references

- Conversation captured in second-brain: `C:\Users\Raaj\Documents\second-brain\raw\csi-opsx\runner-encapsulation-and-plan-craft-2026-05-28.md` (touches related design ideas but not this specific issue).
- Plan: `docs/superpowers/plans/2026-05-18-csi-opsx-propose-harness.md` (Tasks 7 and 8 affected).
- Spec: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` (File Access Enforcement section needs trust-boundary description).
- OpenSpec source skills consulted: `D:\Development\Personal Projects\ReadyHands\.claude\skills\openspec-explore\SKILL.md`, `D:\Development\Personal Projects\ReadyHands\.claude\skills\openspec-propose\SKILL.md`.

---

## Addendum (2026-05-28): `/opsx:explore` generates artifacts too — and the propose flow misses them

### Verification: explore can create and modify the same artifact files

Re-reading `D:\Development\Personal Projects\ReadyHands\.claude\skills\openspec-explore\SKILL.md` confirms it:

- **Explicit permission to create**: *"You MAY create OpenSpec artifacts (proposals, designs, specs) if the user asks—that's capturing thinking, not implementing."*
- **Explicit capture table** maps insight types to the same four artifact types propose handles:
  - Design decision → `design.md`
  - Scope changed → `proposal.md`
  - New work identified → `tasks.md`
  - New requirement → `specs/<capability>/spec.md`
- **Can kick off a new change**: *"This feels solid enough to start a change. Want me to create a proposal?"*
- **Can modify mid-implementation**: in the "User is stuck mid-implementation" example, explore offers *"Want to update the design to reflect this? Or add a spike task to investigate?"*
- **Ending discovery** explicitly lists *"Updated design.md with these decisions"* as a result.

So explore is *not* a thinking-only modality. It can write to the same files as propose, both creating new changes and modifying existing ones. The current csi-opsx design treats `/csi-opsx:explore` as a passthrough with no harness — that's a defensible scope decision (explore is meant to be lightweight) but it has consequences for `/csi-opsx:propose`.

### Where the current propose flow breaks

The current `/csi-opsx:propose` SKILL.md uses `git status --porcelain` snapshots before and after `/opsx:propose` to discover artifacts:

```
Step 1: snapshot git status --porcelain
Step 2: run /opsx:propose
Step 3: snapshot git status --porcelain
Step 4: diff → "filenames that appear in step 3 but not step 1 are the artifacts"
```

This flow assumes propose is the only source of artifact changes in the relevant window. With explore in the picture, that assumption fails in three concrete scenarios:

**Scenario A — explore creates files, user commits, then propose.**
- Explore creates `openspec/changes/<id>/proposal.md`. User commits it.
- `/csi-opsx:propose` invoked. Step 1 snapshot shows clean tree.
- `/opsx:propose` adds `design.md` and `tasks.md`. Step 3 snapshot shows those as new.
- Diff catches only `design.md` and `tasks.md`.
- **`proposal.md` is never reviewed.** The reviewer can read it as context (Read is unrestricted) but cannot include it in writablePaths, and the proposer cannot modify it if the reviewer finds an inconsistency.

**Scenario B — explore creates files, user does NOT commit, then propose.**
- Explore creates `proposal.md` (status `??` — untracked).
- `/csi-opsx:propose` invoked. Step 1 snapshot already shows `?? proposal.md`.
- `/opsx:propose` modifies `proposal.md` and adds `tasks.md`. Step 3 shows `?? proposal.md` (same entry) and `?? tasks.md`.
- Diff (by filename appearance) catches only `tasks.md`. `proposal.md`'s status line is unchanged, so the diff misses it.
- **proposal.md — which now contains both explore's *and* propose's content — is never reviewed.**

**Scenario C — repeat invocations of `/csi-opsx:propose` on the same change.**
- This one actually works correctly under the current flow because modifications change git status (`M ` vs ` M`). Captured in the diff as expected.

So the failure mode is specifically: **anything explore wrote and propose didn't subsequently touch escapes the review loop.** That's potentially a lot of content — explore is meant to be where the thinking lives, so the *most thought-through* parts of an artifact may be the parts that never get reviewed.

### Why this is more than just a missed-review problem

It also worsens the trust-boundary issue. The current SKILL.md flow's mtime/status diff was already shaky (mtime weirdness, IDE save bumps). The explore-contribution gap is another vector: now we can have files in the change folder that:

- Should be in the review loop (they're artifacts in active development)
- Aren't in the artifact list (the diff missed them)
- Could contain anything the explore conversation captured

This breaks the contract the harness implicitly offers: "your change folder gets reviewed before you apply." Instead, only *propose-deltas* get reviewed.

### Recommended flow change: enumerate the change folder, don't diff

The cleanest fix collapses both this issue and the trust boundary into one move. Instead of "diff git status to find artifacts," do:

```
Step 1: Determine the active change name
   - Either from user input (/csi-opsx:propose <change-name>)
   - Or via `openspec list --json` to find the most-recently-modified active change
   - Or, after Step 2, by parsing /opsx:propose's output

Step 2: Run /opsx:propose behavior
   - /opsx:propose either creates or continues the named change
   - It produces/modifies files inside openspec/changes/<change-name>/

Step 3: Enumerate artifacts
   - Walk openspec/changes/<change-name>/ and select files matching:
     - proposal.md
     - design.md
     - tasks.md
     - specs/**/spec.md
   - Skip .openspec.yaml (metadata)
   - This is the artifact list

Step 4: Check for runner (unchanged)

Step 5: Delegate to harness with the enumerated list
   csi-opsx run --command=propose --workspace . --artifacts <enumerated-list>
```

**Properties of this flow:**

- **Catches explore contributions** — anything in the change folder is in scope, regardless of who wrote it or when.
- **Catches multi-invocation work** — if propose has been run multiple times, the entire current state is reviewed.
- **Robust to mtime/status weirdness** — no diff, no snapshot, no mtime involved. We look at what's *there*.
- **Enforces the trust boundary by construction** — only files inside `openspec/changes/<change>/` and matching artifact patterns get into the harness. The allowlist is no longer just a filter — it's the *enumeration*.
- **Self-documenting contract** — "the harness reviews the artifacts in your change folder" is a much clearer mental model than "the harness reviews what propose just changed."

### Trade-offs

- **Active change name discovery** becomes a step the skill needs to handle. Options:
  1. Require it as an argument: `/csi-opsx:propose <change-name>`.
  2. Detect via `openspec list --json` (active changes have schema/status fields).
  3. Parse /opsx:propose's output, which mentions the change name it created/used.
  4. After Step 2, look at `openspec/changes/` for the most-recently-modified directory.
  - I'd lean (2) or (3). They require less of the user. (4) is fragile to timestamps.

- **Re-review of unchanged files** — if propose only touched `tasks.md` but the change folder also has `proposal.md` and `design.md` from earlier, the harness will review all three each time. The reviewer might note "nothing to flag" for the unchanged files. Cost: extra `claude -p` cycles on each round. Mitigation: the reviewer is cheap relative to the proposer; if zero issues, the loop exits in one round.

- **`/csi-opsx:explore` is still a passthrough.** The flow change is in propose, not explore. Explore remains lightweight. The user must invoke `/csi-opsx:propose` to get review. That's a reasonable boundary — propose is the "ready to formalize" gate.

- **`/csi-opsx:explore` could optionally evolve** to also offer a "review now" path (e.g., if explore made substantial artifact changes, surface a prompt: "I've updated 3 files. Run /csi-opsx:propose to review?"). Out of scope for this fix.

### Other paths considered

- **Add a /csi-opsx:explore harness.** Mirror propose's design for explore. Heavier; doesn't address the *propose-time* gap (propose still needs to know what to review when its turn comes); explore is meant to be lightweight.
- **Snapshot since last commit (`git diff HEAD --name-only`).** Catches all uncommitted changes including explore's, but also catches *unrelated* changes (code edits, doc updates, etc.). Too noisy.
- **Snapshot since last harness run.** Requires state management; complex; brittle.
- **Content-aware diff.** Hash files before and after; catches modifications-to-modified-files; still misses files explore touched that propose didn't.

The enumerate-the-change-folder approach dominates these on safety, simplicity, and trust-boundary cleanliness.

### Implementation notes

- The `PROPOSE_ARTIFACT_PATTERNS` array described earlier becomes the *enumeration filter* rather than just an input-validation filter. Same patterns, used at a different point in the pipeline.
- `src/lib/artifacts.ts` likely gains an `enumerateChangeArtifacts(workspace: string, changeName: string): string[]` function alongside `filterToKnownArtifacts`.
- The SKILL.md update is moderate — three steps change (1, 3, 5).
- The plan's Task 8 may not need to change much (the harness's job is unchanged; it just gets a different artifact list from upstream). But Task 7 agent prompts likely need to reference `openspec/changes/<id>/` rather than `openspec/specs/` for current context.
- The discovery mechanism (active change name) is the only piece that needs design work. Suggest researching what `openspec list --json` actually returns in a session before committing to a design.

### Updated open questions (additions to the list above)

9. **Where does active-change-name discovery live?** In the skill (parses `openspec list --json` itself), or in the harness (an `--active` flag that does the discovery internally)? Skill-side is more transparent; harness-side is more auditable.
10. **What happens if multiple changes are active simultaneously?** OpenSpec allows this. The skill probably needs to ask the user which one to review.
11. **Should `/csi-opsx:explore` get a lightweight nudge to invoke `/csi-opsx:propose` after substantive artifact changes?** Out of scope, but worth noting.
12. **Does the path-correctness fix (Task 7 agent prompts referencing `openspec/specs/`) become more or less urgent under the new flow?** Probably more urgent — the new flow makes the change folder the canonical artifact location, so prompts should align with that.

### Updated recap markers

The recap in the next session should cover *both* halves of this document:

1. The original trust-boundary issue (copy-in / settings collision / copy-back).
2. The flow restructure (enumerate change folder, don't diff).

Both halves point at the same architectural answer: **the change folder is the unit of review**. Treating it that way explicitly fixes both the safety concern and the missed-explore-content concern in one move.
