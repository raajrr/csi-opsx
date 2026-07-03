# csi-opsx Design Spec

**Date:** 2026-05-18  
**Status:** Living — updated in place as the system evolves (last sync: 2026-07-03)  

---

## Overview

`csi-opsx` is an npm package that wraps OpenSpec to extend its workflow with automated review loops, grilling behavior during exploration, and agent-agnostic skill distribution. The developer experience mirrors OpenSpec: skills are invoked from within a coding agent session and no separate terminal is needed.

---

## Goals

- Automate the manual proposer/reviewer cycle that currently follows `/opsx:propose`
- Add relentless grilling to the explore phase (Matt Pocock's `grill-me`), delivered through a general per-command skill mechanism so any phase's behavior can be customized by attaching skills
- Replace `openspec init/update` with `csi-opsx init/update` as the single entry point for the full workflow
- Be agent-agnostic for skill installation; Claude-first for harness execution with graceful fallback
- Be extensible: adding new wrapper commands or runner adapters should be low-friction

---

## Non-Goals

- Forking OpenSpec or maintaining its source code
- Implementing runner adapters for non-Claude agents in this iteration
- Modifying OpenSpec's artifact formats or schemas

---

## Package Identity

- **npm package name:** `csi-opsx`
- **CLI binary:** `csi-opsx`
- **Skill namespace:** `/csi-opsx:explore`, `/csi-opsx:propose`, `/csi-opsx:apply`, `/csi-opsx:archive`, `/csi-opsx:review`
- **OpenSpec dependency:** regular dependency (not peer), so `npm install -g csi-opsx` installs OpenSpec automatically
- **Language:** TypeScript, compiled to ESM via `tsup`
- **Source root:** `src/` — compiled output goes to `dist/` (gitignored)
- **`package.json` bin field** points to `dist/bin/cli.js` (compiled output, not source)

---

## Package Structure

```
csi-opsx/
  package.json              ← bin: { "csi-opsx": "./dist/bin/cli.js" }
  tsconfig.json
  src/
    bin/
      cli.ts                ← entry: init, update, run subcommands
    commands/
      explore/
        SKILL.md            ← behavioral instructions (agent-neutral, asset not compiled)
      propose/
        SKILL.md            ← behavioral instructions (agent-neutral, asset not compiled)
      apply/
        SKILL.md            ← behavioral instructions (asset, not compiled)
      archive/
        SKILL.md            ← behavioral instructions (asset, not compiled)
      review/
        SKILL.md            ← behavioral instructions (agent-neutral, asset not compiled)
        agents.ts           ← ReviewerAgent + ProposerAgent prompt builders
        harness.ts          ← reviewer→proposer loop orchestration (runReviewHarness)
    lib/
      types.ts              ← ToolId, CommandName, AgentRole union types
      tools.ts              ← tool-id → skillsDir mapping (mirrors OpenSpec AI_TOOLS)
      tool-detection.ts     ← detects which agents are configured via OpenSpec skill files
      adapters/
        types.ts            ← SkillAdapter interface
        claude.ts           ← command file path + format for Claude Code
        index.ts            ← adapter registry + getAdapter() lookup
      install.ts            ← installSkills / installCommands / installThirdPartySkills
      runner/
        types.ts            ← Runner interface, RunnerOptions, RunnerResult
        index.ts            ← resolveRunner(): detects available runner
        claude/
          cli.ts            ← ClaudeCliRunner: spawns claude -p (acceptEdits, cwd=workspace); calls writePermissions internally
          permissions.ts    ← Claude-specific: builds deny-only .claude/settings.json (project write-deny rules; read grant is the --add-dir flag) + fs-path→glob helper
      artifacts.ts          ← change-name validation + deterministic artifact enumeration
      workspace.ts          ← temp dir creation, file copying, cleanup, orphan sweep
      loop.ts               ← review-findings-N.md frontmatter parsers (issues-found, status, latest round)
    skills/
      grill-me/
        SKILL.md            ← bundled third-party skill (Matt Pocock's grill-me; attribution line)
  dist/                     ← compiled output (gitignored)
    skills/                 ← third-party skill directories copied here by tsup onSuccess
```

**Build scripts (`package.json`):**
```json
{
  "scripts": {
    "build":      "tsup",
    "typecheck":  "tsc --noEmit",
    "dev":        "tsup --watch",
    "test":       "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsup":       "^8.0.0",
    "@types/node": "^20.0.0",
    "vitest":     "^1.0.0"
  }
}
```

`SKILL.md` files are markdown assets — `tsup` is configured to copy them into `dist/` alongside the compiled output so `csi-opsx init` can find them at runtime. The `onSuccess` hook also discovers all directories under `src/skills/` and copies each one wholesale to `dist/skills/`, preserving the directory structure so any co-located support files a skill ships remain alongside its `SKILL.md`.

---

## CLI Commands

### `csi-opsx init`

1. Runs `openspec init` (delegates fully, stdio inherited)
2. Detects which agents OpenSpec configured by scanning for `{toolDir}/skills/openspec-*/SKILL.md` files
3. For each detected agent:
   - Copies `commands/*/SKILL.md` → `{toolDir}/skills/csi-opsx-{name}/SKILL.md`
   - Generates command file via agent adapter → agent-specific command path
   - Copies each `dist/skills/{name}/` directory → `{toolDir}/skills/{name}/` (third-party skills; all files preserved)
4. Reports installed agents and skill paths

```mermaid
flowchart TD
    A([csi-opsx init]) --> B[openspec init\nUser selects agents interactively]
    B --> C[Scan project directories\nfor openspec-star/SKILL.md files]
    C --> D["Detected agents\ne.g. claude, cursor, gemini"]
    D --> E{For each\ndetected agent}
    E --> F["Copy commands/*/SKILL.md\n→ toolDir/skills/csi-opsx-name/SKILL.md"]
    F --> G[Generate command file\nvia agent adapter]
    G --> J["Install third-party skills\ndist/skills/* → toolDir/skills/name/"]
    J --> H{More\nagents?}
    H -- Yes --> E
    H -- No --> I([Report installed agents\nand skill paths])
```

### `csi-opsx update`

1. Runs `openspec update` (refreshes `/opsx:*` skills; does not touch `/csi-opsx:*` skills)
2. Re-runs the skill installation step from `init` (idempotent)

### `csi-opsx run --command=review --workspace=<path> --change=<name> [--max-rounds=<n>]`

Internal subcommand. Called by the `/csi-opsx:review` skill via Bash. Not intended for direct developer use. *(Was `--command=propose` until 2026-06-19 — see `2026-06-19-thin-propose-design.md`; the CLI now rejects that value.)*

- `--change`: the name of the change folder to review (e.g. `add-auth`). The harness enumerates `openspec/changes/<name>/` itself to build the artifact list — see **Trust Boundary**. The name must be a single safe path segment.
- `--max-rounds`: *(optional)* the number of reviewer→proposer rounds to run **this invocation**. On a resume these are added to the rounds already completed — a resume-relative budget, not an absolute round-number ceiling (see `2026-06-25-review-max-rounds-resume-design.md`). Defaults to 5 when omitted. Must be ≥ 1.
- Resolves runner, enumerates the change folder, executes the reviewer→proposer loop, prints summary on exit

---

## Skill Behavior

### `/csi-opsx:explore`

Runs `/opsx:explore` behavior and loads whatever skills its `## Skills` section lists. Today that is Matt Pocock's `grill-me` (see **Skill Customization** for how the mechanism works and why it replaced `grill-with-docs`):

- **Explore behavior:** investigative conversation, no implementation decisions, no artifacts committed.
- **Grilling (via `grill-me`):** a relentless one-question-at-a-time interview that walks each branch of the design tree, recommends an answer per question, and explores the codebase to settle questions it can.
- **Outputs:** none. Explore is purely conversational and commits nothing. (The earlier `grill-with-docs` skill wrote a `CONTEXT.md` glossary and ADRs inline; that machinery was dropped — it contradicted "no artifacts" and imposed a workflow the phase did not need.)
- **Transition:** at end of session, surfaces a prompt to run `/csi-opsx:propose`.

No harness, no subprocess, no file access enforcement — purely conversational.

### `/csi-opsx:propose`

*(Updated 2026-06-19 — see `2026-06-19-thin-propose-design.md`; `propose` originally drove the review loop itself.)* A thin, skill-customizable wrapper around `/opsx:propose`:

1. Follows `/opsx:propose` behavior to generate the initial artifacts (`proposal.md`, `design.md`, `tasks.md`, and any spec files).
2. Loads any skills named in its `## Skills` section (empty today).
3. Surfaces the change name it just created and suggests the next step: `/csi-opsx:review <name>` (optionally with a round budget, e.g. `/csi-opsx:review <name> 3`).

No harness, no runner detection — the loop is reached through `/csi-opsx:review`.

### `/csi-opsx:review <name> [max-rounds]`

Runs the automated reviewer→proposer loop on a change whose artifacts **already exist** — generated by `propose`, written by hand, or left behind by an earlier run that crashed or exhausted its round budget. Full design: `2026-06-16-review-command-design.md`. In outline:

1. Resolves the change name (explicit argument, or list `openspec/changes/` and ask — never auto-select).
2. Guards: the change folder must contain at least one artifact; otherwise stop with a notice — do not invoke the harness.
3. Checks for a supported runner (Claude Code today); without one, the developer reviews manually.
4. Runs `csi-opsx run --command=review --workspace . --change <name>` (with `--max-rounds=<n>` if the user gave an integer) and surfaces the exit summary.

### `/csi-opsx:apply`

Thin passthrough. Follows `/opsx:apply` behavior. No additional behavior in this iteration.

### `/csi-opsx:archive`

Thin passthrough. Follows `/opsx:archive` behavior. No additional behavior in this iteration.

---

## Skill Customization

**Added 2026-06-15.** csi-opsx is a thin wrapper, and each command's behavior is meant to be *customizable* by attaching skills — small markdown instruction files an agent loads on demand. This is the mechanism behind explore's grilling, generalized so any phase can be tuned without touching csi-opsx's own code.

**The convention:**

- Skills live flat in `src/skills/<name>/`, are bundled into the package, and install flat to `{toolDir}/skills/<name>/` via `installThirdPartySkills` — exactly as they already did.
- A command opts into a skill by **naming it** in a `## Skills` section in `src/commands/<command>/SKILL.md`. That `SKILL.md` is both installed as the command's skill *and* baked into the generated slash-command file, so the reference travels with the command.
- At run time the agent loads the named skill on demand through its Skill tool. Claude Code discovers an installed skill by its `SKILL.md` frontmatter (`name`/`description`), so a flat install plus a named reference is a complete loading path.

**Decision: explicit naming over directory-scanning.** An earlier sketch had each command own a *directory* of skills and load "whatever is present in this command's folder." That was rejected: it would require new install/layout logic to place skills per-command, plus runtime directory-discovery for the agent — machinery that buys nothing over simply naming the skill. Explicit naming reuses the existing flat install and Claude Code's by-name discovery **unchanged** — no `install.ts`, build, or layout changes. The accepted trade-off: adding a skill is two steps (drop it in `src/skills/`, then name it in the command's `## Skills` section) instead of one — more explicit, and far simpler to maintain.

