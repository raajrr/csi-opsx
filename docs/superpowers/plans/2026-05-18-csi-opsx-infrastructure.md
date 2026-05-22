# csi-opsx Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the csi-opsx TypeScript package with CLI, tool detection, adapter registry, skill/command installation, and all four skill markdown files.

**Architecture:** Command module pattern — each command lives in `src/commands/{name}/` with a SKILL.md asset. A shared `src/lib/` layer handles tool detection, adapter dispatch, and file installation. The CLI entry point wires everything together via Commander. A stub harness is added for the propose command and replaced in Plan 2.

**Tech Stack:** TypeScript 5, tsup (build + asset copy), Vitest (unit tests), Commander (CLI), Node.js built-ins (fs, path, child_process)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | Package identity, bin mapping, scripts, deps |
| `.gitignore` | Create | Ignore dist/, node_modules/ |
| `tsconfig.json` | Create | TypeScript ESM config |
| `tsup.config.ts` | Create | Build config + SKILL.md asset copy |
| `vitest.config.ts` | Create | Test runner config |
| `src/lib/types.ts` | Create | `ToolId` and `CommandName` union types + `COMMAND_NAMES` |
| `src/lib/tools.ts` | Create | `TOOL_DIRS` mapping (ToolId → directory name) |
| `src/lib/tool-detection.ts` | Create | `hasOpenSpecSkills()` and `getConfiguredTools()` |
| `src/lib/__tests__/tool-detection.test.ts` | Create | Unit tests for tool detection |
| `src/lib/adapters/types.ts` | Create | `SkillAdapter` interface |
| `src/lib/adapters/claude.ts` | Create | Claude Code adapter (skill path, command path, command format) |
| `src/lib/adapters/index.ts` | Create | Adapter registry and `getAdapter()` lookup |
| `src/lib/__tests__/adapters.test.ts` | Create | Unit tests for ClaudeAdapter |
| `src/lib/install.ts` | Create | `installSkills()`, `installCommands()`, and `installThirdPartySkills()` |
| `src/lib/__tests__/install.test.ts` | Create | Unit tests for install logic |
| `src/skills/grill-with-docs/SKILL.md` | Create | Bundled grill-with-docs skill (static copy with attribution) |
| `src/skills/grill-with-docs/ADR-FORMAT.md` | Create | ADR format reference — co-located with SKILL.md |
| `src/skills/grill-with-docs/CONTEXT-FORMAT.md` | Create | CONTEXT.md format reference — co-located with SKILL.md |
| `tsup.config.ts` | Modify | Finalize `onSuccess` — copy `src/skills/` → `dist/skills/`; drop the unused `command.md` asset copy |
| `src/bin/cli.ts` | Create | CLI entry: init, update, run subcommands |
| `src/commands/propose/harness.ts` | Create | Stub — replaced in Plan 2 |
| `src/commands/explore/SKILL.md` | Create | Explore + grill combined behavior (markdown asset) |
| `src/commands/propose/SKILL.md` | Create | Propose + harness delegation behavior (markdown asset) |
| `src/commands/apply/SKILL.md` | Create | Apply passthrough behavior (markdown asset) |
| `src/commands/archive/SKILL.md` | Create | Archive passthrough behavior (markdown asset) |

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`

- [X] **Step 1: Create package.json**

```json
{
  "name": "csi-opsx",
  "version": "0.1.0",
  "description": "OpenSpec wrapper with automated review loops and explore grilling",
  "type": "module",
  "bin": {
    "csi-opsx": "./dist/bin/cli.js"
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "openspec": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [X] **Step 2: Create .gitignore**

```
dist/
node_modules/
*.tsbuildinfo
```

- [X] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [X] **Step 4: Create tsup.config.ts**

```ts
import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const COMMANDS = ['explore', 'propose', 'apply', 'archive'] as const;

export default defineConfig({
  entry: ['src/bin/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  onSuccess: async () => {
    for (const cmd of COMMANDS) {
      const destDir = join('dist', 'commands', cmd);
      mkdirSync(destDir, { recursive: true });
      for (const asset of ['SKILL.md', 'command.md']) {
        const src = join('src', 'commands', cmd, asset);
        if (existsSync(src)) copyFileSync(src, join(destDir, asset));
      }
    }
  },
});
```

> **Note — revised in Task 12b.** The `command.md` entry in the asset array was later found redundant: per-agent command files are generated by the adapters, not copied. Task 12b rewrites this `onSuccess` hook to copy only `SKILL.md` and to also copy `src/skills/` → `dist/skills/`. This block is left unchanged as Task 1's original specification.

- [X] **Step 5: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [X] **Step 6: Install dependencies**

Run: `npm install`

Expected: `node_modules/` created, lock file written, no errors.

- [X] **Step 7: Commit**

```bash
git init
git add package.json .gitignore tsconfig.json tsup.config.ts vitest.config.ts package-lock.json
git commit -m "chore: scaffold project with TypeScript, tsup, and vitest"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/lib/types.ts`

- [X] **Step 1: Write src/lib/types.ts**

```ts
export type ToolId = 'claude' | 'cursor' | 'gemini' | 'codex' | 'github-copilot';

export type CommandName = 'explore' | 'propose' | 'apply' | 'archive';

export const COMMAND_NAMES: CommandName[] = ['explore', 'propose', 'apply', 'archive'];
```

- [X] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared ToolId and CommandName types"
```

---

### Task 3: Tool directory mapping

**Files:**
- Create: `src/lib/tools.ts`

- [X] **Step 1: Write src/lib/tools.ts**

```ts
import type { ToolId } from './types.js';

export const TOOL_DIRS: Record<ToolId, string> = {
  'claude':         '.claude',
  'cursor':         '.cursor',
  'gemini':         '.gemini',
  'codex':          '.codex',
  'github-copilot': '.github',
};
```

- [X] **Step 2: Commit**

```bash
git add src/lib/tools.ts
git commit -m "feat: add TOOL_DIRS mapping for agent directory detection"
```

---

### Task 4: Tool detection

**Files:**
- Create: `src/lib/tool-detection.ts`
- Create: `src/lib/__tests__/tool-detection.test.ts`

- [X] **Step 1: Write the failing tests**

Create `src/lib/__tests__/tool-detection.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { hasOpenSpecSkills, getConfiguredTools } from '../tool-detection.js';

describe('tool-detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `csi-detect-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('hasOpenSpecSkills', () => {
    it('returns false when toolDir does not exist', () => {
      expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
    });

    it('returns false when skills dir exists but has no openspec-* entries', () => {
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true });
      expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
    });

    it('returns false when openspec-* dir exists but SKILL.md is missing', () => {
      mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-explore'), { recursive: true });
      expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
    });

    it('returns true when openspec-*/SKILL.md exists', () => {
      mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-explore'), { recursive: true });
      writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-explore', 'SKILL.md'), '# skill');
      expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(true);
    });
  });

  describe('getConfiguredTools', () => {
    it('returns empty array when no tools are configured', () => {
      expect(getConfiguredTools(tmpDir)).toEqual([]);
    });

    it('returns claude when .claude openspec skills exist', () => {
      mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-propose'), { recursive: true });
      writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
      expect(getConfiguredTools(tmpDir)).toEqual(['claude']);
    });

    it('returns multiple tools when both have openspec skills', () => {
      mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-propose'), { recursive: true });
      writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
      mkdirSync(join(tmpDir, '.cursor', 'skills', 'openspec-propose'), { recursive: true });
      writeFileSync(join(tmpDir, '.cursor', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
      const result = getConfiguredTools(tmpDir);
      expect(result).toContain('claude');
      expect(result).toContain('cursor');
    });
  });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../tool-detection.js'`

- [X] **Step 3: Implement src/lib/tool-detection.ts**

```ts
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ToolId } from './types.js';
import { TOOL_DIRS } from './tools.js';

export function hasOpenSpecSkills(projectRoot: string, toolDir: string): boolean {
  const skillsDir = join(projectRoot, toolDir, 'skills');
  if (!existsSync(skillsDir)) return false;
  return readdirSync(skillsDir).some(
    entry => entry.startsWith('openspec-') && existsSync(join(skillsDir, entry, 'SKILL.md'))
  );
}

export function getConfiguredTools(projectRoot: string): ToolId[] {
  return (Object.entries(TOOL_DIRS) as [ToolId, string][])
    .filter(([, dir]) => hasOpenSpecSkills(projectRoot, dir))
    .map(([toolId]) => toolId);
}
```

- [X] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all 7 tool-detection tests pass.

- [X] **Step 5: Commit**

```bash
git add src/lib/tool-detection.ts src/lib/__tests__/tool-detection.test.ts
git commit -m "feat: implement tool detection by scanning for openspec skill files"
```

---

### Task 5: Adapter interface

**Files:**
- Create: `src/lib/adapters/types.ts`

- [X] **Step 1: Write src/lib/adapters/types.ts**

```ts
import type { CommandName } from '../types.js';

export interface SkillAdapter {
  getSkillPath(toolDir: string, commandName: CommandName): string;
  getCommandPath(toolDir: string, commandName: CommandName): string;
  formatCommandFile(commandName: CommandName, skillContent: string): string;
}
```

- [X] **Step 2: Commit**

```bash
git add src/lib/adapters/types.ts
git commit -m "feat: add SkillAdapter interface for agent-specific installation"
```

---

### Task 6: Claude adapter

**Files:**
- Create: `src/lib/adapters/claude.ts`
- Create: `src/lib/__tests__/adapters.test.ts`

- [X] **Step 1: Write failing tests**

Create `src/lib/__tests__/adapters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../adapters/claude.js';

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  describe('getSkillPath', () => {
    it('returns csi-opsx-{name}/SKILL.md path under toolDir/skills', () => {
      expect(adapter.getSkillPath('.claude', 'explore')).toBe(
        '.claude/skills/csi-opsx-explore/SKILL.md'
      );
    });

    it('works for all command names', () => {
      expect(adapter.getSkillPath('.claude', 'propose')).toBe('.claude/skills/csi-opsx-propose/SKILL.md');
      expect(adapter.getSkillPath('.claude', 'apply')).toBe('.claude/skills/csi-opsx-apply/SKILL.md');
      expect(adapter.getSkillPath('.claude', 'archive')).toBe('.claude/skills/csi-opsx-archive/SKILL.md');
    });
  });

  describe('getCommandPath', () => {
    it('returns csi-opsx/{name}.md path under toolDir/commands', () => {
      expect(adapter.getCommandPath('.claude', 'explore')).toBe('.claude/commands/csi-opsx/explore.md');
    });

    it('works for propose', () => {
      expect(adapter.getCommandPath('.claude', 'propose')).toBe('.claude/commands/csi-opsx/propose.md');
    });
  });

  describe('formatCommandFile', () => {
    it('includes the slash command name in the output', () => {
      const result = adapter.formatCommandFile('explore', '# content');
      expect(result).toContain('/csi-opsx:explore');
    });

    it('references the skill file by name', () => {
      const result = adapter.formatCommandFile('propose', '# content');
      expect(result).toContain('csi-opsx-propose');
    });
  });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../adapters/claude.js'`

- [X] **Step 3: Implement src/lib/adapters/claude.ts**

```ts
import type { CommandName } from '../types.js';
import type { SkillAdapter } from './types.js';

export class ClaudeAdapter implements SkillAdapter {
  getSkillPath(toolDir: string, commandName: CommandName): string {
    return `${toolDir}/skills/csi-opsx-${commandName}/SKILL.md`;
  }

  getCommandPath(toolDir: string, commandName: CommandName): string {
    return `${toolDir}/commands/csi-opsx/${commandName}.md`;
  }

  formatCommandFile(commandName: CommandName, _skillContent: string): string {
    return [
      `# /csi-opsx:${commandName}`,
      '',
      `Load and follow the skill at \`csi-opsx-${commandName}/SKILL.md\` exactly.`,
    ].join('\n');
  }
}
```

- [X] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all adapter tests pass.

- [X] **Step 5: Commit**

```bash
git add src/lib/adapters/claude.ts src/lib/__tests__/adapters.test.ts
git commit -m "feat: add ClaudeAdapter for Claude Code skill and command installation"
```

---

### Task 7: Adapter registry

**Files:**
- Create: `src/lib/adapters/index.ts`

- [X] **Step 1: Write src/lib/adapters/index.ts**

```ts
import type { ToolId } from '../types.js';
import type { SkillAdapter } from './types.js';
import { ClaudeAdapter } from './claude.js';

