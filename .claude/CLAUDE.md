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

`csi-opsx` is a CLI tool that wraps [OpenSpec](https://npmjs.com/package/openspec) and adds an automated proposer→reviewer loop. The binary entrypoint is `src/bin/cli.ts`, compiled to `dist/bin/cli.js`.

### Command layout

Each command lives under `src/commands/{name}/` with up to four files:
- `SKILL.md` — agent-neutral behavioral instructions (markdown asset, not compiled; copied to `dist/` by `tsup.config.ts` `onSuccess` hook)
- `command.md` — slash command entry point template (also copied as an asset)
- `agents.ts` — agent prompt builders (`ReviewerAgent`, `ProposerAgent`)
- `harness.ts` — orchestration logic for harnessed commands

`explore`, `apply`, and `archive` are thin passthroughs to OpenSpec behavior. `propose` is the only harnessed command: it runs a reviewer→proposer loop in isolated temp workspaces until the reviewer reports zero issues.

### Library modules (`src/lib/`)

| Module | Responsibility |
|---|---|
| `runner/types.ts` | `Runner` interface and `RunnerResult` type |
| `runner/claude-cli.ts` | `ClaudeCliRunner` — spawns `claude -p` subprocess via `child_process.spawnSync` |
| `runner/index.ts` | `resolveRunner()` — returns first available runner or `null` |
| `workspace.ts` | `createWorkspace()`, `copyBack()`, `cleanupWorkspace()` — temp dir lifecycle |
| `permissions.ts` | `writePermissions()` — writes `.claude/settings.json` into a temp workspace |
| `loop.ts` | `parseIssuesFound()`, `parseStatus()`, `findLatestFindingsRound()`, `getFindingsPath()` — parse `review-findings-N.md` frontmatter |
| `tools.ts` | tool-id → skillsDir mapping (mirrors OpenSpec `AI_TOOLS`) |
| `tool-detection.ts` | `getConfiguredTools()` — detects which agents have OpenSpec skills installed |
| `adapters/claude.ts` | generates Claude Code command file path and content |

### Propose harness loop

```
resolve runner → start round 1
  loop:
    create reviewer workspace (temp dir, copy artifacts)
    write restrictive settings.json → allow Write(review-findings-N.md) only
    spawn: claude -p <reviewer prompt> --allowedTools Read,Write (cwd = temp dir)
    copy back review-findings-N.md → project
    parse issues-found
    if issues-found == 0 → exit (print summary)
    create proposer workspace (temp dir, copy artifacts + findings)
    write restrictive settings.json → allow Write(artifacts + findings) only
    spawn: claude -p <proposer prompt> --allowedTools Read,Write (cwd = temp dir)
    copy back artifacts + findings → project
    round++
```

Agents read project context (`CLAUDE.md`, `openspec/`, `docs/`) from absolute paths in their prompt — no copying needed since `Read` is unrestricted. Write access is restricted to only the files each agent is allowed to modify via the workspace's `.claude/settings.json`.

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

### Skill and command installation (`csi-opsx init`)

1. Delegates to `openspec init` (interactive agent selection)
2. Detects configured agents by scanning for `{toolDir}/skills/openspec-*/SKILL.md`
3. Copies `src/commands/*/SKILL.md` → `{toolDir}/skills/csi-opsx-{name}/SKILL.md`
4. Generates agent-specific command files via `src/lib/adapters/`

For Claude Code, commands install to `.claude/commands/csi-opsx/{name}.md` → invocable as `/csi-opsx:{name}`.

### Build asset copying

`tsup.config.ts` has an `onSuccess` hook that copies `SKILL.md` and `command.md` from each `src/commands/{name}/` into the corresponding `dist/commands/{name}/` directory. These are the files `csi-opsx init` reads at runtime.