**Scope and limits:**

- Only `/csi-opsx:explore` ships a skill today — `grill-me`. Every thin command (`explore`, `propose`, `apply`, `archive`) exposes a `## Skills` section as its extension hook (`propose`/`apply`/`archive` gained empty ones on 2026-06-19 with the thin-`propose` change). `review` has no `## Skills` hook: its reviewer→proposer loop *is* its behavior.
- No per-session selective activation. To disable a skill, remove it from the command's `## Skills` list (or from `src/skills/`). The expectation is roughly one skill per command.

**Departure from `grill-with-docs`.** The explore phase originally bundled Matt Pocock's `grill-with-docs` — the relentless interview *plus* a documentation system (a `CONTEXT.md` glossary and ADRs written inline). It was replaced by his plainer `grill-me` (the interview only), for two reasons: the doc machinery contradicted explore's own rule that it commits no artifacts, and it imposed a specific glossary/ADR workflow the phase did not need. Concretely, `src/skills/grill-with-docs/` (with its `ADR-FORMAT.md`/`CONTEXT-FORMAT.md`) became `src/skills/grill-me/` with a single `SKILL.md`, and `explore/SKILL.md` lost its inline "fallback grilling" block and `Outputs` section. User-facing docs for this live in the README's "Customising a command's behaviour with skills" section.

