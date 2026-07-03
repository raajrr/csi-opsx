# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # compile src/ → dist/ via tsup (ESM, with .d.ts)
npm run dev         # watch mode build
npm run typecheck   # tsc --noEmit (no emit, just type errors)
npm test            # vitest run (single pass)
npm run test:watch  # vitest watch mode
```

Run a single test file:
```bash
npx vitest run src/lib/__tests__/loop.test.ts
```

## Architecture

`csi-opsx` is a CLI tool that wraps [OpenSpec](https://github.com/Fission-AI/OpenSpec) and adds an automated proposer→reviewer loop. The binary entrypoint is `src/bin/cli.ts`, compiled to `dist/bin/cli.js`.

### Command layout

Each command lives under `src/commands/{name}/` with up to three files:
- `SKILL.md` — agent-neutral behavioral instructions (markdown asset, not compiled; copied to `dist/` by `tsup.config.ts` `onSuccess` hook)
- `agents.ts` — agent prompt builders (`ReviewerAgent`, `ProposerAgent`)
- `harness.ts` — orchestration logic for harnessed commands

`explore`, `propose`, `apply`, and `archive` are thin passthroughs to OpenSpec behavior (each exposes a `## Skills` hook for customization). `review` is the harnessed command: it runs a reviewer→proposer loop in isolated temp workspaces until the reviewer reports zero issues. `propose` generates the artifacts (via OpenSpec) and then suggests running `review`; `review` drives the loop over a change whose artifacts already exist.

### Library modules (`src/lib/`)

| Module | Responsibility |
|---|---|
| `runner/types.ts` | `Runner` interface, `RunnerOptions`, and `RunnerResult` type |
| `runner/index.ts` | `resolveRunner()` — returns first available runner or `null` |
| `runner/claude/cli.ts` | `ClaudeCliRunner` — spawns `claude -p` via `child_process.spawnSync`; when `projectRoot` is provided, grants project reads with `--add-dir` and calls `writePermissions` for the write-deny rules |
| `runner/claude/permissions.ts` | `writePermissions()` — writes `.claude/settings.json` into the temp workspace (Claude-specific helper; not used directly by the harness) |
| `workspace.ts` | `createWorkspace()`, `copyBack()`, `cleanupWorkspace()` — temp dir lifecycle |
| `loop.ts` | `parseIssuesFound()`, `parseStatus()`, `findLatestFindingsRound()`, `getFindingsPath()` — parse `review-findings-N.md` frontmatter |
| `types.ts` | `ToolId`, `CommandName`, `AgentRole` union types + `COMMAND_NAMES` |
| `tools.ts` | tool-id → skillsDir mapping (mirrors OpenSpec `AI_TOOLS`) |
| `tool-detection.ts` | `getConfiguredTools()` — detects which agents have OpenSpec skills installed |
| `adapters/types.ts` | `SkillAdapter` interface |
| `adapters/claude.ts` | generates Claude Code command file path and content |
| `adapters/index.ts` | adapter registry + `getAdapter()` lookup |
| `install.ts` | `installSkills()`, `installCommands()`, `installThirdPartySkills()` — file installation |

### Review harness loop

`review` drives this loop through `runReviewHarness` (`src/commands/review/harness.ts`), dispatched from `HARNESS_RUNNERS` in `src/bin/cli.ts`. `propose` no longer drives the harness — it generates artifacts and hands off to `review`, which runs the loop on artifacts that already exist.

```
resolve runner → resume scan → start round N
  loop:
    create reviewer workspace (empty temp dir)
    runner.run({ prompt: <reviewer>, workspaceDir, projectRoot })
      └─ ClaudeCliRunner writes .claude/settings.json (project write-deny rules) then spawns
         claude -p --permission-mode acceptEdits --setting-sources project --add-dir "<projectRoot>"
    copy back review-findings-N.md → project
    parse issues-found
    if issues-found == 0 → exit (print summary)
    create proposer workspace (temp dir, copy artifacts + findings)
    runner.run({ prompt: <proposer>, workspaceDir, projectRoot })
      └─ (same runner mechanism)
    copy back artifacts + findings → project
    round++
```

Agents read project context (`CLAUDE.md`, `openspec/`, `docs/`) from absolute paths in their prompt — no copying needed because the runner re-grants the project with the `--add-dir` CLI flag. The grant must be the flag, not `additionalDirectories` in the workspace `.claude/settings.json`: Claude Code ignores that permission-expanding entry in directories that were never trusted, and the disposable per-round workspaces never are. The workspace `settings.json` (written by `writePermissions`) carries only `deny` rules for `Write`/`Edit` on the project subtree — permission-shrinking rules still load untrusted — so the project stays read-only while the workspace cwd is writable under `acceptEdits`. The harness does not import `permissions` directly — each runner encapsulates its own sandbox mechanism.

### review-findings-N.md format

```
---
issues-found: <integer>
round: <integer>
status: open | addressed
---
```

The harness reads `issues-found` and `status` via regex. `status: open` + `issues-found: 0` means the loop is complete.

### Resumability

On startup the harness scans for `review-findings-*.md` files, finds the highest round, and inspects its `status` to determine whether to start the reviewer or proposer for that round.

`--max-rounds` is a per-invocation budget measured from the resume point, not an absolute ceiling: `endRound = startRound - 1 + maxRounds`, where `startRound` is the resume-adjusted round (1 on a fresh run). So a fresh run behaves as an absolute cap (rounds `1..maxRounds`), and a resume runs `maxRounds` more rounds from where the last pass stopped.

### Skill and command installation (`csi-opsx init`)

1. Delegates to `openspec init` (interactive agent selection)
2. Detects configured agents by scanning for `{toolDir}/skills/openspec-*/SKILL.md`
3. Copies `src/commands/*/SKILL.md` → `{toolDir}/skills/csi-opsx-{name}/SKILL.md`
4. Generates agent-specific command files via `src/lib/adapters/`
5. Installs bundled third-party skills — copies each `dist/skills/{name}/` directory wholesale → `{toolDir}/skills/{name}/` (all files preserved)

For Claude Code, commands install to `.claude/commands/csi-opsx/{name}.md` → invocable as `/csi-opsx:{name}`.

### Build asset copying

`tsup.config.ts` has an `onSuccess` hook that copies each `src/commands/{name}/SKILL.md` into the corresponding `dist/commands/{name}/` directory, and copies each `src/skills/{name}/` directory (bundled third-party skills) wholesale into `dist/skills/`. `csi-opsx init` reads these `SKILL.md` files at runtime; per-agent command files are generated by the adapters in `src/lib/adapters/`, not copied as build assets.