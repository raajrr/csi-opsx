# csi-opsx Propose Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the propose-harness stub with a working reviewer→proposer loop that spawns `claude -p` in isolated temp workspaces — reviewing the artifacts of one OpenSpec change folder until the reviewer reports zero issues.

**Architecture:** The harness takes a single `--change <name>` and *enumerates* the change folder itself (it never trusts a path list). Each agent runs with `cwd` = a temp workspace; the **workspace is the write boundary** (`--permission-mode acceptEdits`), and the project is re-granted **read-only** via `additionalDirectories` + `Write`/`Edit` `deny` rules in a per-workspace `.claude/settings.json`. The reviewer reads artifacts *in place* and writes only `review-findings-N.md`; the proposer edits *writable copies* of the artifacts and owns the `status` flip. The project is the checkpoint — copy-back happens only on a clean agent exit, findings last. See the design spec: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md`.

**Tech Stack:** TypeScript 5 (ESM, `.js` import specifiers), Vitest (unit + a real-`claude` integration test), Node `child_process.spawnSync`, Node `fs`/`os`/`crypto`/`path`.

**Prerequisite:** Plan 1 (csi-opsx Infrastructure) complete. Tasks 1–5b of the *previous* version of this plan were partially built and committed; this revision **reworks** that committed code to the proven sandbox design (the old `Write(*)`-deny sandbox was empirically non-functional). Where a file already exists, the task says **Rework**/**Finish** and shows the full new contents.

---

## Why this revision exists (read once)

The originally-committed sandbox wrote `{ allow: [Write(file)], deny: [Write(*)] }` and spawned `claude -p --allowedTools Read,Write`. Real `claude -p` probing proved this grants the agent **nothing** (`deny: Write(*)` overrides allow) — and separately that `--allowedTools Read,Write` blanket-allows writes *everywhere*, including outside the workspace. The working mechanism (verified on CLI 2.1.158) is:

- spawn `claude -p <prompt> --permission-mode acceptEdits --setting-sources project` with `cwd` = the temp workspace;
- write `workspace/.claude/settings.json` = `{ permissions: { additionalDirectories: [projectRoot], deny: [Write(<glob>/**), Edit(<glob>/**)] } }`;
- the glob uses MSYS form on Windows (`//c/Users/...`) and `//`-prefixed POSIX on Unix;
- never allow `Bash` (the one path-agnostic write bypass).

A **deny-rule block does not appear in the `permission_denials` JSON** — the only ground truth is the file state. So the sandbox is gated by a real `claude -p` integration test that asserts files, not JSON shape (Task 3).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/runner/claude/permissions.ts` | **Rework** | `toPermissionGlob(absPath)` + `writePermissions(workspaceDir, projectRoot)` → acceptEdits-style `settings.json` (read-only project via deny + `additionalDirectories`) |
| `src/lib/runner/claude/__tests__/permissions.test.ts` | **Rework** | Unit-test the new settings shape + `toPermissionGlob` for Windows and POSIX path shapes |
| `src/lib/runner/types.ts` | **Rework** | `RunnerOptions`: drop `writableRelativePaths`, add `projectRoot?` |
| `src/lib/runner/claude/cli.ts` | **Rework** | Spawn `--permission-mode acceptEdits --setting-sources project`; call `writePermissions(workspaceDir, projectRoot)` |
| `src/lib/runner/claude/__tests__/cli.test.ts` | **Rework** | Assert the new flags + settings written when `projectRoot` present |
| `src/lib/runner/claude/__tests__/sandbox.integration.test.ts` | **Create** | Real `claude -p`: in-workspace write succeeds, project write blocked (file-state); spaced-path case; auto-skips if `claude` absent |
| `src/lib/workspace.ts` | **Rework** | `createWorkspace`, `copyBack`, `cleanupWorkspace`, `sweepOrphanWorkspaces`; deterministic name `csi-opsx-<base>-<hash>-<change>-<role>-<round>` |
| `src/lib/__tests__/workspace.test.ts` | **Rework** | Update for the new signature + name; add sweep test |
| `src/lib/loop.ts` | **Finish** | Frontmatter-anchored `parseIssuesFound`/`parseStatus`; implement `findLatestFindingsRound`/`getFindingsPath` |
| `src/lib/__tests__/loop.test.ts` | **Modify** | Add anchoring tests (body `status:`/`is-solved:` ignored) |
| `src/lib/artifacts.ts` | **Create** | `validateChangeName`, `getChangeDirectory`, `enumerateChangeArtifacts` |
| `src/lib/__tests__/artifacts.test.ts` | **Create** | Optional files, nested specs, exclusions, traversal rejection, empty/missing folder |
| `src/commands/propose/agents.ts` | **Create** | `ReviewerAgent`/`ProposerAgent` prompt builders (is-solved format, least-privilege instructions) |
| `src/commands/propose/harness.ts` | **Rework** | `runProposeHarness({workspace, changeName, maxRounds?})` — validate → enumerate → loop |
| `src/bin/cli.ts` | **Modify** | `run` command: `--change <name>` (was `--artifacts`), add `--max-rounds` |
| `src/commands/propose/SKILL.md` | **Modify** | change-name cascade + empty-guard + `--change` invocation |
| `src/commands/propose/__tests__/harness.test.ts` | **Create** | Mocked-runner loop tests (incl. resume-open⇒proposer, copy-back-only-on-clean-exit) |

**Naming convention used throughout:** `projectRoot` = the real project dir (the `--workspace` CLI arg). `workspaceDir` = the per-run temp agent dir (the `cwd`). `changeDir` = `<projectRoot>/openspec/changes/<changeName>` — this is the `artifactsDir` passed to workspace copy helpers.

---

### Task 1: Rework permissions.ts — acceptEdits sandbox + path→glob helper

**Files:**
- Rework: `src/lib/runner/claude/permissions.ts`
- Rework: `src/lib/runner/claude/__tests__/permissions.test.ts`

- [X] **Step 1: Replace the test file with tests for the new behavior**

Overwrite `src/lib/runner/claude/__tests__/permissions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writePermissions, toPermissionGlob } from '../permissions.js';

describe('toPermissionGlob', () => {
  it('converts a Windows backslash drive path to MSYS form', () => {
    expect(toPermissionGlob('C:\\Users\\me\\proj')).toBe('//c/Users/me/proj');
  });

  it('converts a Windows forward-slash drive path to MSYS form (lowercased drive)', () => {
    expect(toPermissionGlob('D:/Dev/Personal Projects/csi-opsx')).toBe('//d/Dev/Personal Projects/csi-opsx');
  });

  it('prefixes a POSIX absolute path with one extra slash', () => {
    expect(toPermissionGlob('/Users/me/proj')).toBe('//Users/me/proj');
  });
});

describe('writePermissions', () => {
  let workspaceDir: string;
  const PROJECT_ROOT = 'C:\\Users\\me\\proj';

  beforeEach(() => {
    workspaceDir = join(tmpdir(), `perms-test-${Date.now()}`);
    mkdirSync(workspaceDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('creates .claude/settings.json', () => {
    writePermissions(workspaceDir, PROJECT_ROOT);
    expect(existsSync(join(workspaceDir, '.claude', 'settings.json'))).toBe(true);
  });

  it('lists the project root under additionalDirectories (native path)', () => {
    writePermissions(workspaceDir, PROJECT_ROOT);
    const s = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(s.permissions.additionalDirectories).toEqual([PROJECT_ROOT]);
  });

  it('denies Write and Edit on the project subtree using the glob form', () => {
    writePermissions(workspaceDir, PROJECT_ROOT);
    const s = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(s.permissions.deny).toContain('Write(//c/Users/me/proj/**)');
    expect(s.permissions.deny).toContain('Edit(//c/Users/me/proj/**)');
  });

  it('does NOT emit an allow list or a Write(*) catch-all', () => {
    writePermissions(workspaceDir, PROJECT_ROOT);
    const s = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(s.permissions.allow).toBeUndefined();
    expect(s.permissions.deny).not.toContain('Write(*)');
  });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/runner/claude/__tests__/permissions.test.ts`

Expected: FAIL — `toPermissionGlob` is not exported; assertions on `additionalDirectories`/glob deny do not match the old output.

- [X] **Step 3: Replace src/lib/runner/claude/permissions.ts**

```ts
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Convert an absolute filesystem path into the glob form Claude Code's permission
// engine matches against. Detection is by path SHAPE (drive letter), not process.platform,
// so this stays a pure string function that is unit-testable for both OSes from any machine.
//   Windows: C:\Users\me\proj  -> //c/Users/me/proj   (MSYS: '//' + lowercase drive segment, no colon)
//   POSIX:   /Users/me/proj    -> //Users/me/proj      (absolute path with one extra leading '/')
export function toPermissionGlob(absPath: string): string {
  const drive = absPath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, '/');
    return `//${letter}/${rest}`;
  }
  const posix = absPath.replace(/\\/g, '/');
  return posix.startsWith('/') ? `/${posix}` : `//${posix}`;
}

// Write the per-workspace sandbox config. The workspace (cwd) is writable under
// --permission-mode acceptEdits; this re-grants READ access to the project via
// additionalDirectories, then claws back WRITE/EDIT on the project with deny rules
// (deny overrides both allow and the acceptEdits mode).
export function writePermissions(workspaceDir: string, projectRoot: string): void {
  const settingsDir = join(workspaceDir, '.claude');
  mkdirSync(settingsDir, { recursive: true });

  const glob = toPermissionGlob(projectRoot);
  const settings = {
    permissions: {
      additionalDirectories: [projectRoot],
      deny: [`Write(${glob}/**)`, `Edit(${glob}/**)`],
    },
  };

  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}
```

- [X] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/runner/claude/__tests__/permissions.test.ts`

Expected: PASS — all 7 tests pass.

- [X] **Step 5: Commit**

```bash
git add src/lib/runner/claude/permissions.ts src/lib/runner/claude/__tests__/permissions.test.ts
git commit -m "feat: rework permissions to acceptEdits sandbox + path->glob helper"
```

---

### Task 2: Rework Runner types + ClaudeCliRunner

**Files:**
- Rework: `src/lib/runner/types.ts`
- Rework: `src/lib/runner/claude/cli.ts`
- Rework: `src/lib/runner/claude/__tests__/cli.test.ts`

- [X] **Step 1: Update the test file for the new flags + projectRoot behavior**

Overwrite `src/lib/runner/claude/__tests__/cli.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'child_process';
import { ClaudeCliRunner } from '../cli.js';

describe('ClaudeCliRunner', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('isAvailable', () => {
    it('returns true when claude --version exits 0', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
      expect(new ClaudeCliRunner().isAvailable()).toBe(true);
    });
    it('returns false when claude --version fails', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
      expect(new ClaudeCliRunner().isAvailable()).toBe(false);
    });
    it('returns false when spawnSync throws (claude not on PATH)', () => {
      vi.mocked(spawnSync).mockImplementation(() => { throw new Error('ENOENT'); });
      expect(new ClaudeCliRunner().isAvailable()).toBe(false);
    });
  });

  describe('run', () => {
    it('spawns claude -p with acceptEdits and project setting-sources (never --allowedTools)', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
      const PROMPT = 'review please';
      const WS = join(tmpdir(), `cli-args-${Date.now()}`);
      mkdirSync(WS, { recursive: true });
      try {
        await new ClaudeCliRunner().run({ prompt: PROMPT, workspaceDir: WS });
        const [cmd, args, options] = vi.mocked(spawnSync).mock.calls[0];
        expect(cmd).toBe('claude');
        expect(args).toEqual(['-p', PROMPT, '--permission-mode', 'acceptEdits', '--setting-sources', 'project']);
        expect(args).not.toContain('--allowedTools');
        expect(options).toMatchObject({ cwd: WS });
      } finally {
        rmSync(WS, { recursive: true, force: true });
      }
    });

    it('writes .claude/settings.json when projectRoot is provided', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
      const WS = join(tmpdir(), `cli-perm-${Date.now()}`);
      mkdirSync(WS, { recursive: true });
      try {
        await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: WS, projectRoot: 'C:\\Users\\me\\proj' });
        expect(existsSync(join(WS, '.claude', 'settings.json'))).toBe(true);
      } finally {
        rmSync(WS, { recursive: true, force: true });
      }
    });

    it('does NOT write settings.json when projectRoot is omitted', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
      const WS = join(tmpdir(), `cli-noperm-${Date.now()}`);
      mkdirSync(WS, { recursive: true });
      try {
        await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: WS });
        expect(existsSync(join(WS, '.claude', 'settings.json'))).toBe(false);
      } finally {
        rmSync(WS, { recursive: true, force: true });
      }
    });

    it('returns exitCode 0 and stdout on success', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'out', stderr: '' } as ReturnType<typeof spawnSync>);
      const r = await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: '/tmp/ws' });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('out');
    });

    it('returns exitCode 1 when status is null (killed)', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: null, stdout: '', stderr: 'killed' } as ReturnType<typeof spawnSync>);
      const r = await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: '/tmp/ws' });
      expect(r.exitCode).toBe(1);
    });
  });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/runner/claude/__tests__/cli.test.ts`

Expected: FAIL — the current `cli.ts` still passes `--allowedTools Read,Write` and reads `writableRelativePaths`.

- [X] **Step 3: Replace src/lib/runner/types.ts**

```ts
export interface RunnerResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface RunnerOptions {
    prompt: string;
    workspaceDir: string;   // the temp agent cwd (the only writable area)
    projectRoot?: string;   // the real project dir; when set, the runner sandboxes the project read-only
}

export interface Runner {
    isAvailable(): boolean;
    run(opts: RunnerOptions): Promise<RunnerResult>;
}
```

- [X] **Step 4: Replace src/lib/runner/claude/cli.ts**

```ts
import { spawnSync } from 'child_process';
import type { Runner, RunnerOptions, RunnerResult } from '../types.js';
import { writePermissions } from './permissions.js';

export class ClaudeCliRunner implements Runner {
    isAvailable(): boolean {
        try {
            const result = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
            return result.status === 0;
        } catch {
            return false;
        }
    }

    async run(opts: RunnerOptions): Promise<RunnerResult> {
        const { prompt, workspaceDir, projectRoot } = opts;

        // The workspace cwd is writable under acceptEdits; the project is re-granted
        // read-only via settings.json. Bash is deliberately NOT allowed (write bypass).
        if (projectRoot) {
            writePermissions(workspaceDir, projectRoot);
        }

        const result = spawnSync(
            'claude',
            ['-p', prompt, '--permission-mode', 'acceptEdits', '--setting-sources', 'project'],
            {
                cwd: workspaceDir,
                encoding: 'utf8',
                shell: true,
                maxBuffer: 10 * 1024 * 1024,
            }
        );

        return {
            exitCode: result.status ?? 1,
            stdout: (result.stdout as string) ?? '',
            stderr: (result.stderr as string) ?? '',
        };
    }
}
```

- [X] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/runner/claude/__tests__/cli.test.ts && npm run typecheck`

Expected: PASS, no type errors.

- [X] **Step 6: Commit**

```bash
git add src/lib/runner/types.ts src/lib/runner/claude/cli.ts src/lib/runner/claude/__tests__/cli.test.ts
git commit -m "feat: spawn claude with acceptEdits + project read-only sandbox via projectRoot"
```

---

### Task 3: Real `claude -p` sandbox integration test (the gate)

Proves the *behavior* the unit tests can't: an in-workspace write succeeds and a project write is **blocked** — asserting **file state**, because a deny-rule block never appears in `permission_denials`. Auto-skips when `claude` is not installed, so normal CI is unaffected.

**Files:**
- Create: `src/lib/runner/claude/__tests__/sandbox.integration.test.ts`

- [X] **Step 1: Write the integration test**

Create `src/lib/runner/claude/__tests__/sandbox.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCliRunner } from '../cli.js';

const runner = new ClaudeCliRunner();
const claudeAvailable = runner.isAvailable();

// Real claude -p calls — slow and cost money; auto-skipped when claude is absent.
describe.skipIf(!claudeAvailable)('ClaudeCliRunner sandbox (real claude -p)', () => {
    async function runScenario(projectRootDir: string): Promise<void> {
        const projectRoot  = mkdtempSync(join(tmpdir(), projectRootDir));
        const workspaceDir = mkdtempSync(join(tmpdir(), 'csi-ws'));
        const OUT_TXT = 'out.txt';
        writeFileSync(join(projectRoot, 'CONTEXT.md'), '# context');
        try {
            const runningInsideWs = await runner.run({
                prompt: `Use the Write tool to create a file named ${OUT_TXT} in the current working directory with the exact contents following the colon : OK`,
                workspaceDir,
                projectRoot,
            });
            expect(runningInsideWs.exitCode).toBe(0);
            expect(existsSync(join(workspaceDir, OUT_TXT))).toBe(true); // in-workspace write allowed

            const leakTarget = join(projectRoot, 'leak.txt');
            await runner.run({
                prompt: `Use the Write tool to create a file at the absolute path ${leakTarget} with the exact contents following the colon : LEAK`,
                workspaceDir,
                projectRoot,
            });
            expect(existsSync(leakTarget)).toBe(false); // project write blocked — file state is ground truth
        } finally {
            rmSync(projectRoot, { recursive: true, force: true });
            rmSync(workspaceDir, { recursive: true, force: true });
        }
    }

    it('allows in-workspace writes and blocks project writes', async () => {
        await runScenario('csi-proj');
    }, 180_000);

    it('holds when the project path contains a space', async () => {
        await runScenario('csi proj '); // prefix with a space -> spaced project dir
    }, 180_000);
});
```

- [X] **Step 2: Run the integration test**

Run (only meaningful with `claude` installed): `npx vitest run src/lib/runner/claude/__tests__/sandbox.integration.test.ts`

Expected: PASS (both scenarios) when `claude` is available; SKIPPED otherwise. If it FAILS, stop — the sandbox is not functioning and no later task should be trusted.

> **Gate finding (2026-06-06):** the first run FAILED at the in-workspace assertion — `claude` exited 0 but wrote nothing. Root cause was in **Task 2's `cli.ts`**, not the sandbox: `spawnSync` with `shell: true` + the multi-word `prompt` as an argv element concatenates the command line **unquoted**, so the shell word-split the prompt and `claude` received only `"Use"`. Fix: pass the prompt via **stdin** (`input: prompt`) and drop it from the args array (remaining args are single tokens, safe under `shell:true`). `cli.test.ts` updated to assert the prompt on `opts.input` instead of in `args` — a unit-level regression guard. The sandbox mechanism itself (acceptEdits + `additionalDirectories` + MSYS deny globs) was proven correct once the prompt actually reached `claude`. The Task 2 §"Step 4" snippet above still shows the old arg form; treat `cli.ts`/`cli.test.ts` in the repo as authoritative.

- [X] **Step 3: Commit**

```bash
git add src/lib/runner/claude/__tests__/sandbox.integration.test.ts
git commit -m "test: real claude -p sandbox integration test (asserts file state)"
```

---

### Task 4: Rework workspace manager (deterministic naming + orphan sweep)

**Files:**
- Rework: `src/lib/workspace.ts`
- Rework: `src/lib/__tests__/workspace.test.ts`

- [X] **Step 1: Replace the test file**

Overwrite `src/lib/__tests__/workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspace, copyBack, cleanupWorkspace, sweepOrphanWorkspaces } from '../workspace.js';

const PROJECT_ROOT = join(tmpdir(), 'my-project');
const CHANGE = 'add-auth';
const PROPOSAL = 'proposal.md';
const SPEC_NESTED = 'specs/auth/spec.md';

describe('workspace', () => {
  let changeDir: string;

  beforeEach(() => {
    changeDir = join(tmpdir(), `ws-src-${Date.now()}`);
    mkdirSync(join(changeDir, 'specs', 'auth'), { recursive: true });
    writeFileSync(join(changeDir, PROPOSAL), '# Proposal');
    writeFileSync(join(changeDir, 'specs', 'auth', 'spec.md'), '# Auth Spec');
  });
  afterEach(() => {
    rmSync(changeDir, { recursive: true, force: true });
  });

  describe('createWorkspace', () => {
    it('creates a temp dir whose name encodes project base, change, role and round', () => {
      const ws = createWorkspace(PROJECT_ROOT, CHANGE, 'proposer', 3, changeDir, []);
      try {
        expect(existsSync(ws.dir)).toBe(true);
        expect(ws.dir).toContain('csi-opsx-my-project-');
        expect(ws.dir).toContain('-add-auth-proposer-3');
      } finally {
        rmSync(ws.dir, { recursive: true, force: true });
      }
    });

    it('is deterministic for the same project/change/role/round', () => {
      const a = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, []);
      const b = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, []);
      try {
        expect(a.dir).toBe(b.dir);
      } finally {
        rmSync(a.dir, { recursive: true, force: true });
        rmSync(b.dir, { recursive: true, force: true });
      }
    });

    it('copies flat and nested files, preserving structure', () => {
      const ws = createWorkspace(PROJECT_ROOT, CHANGE, 'proposer', 1, changeDir, [PROPOSAL, SPEC_NESTED]);
      try {
        expect(readFileSync(join(ws.dir, PROPOSAL), 'utf8')).toBe('# Proposal');
        expect(existsSync(join(ws.dir, 'specs', 'auth', 'spec.md'))).toBe(true);
      } finally {
        rmSync(ws.dir, { recursive: true, force: true });
      }
    });

    it('skips files absent from the source dir', () => {
      const ws = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, ['nope.md']);
      try { expect(existsSync(join(ws.dir, 'nope.md'))).toBe(false); } finally { rmSync(ws.dir, { recursive: true, force: true }); }
    });
  });

  describe('copyBack', () => {
    it('copies files (incl. nested) from workspace back to the change dir', () => {
      const ws = createWorkspace(PROJECT_ROOT, CHANGE, 'proposer', 1, changeDir, [PROPOSAL, SPEC_NESTED]);
      try {
        writeFileSync(join(ws.dir, PROPOSAL), '# Updated');
        writeFileSync(join(ws.dir, SPEC_NESTED), '# Updated Spec');
        copyBack(ws.dir, changeDir, [PROPOSAL, SPEC_NESTED]);
        expect(readFileSync(join(changeDir, PROPOSAL), 'utf8')).toBe('# Updated');
        expect(readFileSync(join(changeDir, SPEC_NESTED), 'utf8')).toBe('# Updated Spec');
      } finally {
        rmSync(ws.dir, { recursive: true, force: true });
      }
    });
  });

  describe('cleanupWorkspace', () => {
    it('removes the workspace dir', () => {
      const ws = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, []);
      cleanupWorkspace(ws.dir);
      expect(existsSync(ws.dir)).toBe(false);
    });

    it('does not throw if the workspace is absent', () => {
      expect(() => cleanupWorkspace(join(tmpdir(), 'csi-opsx-absent'))).not.toThrow();
    });
  });

  describe('sweepOrphanWorkspaces', () => {
    it('removes leftover dirs for this project+change but leaves other changes alone', () => {
      const mine = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, []);
      const other = createWorkspace(PROJECT_ROOT, 'add-billing', 'reviewer', 1, changeDir, []);
      try {
        sweepOrphanWorkspaces(PROJECT_ROOT, CHANGE);
        expect(existsSync(mine.dir)).toBe(false);
        expect(existsSync(other.dir)).toBe(true);
      } finally {
        rmSync(mine.dir, { recursive: true, force: true });
        rmSync(other.dir, { recursive: true, force: true });
      }
    });

    it('does not sweep a change whose name merely extends this one (add-auth vs add-auth-extra)', () => {
      const mine = createWorkspace(PROJECT_ROOT, CHANGE, 'reviewer', 1, changeDir, []);
      const sibling = createWorkspace(PROJECT_ROOT, `${CHANGE}-extra`, 'reviewer', 1, changeDir, []);
      try {
        sweepOrphanWorkspaces(PROJECT_ROOT, CHANGE);
        expect(existsSync(mine.dir)).toBe(false);
        expect(existsSync(sibling.dir)).toBe(true);
      } finally {
        rmSync(mine.dir, { recursive: true, force: true });
        rmSync(sibling.dir, { recursive: true, force: true });
      }
    });
  });
});
```

> **Teardown convention:** every `finally` block uses raw `rmSync(dir, { recursive: true, force: true })` rather than `cleanupWorkspace`. Teardown must depend only on trusted primitives, never on the function under test — otherwise a regression in `cleanupWorkspace` would silently leak temp dirs while the suite stays green (or throw inside an unrelated test's `finally` and misattribute the failure). `cleanupWorkspace` is exercised only in its own `describe` block, where it *is* the system under test. `force: true` already no-ops on a missing path, so the raw call is exactly as safe.

- [X] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/workspace.test.ts`

Expected: FAIL (3 of 9) — `createWorkspace` still uses the old `Date.now()` naming body, so the name-encoding test fails; `sweepOrphanWorkspaces` is an empty stub, so both sweep tests leave `mine.dir` and fail. `typecheck` is clean. (Observed 2026-06-07: `is deterministic` passes only *coincidentally* — two back-to-back `Date.now()` calls usually land in the same millisecond — and becomes a stable, real pass once Step 3 implements deterministic naming.)

- [ ] **Step 3: Replace src/lib/workspace.ts**

```ts
import { mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import type { AgentRole } from './types.js';

export interface Workspace {
    dir: string;
}

// Deterministic prefix shared by every temp dir for one (project, change).
// pathHash disambiguates two same-named checkouts that share the OS temp namespace.
function workspacePrefix(projectRoot: string, changeName: string): string {
    const base = basename(projectRoot);
    // Windows and (default) macOS filesystems are case-insensitive, so normalize
    // case before hashing. NOTE: a case-sensitive-formatted APFS volume would be
    // mishandled here — rare enough to accept.
    const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';
    const normalized = caseInsensitiveFs ? projectRoot.toLowerCase() : projectRoot;
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    return `csi-opsx-${base}-${hash}-${changeName}`;
}

export function createWorkspace(
    projectRoot: string,
    changeName: string,
    role: AgentRole,
    round: number,
    artifactsDir: string,
    relativeFiles: string[]
): Workspace {
    const dir = join(tmpdir(), `${workspacePrefix(projectRoot, changeName)}-${role}-${round}`);
    // Deterministic name: remove any stale dir from a prior crashed run before recreating.
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    for (const relFile of relativeFiles) {
        const src = join(artifactsDir, relFile);
        if (existsSync(src)) {
            const dest = join(dir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }

    return { dir };
}

// Copies files in list order — callers that need atomicity put the commit-marker file last.
export function copyBack(workspaceDir: string, artifactsDir: string, relativeFiles: string[]): void {
    for (const relFile of relativeFiles) {
        const src = join(workspaceDir, relFile);
        if (existsSync(src)) {
            const dest = join(artifactsDir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }
}

export function cleanupWorkspace(workspaceDir: string): void {
    if (existsSync(workspaceDir)) {
        rmSync(workspaceDir, { recursive: true, force: true });
    }
}

// Remove orphaned temp dirs from prior crashed runs — scoped to this (project, change)
// by matching the exact workspace-name shape under the OS temp dir. The matching rules
// (escaping + anchoring) are explained inline below.
export function sweepOrphanWorkspaces(projectRoot: string, changeName: string): void {
    const prefix = workspacePrefix(projectRoot, changeName);
    // `prefix` embeds the project's folder name, which can contain regex metacharacters
    // ('.', '(', '+', …). Inserted into a pattern raw, those would act as operators —
    // e.g. an unescaped '.' means "any character", so a prefix built from "My.App" would
    // also match a DIFFERENT project's dir like "MyXApp" and we'd delete its workspaces.
    // This replace puts a backslash before every metachar ($& = the matched char) so each
    // is matched literally.
    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Require the FULL name, anchored start (^) to end ($): <prefix>-<role>-<round>.
    // The role word immediately after the prefix and the trailing $ are what stop a sweep
    // of "add-auth" from also deleting "add-auth-extra" (the next chunk would be "extra",
    // not a role) or a suffixed leftover like "...-reviewer-1-old". \\d -> \d: backslashes
    // are doubled because this regex is built from a string, not written as a /literal/.
    const pattern = new RegExp(`^${safePrefix}-(reviewer|proposer)-\\d+$`);
    const base = tmpdir();
    for (const entry of readdirSync(base)) {
        if (pattern.test(entry)) {
            rmSync(join(base, entry), { recursive: true, force: true });
        }
    }
}
```

- [X] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/__tests__/workspace.test.ts && npm run typecheck`

Expected: PASS, no type errors.

- [X] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/__tests__/workspace.test.ts
git commit -m "feat: deterministic per-change workspace naming + scoped orphan sweep"
```

Landed as `739d768` (tests + implementation) + `a1c8cb1` (comment/formatting fixes + plan checkboxes), pushed to origin/master.

---

### Task 5: Finish loop controller parsers (frontmatter-anchored)

The two parsers must read **only the frontmatter block** so a body `is-solved:` line or stray "status:" text in an issue description can never be mistaken for the file-level fields. `findLatestFindingsRound` and `getFindingsPath` are currently empty stubs.

**Files:**
- Finish: `src/lib/loop.ts`
- Modify: `src/lib/__tests__/loop.test.ts`

- [X] **Step 1: Add anchoring tests to the existing test file**

Append these tests inside the existing `describe('loop', …)` in `src/lib/__tests__/loop.test.ts`:

```ts
  describe('frontmatter anchoring', () => {
    const WITH_BODY = [
      '---', 'issues-found: 2', 'round: 1', 'status: open', '---', '',
      '## Issue 1: title', 'is-solved: false', 'The doc says status: addressed somewhere.', '',
    ].join('\n');

    it('parseStatus reads the frontmatter status, ignoring body text', () => {
      expect(parseStatus(WITH_BODY)).toBe('open');
    });

    it('parseIssuesFound reads the frontmatter count, ignoring body text', () => {
      expect(parseIssuesFound(WITH_BODY)).toBe(2);
    });

    it('parseStatus throws when there is no frontmatter block', () => {
      expect(() => parseStatus('## Just a heading\nstatus: open')).toThrow('Missing status');
    });
  });
```

Also add this test to the **existing** `describe('findLatestFindingsRound', …)` block — it exercises the `!existsSync` early-return branch, which the empty-folder test skips (both return `0`, but via different code paths):

```ts
    it('returns 0 when the directory does not exist', () => {
      expect(findLatestFindingsRound(join(tmpDir, 'no-such-dir'))).toBe(0);
    });
```

- [X] **Step 2: Run tests to verify the current state fails**

Run: `npx vitest run src/lib/__tests__/loop.test.ts`

Expected: FAIL — `findLatestFindingsRound`/`getFindingsPath` are empty (return `undefined`), so the tests for them fail (including the new `returns 0 when the directory does not exist` case). Of the anchoring tests, the two `WITH_BODY` cases pass by luck (first-match-wins, frontmatter on top), but **`parseStatus throws when there is no frontmatter block` genuinely FAILS on the current unanchored parser** — the `/m` regex matches the body's `status: open` line and returns `'open'` instead of throwing. That red is the proof anchoring is needed; the Step 3 rewrite turns it green.

- [X] **Step 3: Replace src/lib/loop.ts**

```ts
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export type FindingsStatus = 'open' | 'addressed';

// Extract the YAML-ish frontmatter block (between the first pair of --- fences).
function frontmatter(content: string): string {
    const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
    return m ? m[1] : '';
}

export function parseIssuesFound(content: string): number {
    const match = frontmatter(content).match(/^issues-found:\s*(\d+)\s*$/m);
    if (!match) throw new Error('Missing issues-found field in findings frontmatter');
    return parseInt(match[1], 10);
}

export function parseStatus(content: string): FindingsStatus {
    const match = frontmatter(content).match(/^status:\s*(open|addressed)\s*$/m);
    if (!match) throw new Error('Missing status field in findings frontmatter');
    return match[1] as FindingsStatus;
}

export function findLatestFindingsRound(artifactsDir: string): number {
    if (!existsSync(artifactsDir)) return 0;
    const rounds = readdirSync(artifactsDir)
        .map((f) => f.match(/^review-findings-(\d+)\.md$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => parseInt(m[1], 10));
    return rounds.length === 0 ? 0 : Math.max(...rounds);
}

export function getFindingsPath(artifactsDir: string, round: number): string {
    return join(artifactsDir, `review-findings-${round}.md`);
}
```

- [X] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/__tests__/loop.test.ts && npm run typecheck`

Expected: PASS — all loop tests (existing + anchoring) pass.

- [X] **Step 5: Commit**

```bash
git add src/lib/loop.ts src/lib/__tests__/loop.test.ts
git commit -m "feat: finish loop parsers; anchor issues-found/status to frontmatter"
```

---

### Task 6: Artifact enumeration + change-name validation

**Files:**
- Create: `src/lib/artifacts.ts`
- Create: `src/lib/__tests__/artifacts.test.ts`

- [X] **Step 1: Write failing tests**

> Design notes (why the tests look like this): `validateChangeName` is split into a whole-name loop (`'', '.', '..'`) and a separators-only embedded loop (`'/', '\\'`). `..` is deliberately *not* tested embedded between alnums — `add-auth..x` is a single safe path segment the validator correctly accepts; only separators are dangerous wherever they appear. The capability-spec assertion uses a forward-slash literal (not `join`, which yields `\` on Windows and would break the permission globs). `ignores unknown files` pins the allowlist design so a future "walk the whole dir" refactor can't silently leak `review-findings-*.md` back to the agent.
>
> **Depth-1 finding (2026-06-09, verified from OpenSpec source):** capability dirs under `specs/` are exactly ONE level deep. Every discovery site in Fission-AI/OpenSpec (`specs-apply.ts` `findSpecUpdates`, `item-discovery.ts` `getSpecIds`, `list.ts`, `view.ts`, `archive.ts`, `validator.ts`) does a single non-recursive `readdir` + `join(specsDir, entry.name, 'spec.md')`; a deeper `specs/auth/sso/spec.md` is silently ignored at apply time. So our enumeration is depth-1 too — recursing would grant write access to files OpenSpec can never apply. The `ignores spec.md files nested deeper than one capability level` test pins this; the originally planned recursive `collectSpecs` helper is deleted.

Create `src/lib/__tests__/artifacts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateChangeName, getChangeDirectory, enumerateChangeArtifacts} from '../artifacts.js';

const CHANGE = 'add-auth';
describe('artifacts', () => {

    let projectRoot: string;
    let changeDir: string;

    beforeEach(() => {
        projectRoot = join(tmpdir(), `proj-${Date.now()}`);
        changeDir = join(projectRoot, 'openspec', 'changes', CHANGE);
        mkdirSync(changeDir, { recursive: true });
    });
    afterEach(() => {
        rmSync(projectRoot, { recursive: true, force: true });
    });

    describe('validateChangeName', () => {
        it('accepts normal names', () => {
           expect(() => validateChangeName('add-auth_v2.1')).not.toThrow();
        });
        it('rejects traversal and separators', () => {
            // invalid as a whole name (empty / current-dir / parent-dir)
            for (const name of ['', '.', '..']) {
                expect(() => validateChangeName(name)).toThrow();
            }
            for (const fragment of ['/', '\\']) {
                // standalone
                expect(() => validateChangeName(fragment)).toThrow();
                // embedded *in the middle*
                expect(() => validateChangeName(`${CHANGE}${fragment}x`)).toThrow();
            }
        });
    });

    describe('getChangeDirectory', () => {
        it('builds the change directory under openspec/changes', () => {
            expect(getChangeDirectory(projectRoot, CHANGE)).toBe(changeDir);
        });
        it('validates the name before building a path', () => {
            expect(() => getChangeDirectory(projectRoot, '..')).toThrow();
        });
    });

    describe('enumerateChangeArtifacts', () => {
        const PROPOSAL_MD = 'proposal.md';
        const TASKS_MD = 'tasks.md';
        const SPECS_DIR = 'specs';
        const AUTH_DIR = 'auth';
        const SPEC_MD = 'spec.md';
        it('returns only the known artifact files that exist', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, TASKS_MD), 'x'); // design.md intentionally absent
            expect(enumerateChangeArtifacts(projectRoot, CHANGE).sort()).toEqual([PROPOSAL_MD, TASKS_MD]);
        });

        it('includes nested specs/<capability>/spec.md with forward slashes', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            mkdirSync(join(changeDir, SPECS_DIR, AUTH_DIR), { recursive: true });
            writeFileSync(join(changeDir, SPECS_DIR, AUTH_DIR, SPEC_MD), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE).sort())
                .toEqual([PROPOSAL_MD, `${SPECS_DIR}/${AUTH_DIR}/${SPEC_MD}`]);
        });

        it('ignores spec.md files nested deeper than one capability level', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            // specs/auth/sso/spec.md — OpenSpec would never apply this, so it is not an artifact
            mkdirSync(join(changeDir, SPECS_DIR, AUTH_DIR, 'sso'), { recursive: true });
            writeFileSync(join(changeDir, SPECS_DIR, AUTH_DIR, 'sso', SPEC_MD), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('excludes .openspec.yaml and review-findings files', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, '.openspec.yaml'), 'x');
            writeFileSync(join(changeDir, 'review-findings-1.md'), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('ignores unknown files', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, 'notes.md'), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('throws when the change folder does not exist', () => {
            expect(() => enumerateChangeArtifacts(projectRoot, 'no-such-change')).toThrow();
        });
    });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/artifacts.test.ts`

Expected: FAIL (all but one). `accepts normal names` passes — an empty-bodied `validateChangeName` never throws, so `.not.toThrow()` holds. The rest fail because the stubs don't return/throw yet; the two `enumerate(...).sort()` cases surface as `TypeError: Cannot read properties of undefined (reading 'sort')`, which clears once the function returns an array. (artifacts.ts already exists as stubs this session, so it's assertion/Type failures rather than the module-not-found this step originally predicted.) Verified red 2026-06-09 at 8-fail/1-pass; the depth-1 test was added to the sketch after that run — write it and re-confirm red (9-fail/1-pass) before starting Step 3.

- [X] **Step 3: Implement src/lib/artifacts.ts**

```ts
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const KNOWN_FILES = ['proposal.md', 'design.md', 'tasks.md'];

/*
   A change name must be a single safe path segment — rejected BEFORE any path is built,
   so `--change ..` can never escape openspec/changes/.
*/
export function validateChangeName(name: string): void {
    if (name === '.' || name === '..' || !/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error(`Invalid change name: ${JSON.stringify(name)}`);
    }
}

export function getChangeDirectory(projectRoot: string, changeName: string): string {
    validateChangeName(changeName);
    return join(projectRoot, 'openspec', 'changes', changeName);
}

/*
   Returns artifact paths RELATIVE to the change dir, forward-slashed.
   Deterministic: same folder in -> same list out, no model in the loop.
*/
export function enumerateChangeArtifacts(projectRoot: string, changeName: string): string[] {
    const SPECS_SUBDIR = 'specs';
    const SPEC_MD = 'spec.md';

    const changeDirectory = getChangeDirectory(projectRoot, changeName);
    if (!existsSync(changeDirectory)) {
        throw new Error(`Change folder not found: openspec/changes/${changeName}`);
    }

    const found = KNOWN_FILES.filter(f => existsSync(join(changeDirectory, f)));
    const specsDirectory = join(changeDirectory, SPECS_SUBDIR);

    if (!existsSync(specsDirectory)) { return found; }

    /*
    OpenSpec capabilities are exactly one level deep (specs/<capability>/spec.md) —
    its apply/list/view code never recurses, so neither do we. A deeper spec.md is
    invisible to OpenSpec at apply time and must not become a writable artifact.
    */
    const specs = readdirSync(specsDirectory, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(specsDirectory, entry.name, SPEC_MD)))
        .map(entry => `${SPECS_SUBDIR}/${entry.name}/${SPEC_MD}`);
    return [...found, ...specs];
}
```

- [X] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/__tests__/artifacts.test.ts && npm run typecheck`

Expected: PASS, no type errors. Verified 2026-06-10: **10/10 tests pass**, `tsc --noEmit` clean (after removing the dead `statSync` import left over from deleting `collectSpecs`).

- [X] **Step 5: Commit**

Landed as `d3cd20d` 2026-06-10 (bundled artifacts.ts + artifacts.test.ts + this plan's Task 6 edits). Not pushed yet.

```bash
git add src/lib/artifacts.ts src/lib/__tests__/artifacts.test.ts
git commit -m "feat: change-folder artifact enumeration + change-name validation"
```

---

### Task 7: Agent prompt builders

The reviewer reads artifacts + context **in place** (it cannot write them) and writes `review-findings-N.md` into its **working directory**. The proposer edits the **copies** in its working directory and owns the `status` flip + per-issue `is-solved`.

**Files:**
- Create: `src/commands/propose/agents.ts`

- [X] **Step 1: Write src/commands/propose/agents.ts**

> Design notes (2026-06-10): **No personas.** Both prompts lead with an imperative ("Please thoroughly review…", "Please thoroughly evaluate… and address every issue…") rather than "You are an expert…". Controlled studies find persona/credential framing does not reliably improve objective-task accuracy and can nudge a reviewer toward false confidence; the behavioral adjective "thoroughly" is kept because it describes *how to act*, not a credential. **Clarity-with-a-fence:** each role is told to write its prose (issue descriptions / artifact revisions) clearly and unambiguously for both a downstream agent and a human — but explicitly NOT to restyle the machine-read structure. The findings file's frontmatter (`issues-found`, `status`) and `---` fences are parsed by `loop.ts` with column-0 anchors (`/^---/`, `/^issues-found:/m`, `/^status:/m`), so the reviewer prompt also states the file MUST BEGIN with `---` and keep those lines exact; `is-solved:` is read by the *next* round's reviewer, not the parser, so it is convention rather than machine-critical. **contextBlock** also points agents at the project's source (general path, conditional "read only what's relevant") and lists `AGENTS.md` beside `CLAUDE.md`. The template literals are flush-left (column 0): their leading whitespace is literal, and indenting them would leak indented frontmatter into the findings file and break the parser.

```ts
import type { AgentRole } from '../../lib/types.js';

export interface PromptArgs {
    projectRoot: string;       // read-only context root (absolute)
    changeDir: string;         // <projectRoot>/openspec/changes/<name> (absolute)
    artifactRelPaths: string[]; // artifact paths relative to changeDir
    round: number;
}

export interface AgentConfig {
    role: AgentRole;
    buildPrompt(args: PromptArgs): string;
}

function contextBlock(projectRoot: string): string {
    return [
        `Read these for project context (READ-ONLY — you cannot and must not modify them):`,
        `- ${projectRoot}/CLAUDE.md or ${projectRoot}/AGENTS.md (project conventions, if present)`,
        `- ${projectRoot}/openspec/ (existing specs and schemas)`,
        `- ${projectRoot}/docs/ (ADRs and other docs, if present)`,
        `- the project's source code under ${projectRoot}/ — when a claim or requirement`,
        `  depends on how the system actually behaves, read the specific source files`,
        `  involved rather than relying on documentation alone. Read only what's relevant.`,
    ].join('\n');
}

export const ReviewerAgent: AgentConfig = {
    role: 'reviewer',
    buildPrompt({ projectRoot, changeDir, artifactRelPaths, round }) {
        const artifactList = artifactRelPaths.map((a) => `- ${changeDir}/${a}`).join('\n');
        const prior =
            round > 1
                ? `\nAlso read ${changeDir}/review-findings-${round - 1}.md and verify each prior issue was actually addressed.\n`
                : '';
        return `Please thoroughly review the following artifact files (READ-ONLY — review them, do not modify them):
${artifactList}

${contextBlock(projectRoot)}
${prior}
Review the artifacts for: inconsistencies between artifacts, missing edge cases or error handling,
ambiguous or contradictory requirements, and violations of the project conventions. Evaluate them for
logical or semantic errors in light of the goals the artifacts themselves state, in the context of this project.

Write your findings to a NEW file named "review-findings-${round}.md" in your CURRENT WORKING DIRECTORY
(not in the project, not in the change folder). The file MUST BEGIN with the frontmatter block below — its
very first line is "---", with no title or other text before it. Use exactly this format:

---
issues-found: <integer; 0 if none>
round: ${round}
status: open
---

## Issue 1: <short title>
is-solved: false
<description, naming which artifact it appears in>

Repeat the "## Issue N" block for every issue, each starting with "is-solved: false".
If there are no issues, write "issues-found: 0" and include no issue sections.

Write each issue's description so it is specific and unambiguous — name the artifact it appears in, point to
the exact location, and explain why it is a problem — so that both the proposer agent and a human reader can
act on it without guessing. This clarity guidance applies to your prose; keep the frontmatter and the
"## Issue N" / "is-solved:" lines exactly as specified above so the harness can parse them.`;
    },
};

export const ProposerAgent: AgentConfig = {
    role: 'proposer',
    buildPrompt({ projectRoot, artifactRelPaths, round }) {
        const artifactList = artifactRelPaths.map((a) => `- ${a}`).join('\n');
        return `Please thoroughly evaluate the reviewer's findings and address every issue they raise.

Your CURRENT WORKING DIRECTORY contains writable copies of the artifacts to revise:
${artifactList}

It also contains the reviewer's findings: review-findings-${round}.md

${contextBlock(projectRoot)}

review-findings-${round}.md contains a reviewer agent's findings — design, consistency, and
correctness problems it identified in the artifacts. For each issue whose "is-solved" is false,
evaluate it and apply the fix its description calls for, editing the artifact copies in your
working directory. If you judge an issue to be invalid, you may leave it unfixed and explain why
in its resolution (below) rather than forcing a change.

Then update review-findings-${round}.md in your working directory:
- For each issue you fixed, change its "is-solved: false" to "is-solved: true".
- Under each issue add a line: "**Resolution (proposer):** <what you changed, or why you did not fix it>".
- When your pass is complete, change the frontmatter "status: open" to "status: addressed".
- Do NOT change "issues-found" — it records how many issues this review found and stays fixed even as
  you resolve them; it is not a live count of what remains. Also do not alter the reviewer's issue titles or descriptions.

When you revise the artifacts, write clearly, precisely, and consistently, so that a downstream reviewer
agent and a human reader arrive at the same unambiguous understanding. Do not sacrifice any file's required
structure for style — in particular, preserve the findings file's frontmatter and "is-solved:" lines exactly.

Only edit files inside your working directory. Do not create or modify any other files.`;
    },
};
```

- [X] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/propose/agents.ts
git commit -m "feat: reviewer/proposer prompt builders (is-solved format, least-privilege)"
```

---

### Task 8: Harness orchestration + CLI `--change`/`--max-rounds`

**Files:**
- Rework: `src/commands/propose/harness.ts`
- Modify: `src/bin/cli.ts`

- [ ] **Step 1: Replace src/commands/propose/harness.ts**

```ts
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveRunner } from '../../lib/runner/index.js';
import type { Runner, RunnerResult } from '../../lib/runner/types.js';
import { createWorkspace, copyBack, cleanupWorkspace, sweepOrphanWorkspaces } from '../../lib/workspace.js';
import type { Workspace } from '../../lib/workspace.js';
import { parseIssuesFound, parseStatus, findLatestFindingsRound, getFindingsPath } from '../../lib/loop.js';
import { getChangeDirectory, enumerateChangeArtifacts, validateChangeName } from '../../lib/artifacts.js';
import { ReviewerAgent, ProposerAgent } from './agents.js';

export interface HarnessOptions {
    workspace: string;   // project root (the --workspace CLI arg)
    changeName: string;  // the --change CLI arg
    maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 5;

// Run one agent stage in its workspace. The workspace is ALWAYS cleaned up (finally),
// even on failure; the copy-back `commit` runs only on a clean exit (exitCode 0).
// Cleanup is in the finally and process.exit is left to the caller AFTER this returns,
// because calling process.exit inside the try would skip the finally and leak the dir.
async function runStage(
    runner: Runner,
    ws: Workspace,
    prompt: string,
    projectRoot: string,
    commit: () => void,
): Promise<RunnerResult> {
    try {
        const res = await runner.run({ prompt, workspaceDir: ws.dir, projectRoot });
        if (res.exitCode === 0) commit();
        return res;
    } finally {
        cleanupWorkspace(ws.dir);
    }
}

export async function runProposeHarness(opts: HarnessOptions): Promise<void> {
    const { workspace: projectRoot, changeName, maxRounds = DEFAULT_MAX_ROUNDS } = opts;

    validateChangeName(changeName);
    const changeDir = getChangeDirectory(projectRoot, changeName);
    const artifacts = enumerateChangeArtifacts(projectRoot, changeName);
    if (artifacts.length === 0) {
        console.log(`⚠ csi-opsx: no artifacts found in openspec/changes/${changeName}. Nothing to review.`);
        return;
    }

    const runner = resolveRunner();
    if (!runner) {
        console.log([
            '⚠ csi-opsx: No runner available.',
            '  Automated review loop unavailable.',
            '  Install Claude Code to enable the automated review loop.',
        ].join('\n'));
        return;
    }

    sweepOrphanWorkspaces(projectRoot, changeName);

    // --- Decide the starting phase from the committed findings (resumability) ---
    let round = findLatestFindingsRound(changeDir);
    let phase: 'reviewer' | 'proposer';
    if (round === 0) {
        round = 1;
        phase = 'reviewer';
    } else {
        const latest = readFileSync(getFindingsPath(changeDir, round), 'utf8');
        const status = parseStatus(latest);
        const issues = parseIssuesFound(latest);
        if (status === 'open' && issues === 0) {
            printSummary(changeDir, round, artifacts);
            return;
        }
        if (status === 'open') {
            phase = 'proposer';        // reviewer already produced findings; proposer's turn for round N
        } else {
            round = round + 1;         // status: addressed -> reviewer for the next round
            phase = 'reviewer';
        }
    }

    while (round <= maxRounds) {
        const findingsName = `review-findings-${round}.md`;

        if (phase === 'reviewer') {
            // Reviewer reads artifacts in place; its workspace is empty and it writes only the findings file.
            const ws = createWorkspace(projectRoot, changeName, 'reviewer', round, changeDir, []);
            console.log(`  Round ${round}: reviewer running...`);
            const res = await runStage(
                runner,
                ws,
                ReviewerAgent.buildPrompt({ projectRoot, changeDir, artifactRelPaths: artifacts, round }),
                projectRoot,
                () => { if (existsSync(join(ws.dir, findingsName))) copyBack(ws.dir, changeDir, [findingsName]); },
            );
            if (res.exitCode !== 0) {
                console.error(`Reviewer failed (round ${round}):\n${res.stderr}`);
                process.exit(1);
            }
            const findingsPath = getFindingsPath(changeDir, round);
            if (!existsSync(findingsPath)) {
                console.error(`Reviewer did not write ${findingsName}`);
                process.exit(1);
            }
            if (parseIssuesFound(readFileSync(findingsPath, 'utf8')) === 0) {
                printSummary(changeDir, round, artifacts);
                return;
            }
            phase = 'proposer';
        } else {
            // Proposer edits writable copies of the artifacts + findings; commit copies findings LAST.
            const proposerFiles = [...artifacts, findingsName];
            const ws = createWorkspace(projectRoot, changeName, 'proposer', round, changeDir, proposerFiles);
            const issues = parseIssuesFound(readFileSync(getFindingsPath(changeDir, round), 'utf8'));
            console.log(`  Round ${round}: proposer running (${issues} issue${issues === 1 ? '' : 's'})...`);
            const res = await runStage(
                runner,
                ws,
                ProposerAgent.buildPrompt({ projectRoot, changeDir, artifactRelPaths: artifacts, round }),
                projectRoot,
                () => copyBack(ws.dir, changeDir, proposerFiles),
            );
            if (res.exitCode !== 0) {
                console.error(`Proposer failed (round ${round}):\n${res.stderr}`);
                process.exit(1);
            }
            round++;
            phase = 'reviewer';
        }
    }

    const counts = issuesPerRound(changeDir, maxRounds);
    console.log([
        `⚠ csi-opsx propose: reached max rounds (${maxRounds}) without converging to 0 issues.`,
        `  Issues found per round: ${counts.join(', ')}`,
        `  Review history: ${Array.from({ length: maxRounds }, (_, i) => `review-findings-${i + 1}.md`).join(', ')}`,
        '  Review the artifacts and the findings files manually.',
    ].join('\n'));
}

function printSummary(changeDir: string, rounds: number, artifacts: string[]): void {
    const findingFiles = Array.from({ length: rounds }, (_, i) => `review-findings-${i + 1}.md`);
    const counts = issuesPerRound(changeDir, rounds);
    console.log([
        '✓ csi-opsx propose complete',
        `  Rounds: ${rounds}`,
        '  Final review: 0 issues found',
        `  Issues found per round: ${counts.join(', ')}`,
        `  Artifacts: ${artifacts.join(', ')}`,
        `  Review history: ${findingFiles.join(', ')}`,
    ].join('\n'));
}

// Each round's reviewer records its own issues-found; reading them in sequence gives the
// convergence trace (e.g. 6, 4, 2). Surfaced on the max-rounds exit so a human can see whether
// the loop was still making progress when it stopped. existsSync guards any missing round.
function issuesPerRound(changeDir: string, rounds: number): number[] {
    const counts: number[] = [];
    for (let r = 1; r <= rounds; r++) {
        const path = getFindingsPath(changeDir, r);
        if (existsSync(path)) counts.push(parseIssuesFound(readFileSync(path, 'utf8')));
    }
    return counts;
}
```

- [ ] **Step 2: Update `src/bin/cli.ts`**

Replace the `HarnessRunner` type, the `HARNESS_RUNNERS` map entry, and the `run` command. Use `HarnessOptions` as the runner's parameter type so `changeName`/`maxRounds` stay in sync:

```ts
import type { HarnessOptions } from '../commands/propose/harness.js';

type HarnessRunner = (opts: HarnessOptions) => Promise<void>;

const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    },
};

program
    .command('run')
    .description('Internal: run a harnessed command (called by skills via Bash)')
    .requiredOption('--command <name>', 'command to run (propose)')
    .requiredOption('--workspace <path>', 'project root path')
    .requiredOption('--change <name>', 'name of the change folder under openspec/changes/')
    .option('--max-rounds <n>', 'maximum reviewer→proposer rounds (default 5)', (v) => parseInt(v, 10))
    .action(async (opts) => {
        const runner = HARNESS_RUNNERS[opts.command as CommandName];
        if (!runner) {
            console.error(`Unknown command: ${opts.command}`);
            process.exit(1);
        }
        await runner({
            workspace: opts.workspace,
            changeName: opts.change,
            maxRounds: opts.maxRounds,
        });
    });
```

Notes:
- The `(v) => parseInt(v, 10)` third arg to `.option(...)` coerces the raw string to a number before the action sees it.
- `--max-rounds` is `.option` (not required); omitted → `undefined` → harness uses its default.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: no type errors. (`HarnessOptions.artifacts` no longer exists; the old `{ workspace, artifacts }` call shape is gone.)

- [ ] **Step 4: Commit**

```bash
git add src/commands/propose/harness.ts src/bin/cli.ts
git commit -m "feat: propose harness loop over a change folder; --change/--max-rounds CLI"
```

---

### Task 9: SKILL.md, harness integration tests, build verification

**Files:**
- Modify: `src/commands/propose/SKILL.md`
- Create: `src/commands/propose/__tests__/harness.test.ts`

- [ ] **Step 1: Update `src/commands/propose/SKILL.md`**

Replace the artifact-snapshot/diff steps with the change-name cascade + empty-guard, and the invocation block. The skill's run step becomes:

````md
## Resolve the change name and run the harness

1. Determine the change folder name via this cascade:
   - If the user passed an explicit name to `/csi-opsx:propose <name>`, use it.
   - Else, use the change you just created/continued via `/opsx:propose` in this session.
   - Else, list `openspec/changes/` and, if more than one active change exists, ask the user which to review.
2. **Empty-guard:** if no change folder is resolved, or the resolved folder contains no
   artifacts (`proposal.md`/`design.md`/`tasks.md`/`specs/*/spec.md`), stop and tell the
   user there is nothing to review. Do NOT invoke the harness.
3. Run via Bash (the harness enumerates the change folder itself):

   ```bash
   csi-opsx run --command=propose --workspace . --change <name>
   ```

   If the user invoked `/csi-opsx:propose` with an integer (e.g. `/csi-opsx:propose 3`),
   append `--max-rounds=<integer>`. Otherwise omit it (harness default is 5).
````

- [ ] **Step 2: Write harness integration tests (mocked runner)**

Create `src/commands/propose/__tests__/harness.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../../lib/runner/index.js', () => ({ resolveRunner: vi.fn() }));

import { resolveRunner } from '../../../lib/runner/index.js';
import { runProposeHarness } from '../harness.js';

const CHANGE = 'add-auth';

describe('runProposeHarness', () => {
  let projectRoot: string;
  let changeDir: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    changeDir = join(projectRoot, 'openspec', 'changes', CHANGE);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal');
    writeFileSync(join(changeDir, 'design.md'), '# Design');
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  const findings = (issues: number, round: number, status: 'open' | 'addressed') =>
    `---\nissues-found: ${issues}\nround: ${round}\nstatus: ${status}\n---\n`;

  it('prints a notice and exits when no runner is available', async () => {
    vi.mocked(resolveRunner).mockReturnValue(null);
    const log = vi.spyOn(console, 'log');
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No runner available'));
  });

  it('exits cleanly when the first review finds 0 issues', async () => {
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        writeFileSync(join(workspaceDir, 'review-findings-1.md'), findings(0, 1, 'open'));
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });
    const log = vi.spyOn(console, 'log');
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
    expect(existsSync(join(changeDir, 'review-findings-1.md'))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('csi-opsx propose complete'));
  });

  it('runs reviewer → proposer → reviewer until 0 issues', async () => {
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        n++;
        if (n === 1) writeFileSync(join(workspaceDir, 'review-findings-1.md'), findings(1, 1, 'open') + '## Issue 1\nis-solved: false\nx');
        else if (n === 2) {
          writeFileSync(join(workspaceDir, 'review-findings-1.md'), findings(1, 1, 'addressed'));
          writeFileSync(join(workspaceDir, 'proposal.md'), '# Updated');
        } else if (n === 3) writeFileSync(join(workspaceDir, 'review-findings-2.md'), findings(0, 2, 'open'));
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
    expect(n).toBe(3);
    expect(readFileSync(join(changeDir, 'proposal.md'), 'utf8')).toBe('# Updated');
    expect(existsSync(join(changeDir, 'review-findings-2.md'))).toBe(true);
  });

  it('resumes status=addressed by running the reviewer for the next round', async () => {
    writeFileSync(join(changeDir, 'review-findings-1.md'), findings(1, 1, 'addressed'));
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        n++;
        writeFileSync(join(workspaceDir, 'review-findings-2.md'), findings(0, 2, 'open'));
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
    expect(n).toBe(1);
    expect(existsSync(join(changeDir, 'review-findings-2.md'))).toBe(true);
  });

  it('resumes status=open (issues>0) by running the PROPOSER for the same round', async () => {
    writeFileSync(join(changeDir, 'review-findings-1.md'), findings(2, 1, 'open') + '## Issue 1\nis-solved: false\nx');
    const runMock = vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
      // Proposer pass: mark addressed
      writeFileSync(join(workspaceDir, 'review-findings-1.md'), findings(2, 1, 'addressed'));
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    // After the proposer, round 2 reviewer should find 0 issues; swap the impl on 2nd call.
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        n++;
        if (n === 1) return runMock({ workspaceDir }); // proposer for round 1
        writeFileSync(join(workspaceDir, 'review-findings-2.md'), findings(0, 2, 'open')); // reviewer round 2
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE });
    // 1st call was the proposer (NOT a re-run of the reviewer), 2nd was reviewer round 2.
    expect(n).toBe(2);
    expect(existsSync(join(changeDir, 'review-findings-2.md'))).toBe(true);
  });

  it('does NOT copy back artifacts when the proposer exits non-zero', async () => {
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        n++;
        if (n === 1) { // reviewer: 1 issue
          writeFileSync(join(workspaceDir, 'review-findings-1.md'), findings(1, 1, 'open') + '## Issue 1\nis-solved: false\nx');
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        // proposer: edits the copy but crashes (exit 1) -> must NOT reach the project
        writeFileSync(join(workspaceDir, 'proposal.md'), '# Should NOT be committed');
        return { exitCode: 1, stdout: '', stderr: 'boom' };
      }),
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('exit'); }) as never);
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE }).catch(() => {});
    expect(readFileSync(join(changeDir, 'proposal.md'), 'utf8')).toBe('# Proposal'); // unchanged
    exitSpy.mockRestore();
  });

  it('respects maxRounds when the reviewer keeps finding issues', async () => {
    let n = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        n++;
        const round = Math.ceil(n / 2);
        const name = `review-findings-${round}.md`;
        if (n % 2 === 1) writeFileSync(join(workspaceDir, name), findings(1, round, 'open') + '## Issue\nis-solved: false\nx');
        else writeFileSync(join(workspaceDir, name), findings(1, round, 'addressed'));
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });
    const log = vi.spyOn(console, 'log');
    await runProposeHarness({ workspace: projectRoot, changeName: CHANGE, maxRounds: 2 });
    expect(n).toBe(4); // 2 rounds × (reviewer + proposer)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reached max rounds'));
  });
});
```

- [ ] **Step 3: Run the full unit suite + typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS — all unit tests (permissions, cli, workspace, loop, artifacts, harness) pass; the real-`claude` sandbox test is skipped unless `claude` is installed; no type errors.

- [ ] **Step 4: Full build**

Run: `npm run build`

Expected: `dist/` built with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/propose/SKILL.md src/commands/propose/__tests__/harness.test.ts
git commit -m "feat: propose SKILL change-name cascade + harness integration tests"
```

---

### Task 10 (Optional — do only if time permits): Bash-bypass assertion

Defense-in-depth. The `Write`/`Edit` deny is tool-specific, so the one path-agnostic way around it is the `Bash` tool. Because the runner never passes `--allowedTools`, `Bash` needs approval and is auto-denied under `-p`. This adds a scenario proving the agent cannot write into the read-only project via `Bash`. (Auto-skipped when `claude` is absent, like the rest of the Task 3 suite.)

**Files:**
- Modify: `src/lib/runner/claude/__tests__/sandbox.integration.test.ts`

- [ ] **Step 1: Add a Bash-bypass scenario inside the existing `describe.skipIf(!claudeAvailable)` block**

```ts
  it('does not let the agent bypass the deny via the Bash tool', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'csi-proj-'));
    const workspaceDir = mkdtempSync(join(tmpdir(), 'csi-ws-'));
    const target = join(projectRoot, 'bash-leak.txt');
    try {
      await runner.run({
        prompt: `Use the Bash tool to run a shell command that writes the text LEAK into the file at ${target}.`,
        workspaceDir,
        projectRoot,
      });
      expect(existsSync(target)).toBe(false); // Bash is not allowed -> auto-denied under -p
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 180_000);
```

- [ ] **Step 2: Run (only meaningful with `claude` installed)**

Run: `npx vitest run src/lib/runner/claude/__tests__/sandbox.integration.test.ts`

Expected: PASS (or SKIPPED if `claude` is absent).

- [ ] **Step 3: Commit**

```bash
git add src/lib/runner/claude/__tests__/sandbox.integration.test.ts
git commit -m "test(optional): assert Bash cannot bypass the project write-deny"
```

---

## Self-Review (run before handing off)

- **Spec coverage:** Trust boundary (Task 6 `validateChangeName`/enumerate; Task 8 `--change`), write sandbox (Tasks 1–3), reviewer-reads-in-place / proposer-copies (Tasks 7–8), proposer-owns-status + `is-solved` (Tasks 7–8, format), crash model / findings-last copy-back / resume-open⇒proposer (Task 8), deterministic naming + scoped sweep (Tasks 4, 8), real `claude -p` gate (Task 3). 
- **Placeholder scan:** every code step shows full code; commands have expected output.
- **Type consistency:** `RunnerOptions {prompt, workspaceDir, projectRoot?}`, `HarnessOptions {workspace, changeName, maxRounds?}`, `createWorkspace(projectRoot, changeName, role, round, artifactsDir, relativeFiles)`, `PromptArgs {projectRoot, changeDir, artifactRelPaths, round}` are used identically across Tasks 1–9.