*Decision record (rationale + rejected alternative): [`open-questions/2026-06-15-skill-customization.md`](../open-questions/2026-06-15-skill-customization.md).*

---

## Review Harness

*(Renamed 2026-06-19 — the loop originally ran under `propose`; see `2026-06-19-thin-propose-design.md`. Entry point: `runReviewHarness` in `src/commands/review/harness.ts`, dispatched from `HARNESS_RUNNERS` in `src/bin/cli.ts`.)*

### Runner Resolution

```
resolveRunner():
  if claude CLI available (claude --version succeeds) → ClaudeCliRunner
  else → null (skill surfaces a no-runner notice; developer reviews manually)
```

Future runners (CodexCliRunner, AnthropicSdkRunner, etc.) are added here as new features, each preceded by a dedicated research spike.

```mermaid
flowchart TD
    A["csi-opsx run --command=review"] --> B{"claude --version\nsucceeds?"}
    B -- Yes --> C[ClaudeCliRunner\nspawns claude -p subprocess\nno extra API key needed]
    B -- No --> D[null runner\nreturn fallback signal]
    D --> E["Skill prints:\n⚠ No supported runner detected\nAutomated review loop unavailable"]

    F[Future runners] -. CodexCliRunner .-> G["codex -q subprocess\nOpenAI auth"]
    F -. AnthropicSdkRunner .-> H["Anthropic SDK\nANTHROPIC_API_KEY required\nuniversal fallback"]
    F -. OpenAiSdkRunner .-> I["OpenAI SDK\nOPENAI_API_KEY required"]
```

