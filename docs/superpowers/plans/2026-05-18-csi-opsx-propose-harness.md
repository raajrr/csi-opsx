# csi-opsx Propose Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the propose harness stub with a working reviewer→proposer loop that spawns `claude -p` subprocesses in isolated temp workspaces until a reviewer reports zero issues.

**Architecture:** Five focused library modules (runner, workspace, permissions, loop) feed into two agent config objects (ReviewerAgent, ProposerAgent) that the harness orchestrator drives. The runner adapter pattern keeps future runners (Codex, Anthropic SDK) as isolated additions. Temp workspaces carry only writable files; agents read all context from the real project via absolute paths in the prompt.

**Tech Stack:** TypeScript 5, Vitest (unit + integration tests), Node.js `child_process.spawnSync` for subprocess dispatch, Node.js `fs` / `os` built-ins for workspace management

**Prerequisite:** Plan 1 (csi-opsx Infrastructure) must be complete. The harness stub at `src/commands/propose/harness.ts` will be replaced in Task 8.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/runner/types.ts` | Create | `Runner` interface and `RunnerResult` type |
| `src/lib/runner/claude-cli.ts` | Create | `ClaudeCliRunner` — spawns `claude -p` subprocess |
| `src/lib/runner/index.ts` | Create | `resolveRunner()` — detects available runner |
| `src/lib/runner/__tests__/claude-cli.test.ts` | Create | Unit tests for ClaudeCliRunner |
| `src/lib/workspace.ts` | Create | `createWorkspace()`, `copyBack()`, `cleanupWorkspace()` |
| `src/lib/__tests__/workspace.test.ts` | Create | Unit tests for workspace management |
| `src/lib/permissions.ts` | Create | `writePermissions()` — writes `.claude/settings.json` into workspace |
| `src/lib/__tests__/permissions.test.ts` | Create | Unit tests for permissions builder |
| `src/lib/loop.ts` | Create | `parseIssuesFound()`, `parseStatus()`, `findLatestFindingsRound()`, `getFindingsPath()` |
| `src/lib/__tests__/loop.test.ts` | Create | Unit tests for loop controller parsers |
| `src/commands/propose/agents.ts` | Create | `ReviewerAgent` and `ProposerAgent` configs with prompt builders |
| `src/commands/propose/harness.ts` | Modify | Replace stub with full `runProposeHarness()` implementation |
| `src/commands/propose/__tests__/harness.test.ts` | Create | Integration tests for full harness loop |

---

### Task 1: Runner types

**Files:**
- Create: `src/lib/runner/types.ts`

- [ ] **Step 1: Write src/lib/runner/types.ts**

```ts
export interface RunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Runner {
  isAvailable(): boolean;
  run(prompt: string, workspaceDir: string): Promise<RunnerResult>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/runner/types.ts
git commit -m "feat: add Runner interface and RunnerResult type"
```

---

### Task 2: ClaudeCliRunner

**Files:**
- Create: `src/lib/runner/claude-cli.ts`
- Create: `src/lib/runner/__tests__/claude-cli.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/runner/__tests__/claude-cli.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
import { ClaudeCliRunner } from '../claude-cli.js';

describe('ClaudeCliRunner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

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
    it('calls claude -p with the prompt and --allowedTools Read,Write', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0, stdout: '', stderr: '',
      } as ReturnType<typeof spawnSync>);
      const runner = new ClaudeCliRunner();
      await runner.run('test prompt', '/tmp/workspace');
      expect(spawnSync).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test prompt', '--allowedTools', 'Read,Write'],
        expect.objectContaining({ cwd: '/tmp/workspace' })
      );
    });

    it('returns exitCode 0 on success', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0, stdout: 'output', stderr: '',
      } as ReturnType<typeof spawnSync>);
      const result = await new ClaudeCliRunner().run('prompt', '/tmp/ws');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output');
    });

    it('returns exitCode 1 when status is null', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: null, stdout: '', stderr: 'killed',
      } as ReturnType<typeof spawnSync>);
      const result = await new ClaudeCliRunner().run('prompt', '/tmp/ws');
      expect(result.exitCode).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../claude-cli.js'`

- [ ] **Step 3: Implement src/lib/runner/claude-cli.ts**