export type { SkillAdapter };

const ADAPTERS: Partial<Record<ToolId, SkillAdapter>> = {
  claude: new ClaudeAdapter(),
};

export function getAdapter(toolId: ToolId): SkillAdapter | undefined {
  return ADAPTERS[toolId];
}
```

> Registry values and `getAdapter()`'s return are typed by the `SkillAdapter` interface, not the concrete `ClaudeAdapter`. Adding a new adapter only adds an import and a registry entry — no caller or signature changes.

- [X] **Step 2: Commit**

```bash
git add src/lib/adapters/index.ts
git commit -m "feat: add adapter registry with getAdapter() lookup"
```

---

### Task 8: Install logic

**Files:**
- Create: `src/lib/install.ts`
- Create: `src/lib/__tests__/install.test.ts`

g- [X] **Step 1: Write failing tests**

Create `src/lib/__tests__/install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSkills, installCommands, installThirdPartySkills } from '../install.js';

const EXPLORE_SKILL = '# Explore Skill';
const PROPOSE_SKILL = '# Propose Skill';
const GRILL_SKILL   = '# Grill';
const GRILL_ADR     = '# ADR';
const GRILL_CONTEXT = '# Context';

describe('install', () => {
  let projectDir: string;
  let sourceDir: string;
  let thirdPartyDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `csi-install-${Date.now()}`);
    sourceDir = join(tmpdir(), `csi-source-${Date.now()}`);
    thirdPartyDir = join(tmpdir(), `csi-skills-${Date.now()}`);
    mkdirSync(join(sourceDir, 'explore'), { recursive: true });
    mkdirSync(join(sourceDir, 'propose'), { recursive: true });
    writeFileSync(join(sourceDir, 'explore', 'SKILL.md'), EXPLORE_SKILL);
    writeFileSync(join(sourceDir, 'propose', 'SKILL.md'), PROPOSE_SKILL);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(thirdPartyDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(thirdPartyDir, { recursive: true, force: true });
  });

  describe('installSkills', () => {
    it('copies SKILL.md to toolDir/skills/csi-opsx-{name}/SKILL.md', () => {
      installSkills(projectDir, '.claude', ['explore'], sourceDir);
      const dest = join(projectDir, '.claude', 'skills', 'csi-opsx-explore', 'SKILL.md');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toBe(EXPLORE_SKILL);
    });

    it('installs all specified commands', () => {
      installSkills(projectDir, '.claude', ['explore', 'propose'], sourceDir);
      expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-explore', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-propose', 'SKILL.md'))).toBe(true);
    });

    it('skips commands with no SKILL.md in source', () => {
      installSkills(projectDir, '.claude', ['apply'], sourceDir);
      expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-apply', 'SKILL.md'))).toBe(false);
    });
  });

  describe('installCommands', () => {
    it('writes command file to toolDir/commands/csi-opsx/{name}.md for claude', () => {
      installCommands(projectDir, 'claude', '.claude', ['explore'], sourceDir);
      const dest = join(projectDir, '.claude', 'commands', 'csi-opsx', 'explore.md');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toContain('/csi-opsx:explore');
    });

    it('skips tool IDs with no registered adapter', () => {
      installCommands(projectDir, 'cursor', '.cursor', ['explore'], sourceDir);
      expect(existsSync(join(projectDir, '.cursor', 'commands', 'csi-opsx', 'explore.md'))).toBe(false);
    });
  });

  describe('installThirdPartySkills', () => {
    it('copies all files from each skill directory to toolDir/skills/{name}/', () => {
      mkdirSync(join(thirdPartyDir, 'grill-with-docs'), { recursive: true });
      writeFileSync(join(thirdPartyDir, 'grill-with-docs', 'SKILL.md'), GRILL_SKILL);
      writeFileSync(join(thirdPartyDir, 'grill-with-docs', 'ADR-FORMAT.md'), GRILL_ADR);
      writeFileSync(join(thirdPartyDir, 'grill-with-docs', 'CONTEXT-FORMAT.md'), GRILL_CONTEXT);
      installThirdPartySkills(projectDir, '.claude', thirdPartyDir);
      const dest = join(projectDir, '.claude', 'skills', 'grill-with-docs');
      expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
      expect(existsSync(join(dest, 'ADR-FORMAT.md'))).toBe(true);
      expect(existsSync(join(dest, 'CONTEXT-FORMAT.md'))).toBe(true);
      expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toBe(GRILL_SKILL);
    });

    it('is a no-op when skillsSourceDir does not exist', () => {
      expect(() =>
        installThirdPartySkills(projectDir, '.claude', join(thirdPartyDir, 'nonexistent'))
      ).not.toThrow();
    });

    it('installs multiple skill directories', () => {
      mkdirSync(join(thirdPartyDir, 'skill-a'), { recursive: true });
      mkdirSync(join(thirdPartyDir, 'skill-b'), { recursive: true });
      writeFileSync(join(thirdPartyDir, 'skill-a', 'SKILL.md'), '# A');
      writeFileSync(join(thirdPartyDir, 'skill-b', 'SKILL.md'), '# B');
      installThirdPartySkills(projectDir, '.claude', thirdPartyDir);
      expect(existsSync(join(projectDir, '.claude', 'skills', 'skill-a', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude', 'skills', 'skill-b', 'SKILL.md'))).toBe(true);
    });
  });
});
```

- [X] **Step 2: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module '../install.js'`

- [ ] **Step 3: Implement src/lib/install.ts**

```ts
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import type { CommandName, ToolId } from './types.js';
import { getAdapter } from './adapters/index.js';

export function installSkills(
  projectRoot: string,
  toolDir: string,
  commands: CommandName[],
  sourceDir: string
): void {
  for (const cmd of commands) {
    const src = join(sourceDir, cmd, 'SKILL.md');
    if (!existsSync(src)) continue;
    const dest = join(projectRoot, toolDir, 'skills', `csi-opsx-${cmd}`, 'SKILL.md');
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

export function installCommands(
  projectRoot: string,
  toolId: ToolId,
  toolDir: string,
  commands: CommandName[],
  sourceDir: string
): void {
  const adapter = getAdapter(toolId);
  if (!adapter) return;

  for (const cmd of commands) {
    const skillSrc = join(sourceDir, cmd, 'SKILL.md');
    const skillContent = existsSync(skillSrc) ? readFileSync(skillSrc, 'utf8') : '';
    const destPath = join(projectRoot, adapter.getCommandPath(toolDir, cmd));
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, adapter.formatCommandFile(cmd, skillContent));
  }
}

export function installThirdPartySkills(
  projectRoot: string,
  toolDir: string,
  skillsSourceDir: string
): void {
  if (!existsSync(skillsSourceDir)) return;
  for (const skillName of readdirSync(skillsSourceDir)) {
    const srcDir = join(skillsSourceDir, skillName);
    const destDir = join(projectRoot, toolDir, 'skills', skillName);
    mkdirSync(destDir, { recursive: true });
    for (const file of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS — all install tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/install.ts src/lib/__tests__/install.test.ts
git commit -m "feat: implement skill, command, and third-party skill installation logic"
```

---

### Task 9: CLI entry point and harness stub

**Files:**
- Create: `src/commands/propose/harness.ts`
- Create: `src/bin/cli.ts`

- [ ] **Step 1: Create the harness stub**

Create `src/commands/propose/harness.ts`:

```ts
export interface HarnessOptions {
  workspace: string;
  artifacts: string[];
}

export async function runProposeHarness(_opts: HarnessOptions): Promise<void> {
  console.log('⚠ Propose harness not yet implemented. Use /opsx:propose directly.');
}
```

- [ ] **Step 2: Create src/bin/cli.ts**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfiguredTools } from '../lib/tool-detection.js';
import { COMMAND_NAMES } from '../lib/types.js';
import { TOOL_DIRS } from '../lib/tools.js';
import { installSkills, installCommands, installThirdPartySkills } from '../lib/install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, '..', 'commands');
const SKILLS_DIR = join(__dirname, '..', 'skills');