### Loop Structure

```mermaid
flowchart TD
    Start([Harness starts]) --> CR[Crash recovery:\nsweep orphaned temp dirs (scoped)]
    CR --> RS["Resumability: scan review-findings-*.md\nFind highest round N + status"]
    RS --> BRW["Build reviewer workspace\n<os-tmp>/csi-opsx-...-reviewer-N/\nReads artifacts + prev findings in place\nWrite: deny-only settings.json\n(read grant = --add-dir flag)"]
    BRW --> SR["Spawn: claude -p reviewer\n--permission-mode acceptEdits\n--add-dir projectRoot\ncwd: <os-tmp>/csi-opsx-...-reviewer-N/"]
    SR --> CB1["Copy back: review-findings-N.md → project\nClean up temp dir"]
    CB1 --> CHK{issues-found?}
    CHK -- "= 0" --> EXIT([Exit: print summary])
    CHK -- "> 0" --> BPW["Build proposer workspace\n<os-tmp>/csi-opsx-...-proposer-N/\nCopy: artifacts + review-findings-N.md\nWrite: deny-only settings.json\n(read grant = --add-dir flag)"]
    BPW --> SP["Spawn: claude -p proposer\n--permission-mode acceptEdits\n--add-dir projectRoot\ncwd: <os-tmp>/csi-opsx-...-proposer-N/"]
    SP --> CB2["Copy back: artifacts + findings (findings last)\nproposer set is-solved + status\nClean up temp dir"]
    CB2 --> INC[N++]
    INC --> BRW
```

### Full Cycle Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Skill as /csi-opsx:review
    participant Harness as csi-opsx harness
    participant Rev as Reviewer Agent
    participant Prop as Proposer Agent

    Dev->>Skill: invoke /csi-opsx:review <name>
    Note over Skill: artifacts already exist<br/>(from /csi-opsx:propose or by hand)
    Skill->>Harness: csi-opsx run --command=review --change <name>

    loop Until issues-found = 0
        Harness->>Rev: claude -p reviewer prompt
        Note over Rev: temp workspace (cwd) — writes stay<br/>in workspace; project is read-only
        Rev-->>Harness: review-findings-N.md (issues-found: N)
        Harness->>Harness: parse issues-found field

        alt issues-found > 0
            Harness->>Prop: claude -p proposer prompt
            Note over Prop: temp workspace (cwd) — writes stay<br/>in workspace; project is read-only
            Prop-->>Harness: updated artifacts + findings (is-solved, status: addressed)
        end
    end

    Harness-->>Skill: exit 0 + summary
    Skill-->>Dev: ✓ complete — N rounds, 0 issues found