```ts
import { spawnSync } from 'child_process';
import type { Runner, RunnerResult } from './types.js';

export class ClaudeCliRunner implements Runner {
  isAvailable(): boolean {
    try {
      const result = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  async run(prompt: string, workspaceDir: string): Promise<RunnerResult> {
    const result = spawnSync(
      'claude',
      ['-p', prompt, '--allowedTools', 'Read,Write'],
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all 6 ClaudeCliRunner tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runner/claude-cli.ts src/lib/runner/__tests__/claude-cli.test.ts
git commit -m "feat: implement ClaudeCliRunner using claude -p subprocess"
```

---

### Task 3: Runner resolver

**Files:**
- Create: `src/lib/runner/index.ts`

- [ ] **Step 1: Write src/lib/runner/index.ts**

```ts
import type { Runner } from './types.js';
import { ClaudeCliRunner } from './claude-cli.js';

export type { Runner, RunnerResult } from './types.js';

export function resolveRunner(): Runner | null {
  const claude = new ClaudeCliRunner();
  if (claude.isAvailable()) return claude;
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/runner/index.ts
git commit -m "feat: add resolveRunner() — returns ClaudeCliRunner or null"
```

---

### Task 4: Workspace manager

**Files:**
- Create: `src/lib/workspace.ts`
- Create: `src/lib/__tests__/workspace.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspace, copyBack, cleanupWorkspace } from '../workspace.js';

describe('workspace', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `ws-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'proposal.md'), '# Proposal');
    writeFileSync(join(projectDir, 'design.md'), '# Design');
    mkdirSync(join(projectDir, 'openspec', 'specs'), { recursive: true });
    writeFileSync(join(projectDir, 'openspec', 'specs', 'auth.md'), '# Auth Spec');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('createWorkspace', () => {
    it('creates a temp directory', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, ['proposal.md']);
      expect(existsSync(ws.dir)).toBe(true);
      cleanupWorkspace(ws.dir);
    });

    it('copies flat files into the workspace root', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, ['proposal.md', 'design.md']);
      expect(readFileSync(join(ws.dir, 'proposal.md'), 'utf8')).toBe('# Proposal');
      expect(readFileSync(join(ws.dir, 'design.md'), 'utf8')).toBe('# Design');
      cleanupWorkspace(ws.dir);
    });

    it('preserves subdirectory structure for nested paths', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, ['openspec/specs/auth.md']);
      expect(existsSync(join(ws.dir, 'openspec', 'specs', 'auth.md'))).toBe(true);
      cleanupWorkspace(ws.dir);
    });

    it('skips files that do not exist in the project', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, ['nonexistent.md']);
      expect(existsSync(join(ws.dir, 'nonexistent.md'))).toBe(false);
      cleanupWorkspace(ws.dir);
    });

    it('dir name contains the role and round', () => {
      const ws = createWorkspace('proposer', 3, projectDir, []);
      expect(ws.dir).toContain('proposer');
      expect(ws.dir).toContain('3');
      cleanupWorkspace(ws.dir);
    });
  });

  describe('copyBack', () => {
    it('copies a file from workspace back to the project directory', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, ['proposal.md']);
      writeFileSync(join(ws.dir, 'review-findings-1.md'), '---\nissues-found: 2\n---');
      copyBack(ws.dir, projectDir, ['review-findings-1.md']);
      expect(readFileSync(join(projectDir, 'review-findings-1.md'), 'utf8')).toContain('issues-found: 2');
      cleanupWorkspace(ws.dir);
    });

    it('preserves subdirectory structure when copying back', () => {
      const ws = createWorkspace('proposer', 1, projectDir, ['openspec/specs/auth.md']);
      writeFileSync(join(ws.dir, 'openspec', 'specs', 'auth.md'), '# Updated Auth');
      copyBack(ws.dir, projectDir, ['openspec/specs/auth.md']);
      expect(readFileSync(join(projectDir, 'openspec', 'specs', 'auth.md'), 'utf8')).toBe('# Updated Auth');
      cleanupWorkspace(ws.dir);
    });
  });

  describe('cleanupWorkspace', () => {
    it('removes the workspace directory', () => {
      const ws = createWorkspace('reviewer', 1, projectDir, []);
      cleanupWorkspace(ws.dir);
      expect(existsSync(ws.dir)).toBe(false);
    });

    it('does not throw if workspace does not exist', () => {
      expect(() => cleanupWorkspace('/tmp/nonexistent-csi-opsx-xyz')).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../workspace.js'`

- [ ] **Step 3: Implement src/lib/workspace.ts**

```ts
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

export interface Workspace {
  dir: string;
}

export function createWorkspace(
  role: 'reviewer' | 'proposer',
  round: number,
  projectDir: string,
  relativeFiles: string[]
): Workspace {
  const dir = join(tmpdir(), `csi-opsx-${role}-${round}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  for (const relFile of relativeFiles) {
    const src = join(projectDir, relFile);
    if (!existsSync(src)) continue;
    const dest = join(dir, relFile);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  return { dir };
}

export function copyBack(workspaceDir: string, projectDir: string, relativeFiles: string[]): void {
  for (const relFile of relativeFiles) {
    const src = join(workspaceDir, relFile);
    if (!existsSync(src)) continue;
    const dest = join(projectDir, relFile);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

export function cleanupWorkspace(workspaceDir: string): void {
  if (existsSync(workspaceDir)) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all 9 workspace tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/__tests__/workspace.test.ts
git commit -m "feat: implement workspace manager for temp agent directories"
```

---

### Task 5: Permissions builder

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/lib/__tests__/permissions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/permissions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writePermissions } from '../permissions.js';

describe('permissions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `perms-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .claude/settings.json', () => {
    writePermissions(tmpDir, ['review-findings-1.md']);
    expect(existsSync(join(tmpDir, '.claude', 'settings.json'))).toBe(true);
  });

  it('includes Write() allow entries for each writable file', () => {
    writePermissions(tmpDir, ['proposal.md', 'design.md']);
    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Write(proposal.md)');
    expect(settings.permissions.allow).toContain('Write(design.md)');
  });

  it('includes Write(*) in deny', () => {
    writePermissions(tmpDir, ['review-findings-1.md']);
    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.deny).toContain('Write(*)');
  });

  it('allow list has exactly as many entries as writable files', () => {
    writePermissions(tmpDir, ['proposal.md', 'design.md', 'tasks.md']);
    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../permissions.js'`

- [ ] **Step 3: Implement src/lib/permissions.ts**

```ts
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export function writePermissions(workspaceDir: string, writableRelativePaths: string[]): void {
  const settingsDir = join(workspaceDir, '.claude');
  mkdirSync(settingsDir, { recursive: true });

  const settings = {
    permissions: {
      allow: writableRelativePaths.map((f) => `Write(${f})`),
      deny: ['Write(*)'],
    },
  };

  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all 4 permissions tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/__tests__/permissions.test.ts
git commit -m "feat: implement permissions builder for workspace settings.json"
```

---

### Task 6: Loop controller parsers

**Files:**
- Create: `src/lib/loop.ts`
- Create: `src/lib/__tests__/loop.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseIssuesFound,
  parseStatus,
  findLatestFindingsRound,
  getFindingsPath,
} from '../loop.js';

describe('loop', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `loop-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseIssuesFound', () => {
    it('returns the integer from issues-found field', () => {
      expect(parseIssuesFound('---\nissues-found: 3\nstatus: open\n---\n')).toBe(3);
    });

    it('returns 0 when issues-found is 0', () => {
      expect(parseIssuesFound('---\nissues-found: 0\nstatus: open\n---\n')).toBe(0);
    });

    it('throws when issues-found field is absent', () => {
      expect(() => parseIssuesFound('---\nstatus: open\n---')).toThrow('Missing issues-found');
    });
  });

  describe('parseStatus', () => {
    it('returns open when status is open', () => {
      expect(parseStatus('---\nissues-found: 2\nstatus: open\n---')).toBe('open');
    });

    it('returns addressed when status is addressed', () => {
      expect(parseStatus('---\nissues-found: 2\nstatus: addressed\n---')).toBe('addressed');
    });

    it('throws when status field is absent', () => {
      expect(() => parseStatus('---\nissues-found: 2\n---')).toThrow('Missing status');
    });
  });

  describe('findLatestFindingsRound', () => {
    it('returns 0 when no review-findings-*.md files exist', () => {
      expect(findLatestFindingsRound(tmpDir)).toBe(0);
    });

    it('returns highest round number present', () => {
      writeFileSync(join(tmpDir, 'review-findings-1.md'), '---\nissues-found: 2\nstatus: addressed\n---');
      writeFileSync(join(tmpDir, 'review-findings-2.md'), '---\nissues-found: 1\nstatus: open\n---');
      expect(findLatestFindingsRound(tmpDir)).toBe(2);
    });

    it('ignores files that do not match the pattern', () => {
      writeFileSync(join(tmpDir, 'proposal.md'), '# proposal');
      writeFileSync(join(tmpDir, 'review-findings-1.md'), '---\nissues-found: 0\nstatus: open\n---');
      expect(findLatestFindingsRound(tmpDir)).toBe(1);
    });
  });

  describe('getFindingsPath', () => {
    it('returns review-findings-N.md in the project dir', () => {
      expect(getFindingsPath('/tmp/project', 2)).toBe(join('/tmp/project', 'review-findings-2.md'));
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../loop.js'`

- [ ] **Step 3: Implement src/lib/loop.ts**

```ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type FindingsStatus = 'open' | 'addressed';

export function parseIssuesFound(content: string): number {
  const match = content.match(/^issues-found:\s*(\d+)/m);
  if (!match) throw new Error('Missing issues-found field in findings file');
  return parseInt(match[1], 10);
}

export function parseStatus(content: string): FindingsStatus {
  const match = content.match(/^status:\s*(open|addressed)/m);
  if (!match) throw new Error('Missing status field in findings file');
  return match[1] as FindingsStatus;
}

export function findLatestFindingsRound(projectDir: string): number {
  if (!existsSync(projectDir)) return 0;
  const rounds = readdirSync(projectDir)
    .map((f) => f.match(/^review-findings-(\d+)\.md$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1], 10));
  return rounds.length === 0 ? 0 : Math.max(...rounds);
}

export function getFindingsPath(projectDir: string, round: number): string {
  return join(projectDir, `review-findings-${round}.md`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all 10 loop tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loop.ts src/lib/__tests__/loop.test.ts
git commit -m "feat: implement loop controller parsers for findings files"
```

---

### Task 7: Agent configs

**Files:**
- Create: `src/commands/propose/agents.ts`

- [ ] **Step 1: Write src/commands/propose/agents.ts**

```ts
export interface AgentConfig {
  role: 'reviewer' | 'proposer';
  buildPrompt(projectDir: string, artifactRelPaths: string[], round: number): string;
}

export const ReviewerAgent: AgentConfig = {
  role: 'reviewer',
  buildPrompt(projectDir, artifactRelPaths, round) {
    return `You are a thorough technical reviewer.

Your working directory contains these artifact files to review:
${artifactRelPaths.map((a) => `- ${a}`).join('\n')}

Read each artifact file. Also read the following for project context (read-only, do not modify):
- ${projectDir}/CLAUDE.md (project conventions, if it exists)
- ${projectDir}/openspec/ (specs and schemas)
- ${projectDir}/docs/ (ADRs and other docs)
${round > 1 ? `- review-findings-${round - 1}.md (previous round findings — verify each was addressed)` : ''}

Review the artifacts for:
1. Inconsistencies between artifacts (e.g. proposal says X but design says Y)
2. Missing edge cases or error handling
3. Ambiguous or contradictory requirements
4. Violations of project conventions from CLAUDE.md

Write your findings to: review-findings-${round}.md

Use this exact frontmatter format:
---
issues-found: <integer — number of issues found, 0 if none>
round: ${round}
status: open
---

## Issue 1: [short title]
[description of the issue and which artifact it appears in]

If no issues are found, write issues-found: 0 and include no issue sections.`;
  },
};

export const ProposerAgent: AgentConfig = {
  role: 'proposer',
  buildPrompt(projectDir, artifactRelPaths, round) {
    return `You are an expert technical writer and software architect.

Your working directory contains these artifact files that need revision:
${artifactRelPaths.map((a) => `- ${a}`).join('\n')}

It also contains the reviewer's findings:
- review-findings-${round}.md

Read the project context from (read-only, do not modify):
- ${projectDir}/CLAUDE.md (project conventions, if it exists)
- ${projectDir}/openspec/ (specs and schemas)
- ${projectDir}/docs/ (ADRs and other docs)

Address every issue listed in review-findings-${round}.md. Update the relevant artifact files.

After addressing all issues, update review-findings-${round}.md:
- Change the \`status\` field from \`open\` to \`addressed\`
- Do not change issues-found or issue descriptions

Only write to artifact files and review-findings-${round}.md. Do not create or modify any other files.`;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/propose/agents.ts
git commit -m "feat: add ReviewerAgent and ProposerAgent prompt builders"
```

---

### Task 8: Harness orchestration

**Files:**
- Modify: `src/commands/propose/harness.ts` (replace stub)

- [ ] **Step 1: Replace the stub with the full implementation**

Overwrite `src/commands/propose/harness.ts`:

```ts
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { resolveRunner } from '../../lib/runner/index.js';
import { createWorkspace, copyBack, cleanupWorkspace } from '../../lib/workspace.js';
import { writePermissions } from '../../lib/permissions.js';
import {
  parseIssuesFound,
  parseStatus,
  findLatestFindingsRound,
  getFindingsPath,
} from '../../lib/loop.js';
import { ReviewerAgent, ProposerAgent } from './agents.js';

export interface HarnessOptions {
  workspace: string;
  artifacts: string[];
}

const MAX_ROUNDS = 5;

export async function runProposeHarness(opts: HarnessOptions): Promise<void> {
  const { workspace, artifacts } = opts;

  const runner = resolveRunner();
  if (!runner) {
    console.log([
      '⚠ csi-opsx: No runner available.',
      '  Automated review loop unavailable.',
      '  Install Claude Code to enable the automated review loop.',
    ].join('\n'));
    return;
  }

  // Resumability: determine which round to start on
  let round = findLatestFindingsRound(workspace);
  if (round > 0) {
    const existing = readFileSync(getFindingsPath(workspace, round), 'utf8');
    const status = parseStatus(existing);
    const issuesFound = parseIssuesFound(existing);

    if (status === 'open' && issuesFound === 0) {
      printSummary(workspace, round, artifacts);
      return;
    }
    if (status === 'addressed') {
      round = round + 1; // reviewer needs to run for next round
    }
    // else: status=open, issues>0 → proposer needs to run for same round
    // but since we always run reviewer first per round, we start proposer below
  } else {
    round = 1;
  }

  while (round <= MAX_ROUNDS) {
    // --- Reviewer run ---
    const prevFindingsFile = round > 1 ? `review-findings-${round - 1}.md` : null;
    const reviewerFiles = [
      ...artifacts,
      ...(prevFindingsFile ? [prevFindingsFile] : []),
    ];

    const reviewerWs = createWorkspace('reviewer', round, workspace, reviewerFiles);
    writePermissions(reviewerWs.dir, [`review-findings-${round}.md`]);

    console.log(`  Round ${round}: reviewer running...`);
    const reviewerResult = await runner.run(
      ReviewerAgent.buildPrompt(workspace, artifacts, round),
      reviewerWs.dir
    );
    copyBack(reviewerWs.dir, workspace, [`review-findings-${round}.md`]);
    cleanupWorkspace(reviewerWs.dir);

    if (reviewerResult.exitCode !== 0) {
      console.error(`Reviewer failed (round ${round}):\n${reviewerResult.stderr}`);
      process.exit(1);
    }

    const findingsPath = getFindingsPath(workspace, round);
    if (!existsSync(findingsPath)) {
      console.error(`Reviewer did not write review-findings-${round}.md`);
      process.exit(1);
    }

    const findingsContent = readFileSync(findingsPath, 'utf8');
    const issuesFound = parseIssuesFound(findingsContent);

    if (issuesFound === 0) {
      printSummary(workspace, round, artifacts);
      return;
    }

    // --- Proposer run ---
    const proposerFiles = [...artifacts, `review-findings-${round}.md`];
    const proposerWs = createWorkspace('proposer', round, workspace, proposerFiles);
    writePermissions(proposerWs.dir, proposerFiles);

    console.log(`  Round ${round}: proposer running (${issuesFound} issue${issuesFound === 1 ? '' : 's'} to address)...`);
    const proposerResult = await runner.run(
      ProposerAgent.buildPrompt(workspace, artifacts, round),
      proposerWs.dir
    );
    copyBack(proposerWs.dir, workspace, proposerFiles);
    cleanupWorkspace(proposerWs.dir);

    if (proposerResult.exitCode !== 0) {
      console.error(`Proposer failed (round ${round}):\n${proposerResult.stderr}`);
      process.exit(1);
    }

    round++;
  }

  console.log(`⚠ csi-opsx propose: reached max rounds (${MAX_ROUNDS}). Review artifacts manually.`);
}

function printSummary(workspace: string, rounds: number, artifacts: string[]): void {
  const findingFiles = Array.from({ length: rounds }, (_, i) => `review-findings-${i + 1}.md`);
  console.log([
    '✓ csi-opsx propose complete',
    `  Rounds: ${rounds}`,
    '  Final review: 0 issues found',
    `  Artifacts: ${artifacts.join(', ')}`,
    `  Review history: ${findingFiles.join(', ')}`,
  ].join('\n'));
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/propose/harness.ts
git commit -m "feat: implement propose harness with reviewer→proposer loop"
```

---

### Task 9: Integration tests and build verification

**Files:**
- Create: `src/commands/propose/__tests__/harness.test.ts`

- [ ] **Step 1: Write integration tests**

Create `src/commands/propose/__tests__/harness.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../../lib/runner/index.js', () => ({
  resolveRunner: vi.fn(),
}));

import { resolveRunner } from '../../../lib/runner/index.js';
import { runProposeHarness } from '../harness.js';

describe('runProposeHarness', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `harness-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'proposal.md'), '# Proposal');
    writeFileSync(join(projectDir, 'design.md'), '# Design');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it('exits immediately and prints notice when no runner is available', async () => {
    vi.mocked(resolveRunner).mockReturnValue(null);
    const consoleSpy = vi.spyOn(console, 'log');
    await runProposeHarness({ workspace: projectDir, artifacts: ['proposal.md'] });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No runner available'));
  });

  it('exits cleanly when reviewer finds 0 issues on first round', async () => {
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn().mockImplementation(async (_prompt: string, wsDir: string) => {
        writeFileSync(
          join(wsDir, 'review-findings-1.md'),
          '---\nissues-found: 0\nround: 1\nstatus: open\n---\n'
        );
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });

    const consoleSpy = vi.spyOn(console, 'log');
    await runProposeHarness({ workspace: projectDir, artifacts: ['proposal.md', 'design.md'] });
    expect(existsSync(join(projectDir, 'review-findings-1.md'))).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('csi-opsx propose complete'));
  });

  it('runs proposer when reviewer finds issues, then reviewer again until 0 issues', async () => {
    let callCount = 0;
    vi.mocked(resolveRunner).mockReturnValue({
      isAvailable: () => true,
      run: vi.fn().mockImplementation(async (_prompt: string, wsDir: string) => {
        callCount++;
        if (callCount === 1) {
          // Round 1 reviewer: finds 1 issue
          writeFileSync(
            join(wsDir, 'review-findings-1.md'),
            '---\nissues-found: 1\nround: 1\nstatus: open\n---\n## Issue 1: Title\ndesc'
          );
        } else if (callCount === 2) {
          // Round 1 proposer: marks addressed
          writeFileSync(
            join(wsDir, 'review-findings-1.md'),
            '---\nissues-found: 1\nround: 1\nstatus: addressed\n---\n## Issue 1: Title\ndesc'
          );
          writeFileSync(join(wsDir, 'proposal.md'), '# Updated Proposal');
        } else if (callCount === 3) {
          // Round 2 reviewer: 0 issues
          writeFileSync(
            join(wsDir, 'review-findings-2.md'),
            '---\nissues-found: 0\nround: 2\nstatus: open\n---\n'
          );
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    });

    await runProposeHarness({ workspace: projectDir, artifacts: ['proposal.md', 'design.md'] });
    expect(callCount).toBe(3);
    expect(existsSync(join(projectDir, 'review-findings-2.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all tests pass including the 3 harness integration tests.

- [ ] **Step 3: Full build**

Run: `npm run build`

Expected: `dist/` built with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/propose/__tests__/harness.test.ts
git commit -m "test: add integration tests for propose harness loop"
```