const program = new Command();

program
  .name('csi-opsx')
  .description('OpenSpec wrapper with automated review loops')
  .version('0.1.0');

program
  .command('init')
  .description('Run openspec init and install csi-opsx skills')
  .action(() => {
    const result = spawnSync('openspec', ['init'], { stdio: 'inherit', shell: true });
    if (result.status !== 0) process.exit(result.status ?? 1);
    installCsiOpsx();
  });

program
  .command('update')
  .description('Run openspec update and reinstall csi-opsx skills')
  .action(() => {
    const result = spawnSync('openspec', ['update'], { stdio: 'inherit', shell: true });
    if (result.status !== 0) process.exit(result.status ?? 1);
    installCsiOpsx();
  });

program
  .command('run')
  .description('Internal: run a harnessed command (called by skills via Bash)')
  .requiredOption('--command <name>', 'command to run (propose)')
  .requiredOption('--workspace <path>', 'project workspace path')
  .requiredOption('--artifacts <csv>', 'comma-separated artifact relative paths')
  .action(async (opts) => {
    if (opts.command === 'propose') {
      const { runProposeHarness } = await import('../commands/propose/harness.js');
      await runProposeHarness({
        workspace: opts.workspace,
        artifacts: (opts.artifacts as string).split(',').map((a) => a.trim()),
      });
    } else {
      console.error(`Unknown command: ${opts.command}`);
      process.exit(1);
    }
  });