```

### Trust Boundary

The harness decides *what to review* by **enumerating the change folder**, not by trusting a list of paths passed to it.

- The internal `run` command takes `--change <name>` — a single change identifier, **not** a list of file paths. The harness builds the artifact list itself from `openspec/changes/<name>/`, so there is no externally-supplied path list to validate or be tricked into writing through.
- `<name>` must be a single safe path segment. The harness validates it against `^[A-Za-z0-9._-]+$` and rejects `.`, `..`, and any path separators **before** building any path — otherwise `--change ..` could climb out of the change folder and pull in unrelated files.
- Enumeration is deterministic: the same folder always yields the same artifact list, with no model involved in selecting paths.

**Artifacts that count** (relative to `openspec/changes/<name>/`): `proposal.md`, `design.md`, `tasks.md`, and any `specs/**/spec.md`. **Excluded:** `.openspec.yaml` (metadata) and the `review-findings-*.md` files. The optional artifacts (`design.md`, `tasks.md`) are tolerated when absent — the harness must not require them.

### Workspace Isolation & Write Sandbox

Each agent run executes in its own temporary workspace, with `cwd` set to that directory. The workspace holds exactly the files that agent is allowed to write (see **Workspace contents** below). The rule we enforce: **the agent may write only inside the workspace, and may read the project for context but not modify it.**

**The workspace directory is the write boundary.** Verified empirically with real `claude -p` runs (CLI 2.1.158): `--permission-mode acceptEdits` together with `cwd = workspace` gives exactly this boundary —

- writes/edits to files *inside* the workspace (including nested directories) are auto-accepted;
- writes/edits *outside* the workspace require approval, which is auto-denied in non-interactive (`-p`) mode — so they are blocked;
- reads *outside* the workspace are blocked the same way. (This corrects an earlier assumption that "Read is unrestricted." The working directory is a **two-way** boundary — it gates reads as well as writes.)

**Reading project context without copying it.** *(Updated 2026-07-02 — see `2026-07-02-review-add-dir-read-grant-design.md`; originally `additionalDirectories` in the workspace settings, which Claude Code now ignores in never-trusted directories.)* The agent still needs to read project files that live outside the workspace (`CLAUDE.md`, `openspec/specs/`, `docs/`). The runner re-grants read access to the project root with the **`--add-dir <projectRoot>` CLI flag** — a flag the operator passed explicitly, so it is honored regardless of directory trust. Because `--add-dir` grants *both* read and write, the runner also adds `deny` rules for the write tools on the project subtree in the workspace's `.claude/settings.json`; permission-shrinking rules still load in untrusted directories. `deny` overrides both `allow` and the `acceptEdits` mode, so the project ends up **readable but not writable**, while the workspace stays writable.

```jsonc
// workspace/.claude/settings.json — written by writePermissions() before spawning
// (deny-only: the read grant is the --add-dir flag, not a settings entry)
{
  "permissions": {
    "deny": [
      "Write(//c/Users/me/project/**)",           // project is read-only…
      "Edit(//c/Users/me/project/**)"             // …deny beats allow + acceptEdits
    ]
  }
}
```

The runner spawns `claude -p <prompt> --permission-mode acceptEdits --setting-sources project --add-dir "<projectRoot>"` with `cwd` = the workspace (the runner wraps the path in quotes itself — `spawnSync` with `shell: true` joins arguments without quoting, and project paths can contain spaces). It deliberately does **not** allow the Bash tool (no `--allowedTools Bash`): Bash is the one path-agnostic way around a Write/Edit deny, and leaving it unlisted means it needs approval and is auto-denied under `-p`.

**The fs-path → permission-glob helper.** A `deny` rule's path is a *glob*, and the permission engine only recognizes an absolute path written in a platform-specific glob form:

- **Windows:** MSYS form — `//c/Users/me/project/**` (leading `//`, the drive letter as a lowercase path segment with **no colon**, forward slashes). The "natural" Windows forms (`C:\…`, `C:/…`, `/C:/…`, `//C:/…`) all silently fail to match — this was a real trap during the spike.
- **macOS / Linux:** `//Users/me/project/**` (the absolute path with one extra leading `/`).

So `permissions.ts` carries a small helper that converts an absolute filesystem path into this glob form. Two points:

- The helper is **pattern-only.** `--add-dir` takes a directory *path*, not a glob — pass the project's native path (`C:\…`) untouched, and use the helper solely to build the `deny` patterns.
- Detect the path **shape** (e.g. a leading `C:` drive letter) rather than `process.platform`, so the helper is a pure string function that can be unit-tested for both operating systems from any machine.

**Testing the sandbox (acceptance criterion).** A `deny`-rule block does **not** show up in the `claude -p` JSON `permission_denials` array — that array only captures interactive "would-prompt → auto-denied" events, not pre-emptive deny-rule blocks. The ground truth is the **file state**. The integration test must therefore assert on files: an in-workspace write *succeeds* (the file exists) and an attempted project write *is blocked* (the project file is absent/unchanged). A JSON-shape unit test is explicitly **not** sufficient — asserting only the shape of `settings.json` is exactly what let the original, completely non-functional sandbox pass its tests.

**Runner contract.** File-access enforcement stays a runner-specific concern. The harness tells the runner, agent-neutrally, which directory is the writable workspace (`cwd`) and which directory is the read-only project root; each runner translates that into its own sandbox (for `ClaudeCliRunner`, the `settings.json` above). Future runners (CodexCliRunner, AnthropicSdkRunner) can enforce the same contract with a different config file or programmatic tool restrictions, without changing the harness.

**Workspace contents — the copy list *is* the write-allow-list.** Under `acceptEdits`, copying a file into the workspace is what makes it writable, so each agent's workspace holds exactly the files that agent is meant to change — and nothing more:

- *Reviewer* — a **pure consumer** of the artifacts. Its workspace is **empty**: it reads the artifacts and any prior `review-findings-(N-1).md` *in place* from the read-only change folder, and writes only `review-findings-N.md` into its workspace. The `deny` rules physically stop it from modifying the artifacts even if its prompt went astray — least privilege, enforced rather than merely requested.
- *Proposer* — its job **is** to edit the artifacts *and* record what it did, so its workspace holds **writable copies of the artifacts plus the current `review-findings-N.md`**. It edits the artifacts, sets each issue's `is-solved` + a resolution note, and flips the file-level `status: open → addressed` to attest its pass is complete.

After each run the harness copies back only what actually changed: `review-findings-N.md` after the reviewer, and the edited artifacts **and** the updated `review-findings-N.md` after the proposer. The proposer — not the harness — owns the `status` flip: only the agent that did the work can attest the pass is complete, and a crashed proposer must *not* leave a false `addressed` behind (see **Resumability & Crash Recovery**). The findings file is copied back **last**, so "the project says `addressed`" reliably implies the artifacts were already committed. Anything else an agent happens to create in its workspace is discarded.

### Workspace Naming & Cleanup

Each run's temp directory lives in the **shared OS temp dir** (`os.tmpdir()` — one scratch folder shared by every program and project on the machine), named deterministically:

```
csi-opsx-<projectBasename>-<pathHash8>-<change>-<role>-<round>
```

- `<change>`, `<role>`, and `<round>` keep every directory within a single loop distinct; since the reviewer and proposer run sequentially, only one directory per change is ever live.
- `<pathHash8>` is the first 8 hex chars of a SHA-256 of the *normalized* absolute project path (`path.resolve`, lowercased on Windows). Because the OS temp dir is one shared namespace, the basename alone could collide between two same-named checkouts (e.g. `~/work/csi-opsx` and `~/personal/csi-opsx`); the path hash disambiguates them while staying stable per project.

Cleanup:

- A run deletes its **own** directory on exit (success or handled failure) in a `finally`.
- Startup sweeps **orphaned** directories left by hard crashes, scoped to the current `<project>-<change>` prefix — never a global wipe, so a concurrent run on a *different* change or project is untouched.
- Running two review loops on the **same** change at once is unsupported; the crash model bounds the damage to wasted work (copy-back commits only on a clean exit), not a corrupted project.

### `review-findings-N.md` Format

```markdown
---
issues-found: 2
round: 2
status: open
---

## Issue 1: [title]
is-solved: true
[reviewer's description]
**Resolution (proposer):** [what was changed]

## Issue 2: [title]
is-solved: false
[reviewer's description]
**Resolution (proposer):** Not solved — [reason]
```