program.parse();

function installCsiOpsx(): void {
  const tools = getConfiguredTools(process.cwd());
  if (tools.length === 0) {
    console.log('No OpenSpec-configured agents detected. Run openspec init first.');
    return;
  }
  for (const toolId of tools) {
    const toolDir = TOOL_DIRS[toolId];
    installSkills(process.cwd(), toolDir, COMMAND_NAMES, COMMANDS_DIR);
    installCommands(process.cwd(), toolId, toolDir, COMMAND_NAMES, COMMANDS_DIR);
    installThirdPartySkills(process.cwd(), toolDir, SKILLS_DIR);
    console.log(`✓ Installed csi-opsx skills for ${toolId} (${toolDir})`);
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/bin/cli.ts src/commands/propose/harness.ts
git commit -m "feat: add CLI entry point with init/update/run subcommands and harness stub"
```

---

### Task 10: Explore skill content

**Files:**
- Create: `src/commands/explore/SKILL.md`

- [ ] **Step 1: Write src/commands/explore/SKILL.md**

```markdown
# csi-opsx Explore

Combines `/opsx:explore` and `grill-with-docs` behaviors in a single session. Both are active simultaneously from the start.

## Explore Behavior

Follow `/opsx:explore` behavior: conduct an investigative conversation. Do not make implementation decisions. Do not commit any artifacts during this session.

## Grill Behavior (active simultaneously)

Throughout the session:

- Challenge terminology against the existing glossary in `CONTEXT.md`. When divergence is detected, propose a canonical term and ask the user to confirm it.
- Stress-test the plan with concrete scenarios: "What happens when X and Y occur simultaneously?" "What does this look like at 10× current scale?"
- Cross-reference stated behavior against actual code — if a claim about how the system behaves does not match what the code does, surface that contradiction explicitly.
- Update `CONTEXT.md` inline as decisions crystallise.
- Create ADRs under `docs/adr/` only for decisions that are: hard to reverse, surprising without context, and involve genuine trade-offs.

## Outputs

- `CONTEXT.md` updated inline as the session progresses
- ADRs created only where all three ADR criteria are met
- No other artifacts produced or committed during explore

## Session End

When the user signals the session is wrapping up, surface:

> "Ready to proceed? Run `/csi-opsx:propose` to formalise these decisions into OpenSpec artifacts."
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/explore/SKILL.md
git commit -m "feat: add explore skill combining opsx:explore and grill-with-docs behaviors"
```

---

### Task 11: Apply and archive skill content

**Files:**
- Create: `src/commands/apply/SKILL.md`
- Create: `src/commands/archive/SKILL.md`

- [ ] **Step 1: Write src/commands/apply/SKILL.md**

```markdown
# csi-opsx Apply

Follow `/opsx:apply` behavior exactly. No additional behavior in this iteration.
```

- [ ] **Step 2: Write src/commands/archive/SKILL.md**

```markdown
# csi-opsx Archive

Follow `/opsx:archive` behavior exactly. No additional behavior in this iteration.
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/apply/ src/commands/archive/
git commit -m "feat: add apply and archive passthrough skills"
```

---

### Task 12: Propose skill content

**Files:**
- Create: `src/commands/propose/SKILL.md`

- [ ] **Step 1: Write src/commands/propose/SKILL.md**

````markdown
# csi-opsx Propose

## Step 1: Snapshot file modification times

Before running the propose step, record the modification time of every file in the project:

```bash
find . -not -path './.git/*' -type f -printf '%T@ %p\n' 2>/dev/null | sort
```

Store this output for comparison in Step 3.

## Step 2: Run /opsx:propose behavior

Follow `/opsx:propose` behavior exactly to generate initial artifacts (proposal.md, design.md, tasks.md, and any spec files).

## Step 3: Identify generated artifacts

After the propose step completes, snapshot modification times again:

```bash
find . -not -path './.git/*' -type f -printf '%T@ %p\n' 2>/dev/null | sort
```

Compare against Step 1. Files whose mtime changed or that are new are the generated artifacts. Collect these as a comma-separated list of paths relative to the project root (e.g. `proposal.md,design.md,tasks.md,openspec/specs/auth.md`).

## Step 4: Check for Claude Code CLI

Run:

```bash
claude --version
```

If this command succeeds (exit code 0), proceed to Step 5.

If it fails, print the following and stop — the developer reviews artifacts manually:

```
⚠ csi-opsx: Claude Code not detected.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Install Claude Code to enable the automated review loop.
```

## Step 5: Delegate to harness

Run via Bash (replace `<artifacts>` with the comma-separated list from Step 3):

```bash
csi-opsx run --command=propose --workspace . --artifacts <artifacts>
```

Wait for the harness to complete. Surface the exit summary to the session.
````

- [ ] **Step 2: Commit**

```bash
git add src/commands/propose/SKILL.md
git commit -m "feat: add propose skill with mtime snapshot and harness delegation"
```

---

### Task 12b: Third-party skill content and tsup update

**Files:**
- Create: `src/skills/grill-with-docs/SKILL.md`
- Create: `src/skills/grill-with-docs/ADR-FORMAT.md`
- Create: `src/skills/grill-with-docs/CONTEXT-FORMAT.md`
- Modify: `tsup.config.ts` — finalize `onSuccess`: copy `src/skills/` → `dist/skills/`, drop the unused `command.md` copy

- [ ] **Step 1: Create src/skills/grill-with-docs/ with attribution**

Create `src/skills/grill-with-docs/SKILL.md` with the following attribution comment at the top, then paste the full skill content below it:

```markdown
<!-- Source: https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs — Matt Pocock -->
```

Create `src/skills/grill-with-docs/ADR-FORMAT.md` and `src/skills/grill-with-docs/CONTEXT-FORMAT.md` with the same attribution comment at the top of each file.

- [ ] **Step 2: Finalize tsup.config.ts**

Rewrite `tsup.config.ts` so the `onSuccess` hook does two things: (a) copy only `SKILL.md` from each `src/commands/{name}/` — the `command.md` asset is dropped, since per-agent command files are generated by the adapters, not copied; (b) copy each `src/skills/{name}/` directory wholesale to `dist/skills/`. Add `readdirSync` to the `node:fs` import. Replace the file in full with:

```ts
import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS = ['explore', 'propose', 'apply', 'archive'] as const;

export default defineConfig({
  entry: ['src/bin/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  onSuccess: async () => {
    // copy command skills: src/commands/<name>/SKILL.md → dist/commands/<name>/SKILL.md
    for (const cmd of COMMANDS) {
      const destDir = join('dist', 'commands', cmd);
      mkdirSync(destDir, { recursive: true });
      const src = join('src', 'commands', cmd, 'SKILL.md');
      if (existsSync(src)) copyFileSync(src, join(destDir, 'SKILL.md'));
    }
    // copy third-party skills: src/skills/<name>/ → dist/skills/<name>/
    const skillsSrc = join('src', 'skills');
    if (existsSync(skillsSrc)) {
      for (const skillName of readdirSync(skillsSrc)) {
        const srcDir = join(skillsSrc, skillName);
        const destDir = join('dist', 'skills', skillName);
        mkdirSync(destDir, { recursive: true });
        for (const file of readdirSync(srcDir)) {
          copyFileSync(join(srcDir, file), join(destDir, file));
        }
      }
    }
  },
});
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`

Expected:
- `dist/skills/grill-with-docs/SKILL.md` exists
- `dist/skills/grill-with-docs/ADR-FORMAT.md` exists
- `dist/skills/grill-with-docs/CONTEXT-FORMAT.md` exists

- [ ] **Step 4: Commit**

```bash
git add src/skills/ tsup.config.ts
git commit -m "feat: add grill-with-docs third-party skill and generic skills copy in tsup"
```

---

### Task 13: Build and typecheck verification

**Files:** No new files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS — tool-detection (7), adapters (6), install (8) tests all pass.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected:
- `dist/bin/cli.js` exists
- `dist/commands/explore/SKILL.md` exists
- `dist/commands/propose/SKILL.md` exists
- `dist/commands/apply/SKILL.md` exists
- `dist/commands/archive/SKILL.md` exists
- `dist/skills/grill-with-docs/SKILL.md` exists
- `dist/skills/grill-with-docs/ADR-FORMAT.md` exists
- `dist/skills/grill-with-docs/CONTEXT-FORMAT.md` exists

- [ ] **Step 4: Smoke test the CLI**

Run: `node dist/bin/cli.js --help`

Expected output includes:
```
Commands:
  init
  update
  run [options]
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify build output — all assets copied, CLI smoke test passes"
```