**Who writes what** (raise → claim → verify):

- *Reviewer* writes the frontmatter (`issues-found`, `round`, `status: open`) and each issue's title, description, and `is-solved: false`.
- *Proposer* sets each issue's `is-solved` (`false → true`, or leaves `false` with a reason), adds a `**Resolution (proposer):**` note, and flips the frontmatter `status` to `addressed` when its pass is done. Its prompt forbids altering the reviewer's issue text or `issues-found`.
- The *next* round's reviewer is the real verification — its fresh `issues-found` is what tells us whether the issues were truly resolved.

**Two `status`-like signals, deliberately separate:**

- Frontmatter `status` (`open` → `addressed`) is a **phase marker** — "has the proposer finished its pass?" — and is the only status the harness reads.
- Per-issue `is-solved` (`true`/`false`) is the **disposition** of each issue — for agents and humans, never parsed by the harness.
- Using a distinct key (`is-solved`, not "status") *and* anchoring the harness's parser to the frontmatter block means a body `is-solved:` line — or stray "status:" text in a description — can never be mistaken for the file-level status. The harness parses only `issues-found` and the frontmatter `status`.

### Resumability & Crash Recovery

**The project is the checkpoint; the temp workspace is disposable scratch.** All resume state lives in the project's `review-findings-*.md` files — the harness persists nothing else, so a crash anywhere is recovered by re-reading the project. A workspace is copied back *only on a clean agent exit*; if a run crashes (or the harness itself is killed), the workspace is discarded, the project is left untouched, and the next invocation re-derives the correct step.

On startup the harness:

1. Sweeps orphaned temp dirs (see **Workspace Naming & Cleanup**).
2. Scans the project for `review-findings-*.md`, takes the highest round N, and reads its frontmatter `status`:
   - **No files** → start round 1 with the reviewer.
   - **`status: open`, issues > 0** → the reviewer produced findings but the proposer hasn't completed its pass → run the **proposer** for round N. (A proposer that crashed earlier never copied back, so the project is still at a clean round-N-open state; re-running is safe.)
   - **`status: addressed`** → the proposer finished round N → run the reviewer for round N+1.
   - **`status: open`, issues = 0** → loop already complete (no-op).

This precise resume is possible *because* the proposer owns the `status` flip: `open` reliably means "the proposer's turn," `addressed` means "the proposer finished." Re-running an agent from the same clean inputs is semantically idempotent — not bit-identical (LLM nondeterminism), but it addresses the same issues, and the next reviewer round verifies the outcome regardless.

### Artifact Enumeration

The harness derives the artifact list by **enumerating the change folder** (`openspec/changes/<name>/`), not by diffing file modification times. It checks for the three known filenames (`proposal.md`, `design.md`, `tasks.md`) and scans `specs/` for any `spec.md`. This replaces an earlier before/after `mtime` snapshot+diff approach, which could silently miss any artifact that `/explore` wrote but `/propose` did not subsequently touch, and which trusted a path list rather than deriving one. See **Trust Boundary** for why the change folder — not a diff — is the unit of review.

### Exit Summary

On clean exit (issues-found = 0):
```
✓ Review complete
  Rounds: 3
  Final review: 0 issues found
  Issues found per round: 4, 2, 0
  Artifacts: proposal.md, design.md, tasks.md, specs/auth/spec.md
  Review history: review-findings-1.md, review-findings-2.md, review-findings-3.md
```

On an exhausted round budget (no convergence this pass):
```
⚠ Review: ran 2 rounds this pass (through round 2) without converging to 0 issues.
  Issues found per round: 4, 2
  Review history: review-findings-1.md, review-findings-2.md
  Run /csi-opsx:review again to run more rounds, or review the artifacts and findings files manually.
```

On fallback (no runner available):
```
⚠ csi-opsx: No runner available.
  Automated review loop unavailable.
  Install Claude Code to enable the automated review loop.
```

---

## Agent-Agnostic Skill Installation

### Tool Detection

`csi-opsx init` detects configured agents by scanning for OpenSpec skill files:

```ts
// src/lib/tool-detection.ts
// For each known tool, check if openspec skills are installed
// Mirrors OpenSpec's getConfiguredTools() pattern
const TOOL_DIRS = {
  'claude':         '.claude',
  'cursor':         '.cursor',
  'gemini':         '.gemini',
  'codex':          '.codex',
  'github-copilot': '.github',
  // ... mirrors OpenSpec's AI_TOOLS skillsDir values
};

function getConfiguredTools(projectRoot) {
  return Object.entries(TOOL_DIRS)
    .filter(([, dir]) => hasOpenSpecSkills(projectRoot, dir))
    .map(([toolId]) => toolId);
}
```

### Skill and Command Installation

Skills and commands are distinct mechanisms in Claude Code (and most other agents) and `csi-opsx init` installs both:

**Skill files** — contain the behavioral instructions. Content is agent-neutral markdown, identical across all agents. Installed at:
```
{toolDir}/skills/csi-opsx-explore/SKILL.md
{toolDir}/skills/csi-opsx-propose/SKILL.md
{toolDir}/skills/csi-opsx-apply/SKILL.md
{toolDir}/skills/csi-opsx-archive/SKILL.md
{toolDir}/skills/csi-opsx-review/SKILL.md
```

**Command files** — create the invocable slash commands (e.g. `/csi-opsx:propose`). Format, content, and path are agent-specific and generated by the adapter in `src/lib/adapters/`. For Claude Code:
```
.claude/commands/csi-opsx/explore.md   → /csi-opsx:explore
.claude/commands/csi-opsx/propose.md   → /csi-opsx:propose
.claude/commands/csi-opsx/apply.md     → /csi-opsx:apply
.claude/commands/csi-opsx/archive.md   → /csi-opsx:archive
.claude/commands/csi-opsx/review.md    → /csi-opsx:review
```

The command file is a thin entry point that references the skill behavior. The skill file holds the full multi-step instructions. For agents that only support one mechanism (skills OR commands, not both), the adapter installs whichever is appropriate for that agent.

### Backward Compatibility

`/opsx:*` skills are installed and managed entirely by OpenSpec. `csi-opsx` never writes to OpenSpec's skill directories. A developer can revert to standard OpenSpec at any time by invoking `/opsx:propose` instead of `/csi-opsx:propose` — no migration, no cleanup required.

---

## Extensibility Points

| What to extend | Where to add it |
|---|---|
| New wrapper command | Add `src/commands/{name}/SKILL.md`; add the name to `COMMAND_NAMES` in `src/lib/types.ts` |
| New harnessed command | Add `src/commands/{name}/SKILL.md`, `harness.ts`, `agents.ts`; wire `run --command={name}` |
| New runner adapter | Add `src/lib/runner/{name}/` with `cli.ts` (plus any agent-specific helpers like `permissions.ts`, `config.ts`); add detection check in `src/lib/runner/index.ts` |
| New agent for skill install | Add entry to `src/lib/tools.ts`; add adapter to `src/lib/adapters/` |
| New third-party skill | Add `src/skills/{name}/` with all skill files and an attribution line in `SKILL.md`; tsup and install pick it up automatically |
| Customize a command's behavior | List a bundled skill's `name` in that command's `## Skills` section in `src/commands/{name}/SKILL.md` — see **Skill Customization** |

---

## Open Questions

- Does `claude --version` reliably indicate that `claude -p` non-interactive mode is available, or is a more specific capability check needed?
- ~~Does `claude -p` in a subprocess correctly inherit the working directory's `.claude/settings.json` for permissions?~~ **Resolved (2026-05-30).** Yes — with `--setting-sources project` and `cwd` = workspace. The full sandbox mechanism (acceptEdits + workspace boundary + project read-only via `additionalDirectories`/`deny`, using the platform-specific glob form) was verified with real `claude -p` runs; see **Workspace Isolation & Write Sandbox**. *(2026-07-02: the read-grant half has since moved to the `--add-dir` CLI flag — Claude Code now ignores `additionalDirectories` in never-trusted directories; see `2026-07-02-review-add-dir-read-grant-design.md`.)*
- Does OpenSpec (`validate`/`apply`/`archive`) tolerate `review-findings-*.md` living inside the change folder? Verify early; fall back to a dedicated `.csi-opsx/` location if it errors.
- Exact Codex CLI flags for non-interactive use — research spike before implementing CodexCliRunner.
