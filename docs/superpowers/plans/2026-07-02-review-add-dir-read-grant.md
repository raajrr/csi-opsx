# Review Workspace Read Grant via `--add-dir` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **NOTE:** this repo's owner executes collaboratively (they type the code; Claude guides and verifies). Do not auto-apply code via subagents unless the owner says otherwise.

**Goal:** Restore the review harness's project read grant — broken because Claude Code (observed on CLI 2.1.198) ignores `permissions.additionalDirectories` in never-trusted directories, and the per-round temp workspaces can never be trusted — by passing `--add-dir <projectRoot>` on the `claude -p` command line instead, while keeping the write sandbox (settings `deny` rules, which untrusted dirs still honor) intact.

**Architecture:** `ClaudeCliRunner` is the only file whose runtime behavior changes: it appends a quoted `--add-dir <projectRoot>` to the spawn args. `writePermissions` drops the now-ignored `additionalDirectories` entry (which also silences a per-spawn stderr trust warning) and keeps only the `Write`/`Edit` deny rules. The integration suite gains a read-grant probe — the missing half of the sandbox contract that let this regression ship green. Harness, workspace lifecycle, and the `Runner` contract are untouched.

**Tech Stack:** TypeScript (ESM), tsup (build), vitest (tests), `child_process.spawnSync` with `shell: true`. Integration tests spawn the real `claude` CLI.

**Design doc:** `docs/superpowers/specs/2026-07-02-review-add-dir-read-grant-design.md`

## Global Constraints

- **The sandbox contract is unchanged**: workspace cwd writable under `acceptEdits`; project readable but not writable; Bash never allowed (`--allowedTools` never passed). Only the read-grant *channel* moves (settings entry → CLI flag).
- **`--add-dir`'s value MUST be wrapped in literal double quotes by the runner** — `spawnSync` with `shell: true` joins the args array without quoting, and real project paths contain spaces (`D:\Development\Personal Projects\csi-opsx`).
- **`deny` rules stay in the workspace `.claude/settings.json`** — proven still honored in untrusted dirs AND load-bearing (design doc, Probes C/E: without them, `--add-dir` + `acceptEdits` auto-accepts project writes). Do not move or drop them.
- **`RunnerOptions` is unchanged** (`{ prompt, workspaceDir, projectRoot? }` — `src/lib/runner/types.ts:7-11`). No harness changes.
- **Integration tests are real `claude -p` runs**: they cost money, take ~1–3 minutes per scenario, and auto-skip when `claude` is not on PATH. Run them deliberately (never in watch mode). The RED step in Task 1 requires a trust-gating CLI (2.1.198 observed on this machine); on an older CLI it would pass.
- **File state is the only ground truth for sandbox behavior** — a deny-rule block leaves the JSON `permission_denials` array EMPTY. Assert files exist / don't exist, never JSON shape alone.
- **TDD throughout** — every code change is preceded by a test that fails first for the right reason.

## Branch

All work happens on the feature branch `fix-review-issue-due-to-updated-claude-code-rules` (already checked out from `master`). Commit this plan and its design doc on it before starting Task 1.

## File Structure

| Path | Responsibility after this change |
|---|---|
| `src/lib/runner/claude/cli.ts` | Spawns `claude -p --permission-mode acceptEdits --setting-sources project` plus, when `projectRoot` is set, `--add-dir "<projectRoot>"` (quoted); still calls `writePermissions` first. |
| `src/lib/runner/claude/permissions.ts` | Emits a deny-only `settings.json` (`Write`/`Edit` deny globs on the project subtree). No `additionalDirectories`. |
| `src/lib/runner/claude/__tests__/cli.test.ts` | New arg assertions: `--add-dir` present + quoted when `projectRoot` set; existing exact-args test keeps proving it's absent otherwise. |
| `src/lib/runner/claude/__tests__/permissions.test.ts` | Asserts `additionalDirectories` is NOT emitted; deny assertions unchanged. |
| `src/lib/runner/claude/__tests__/sandbox.integration.test.ts` | Pins BOTH halves of the sandbox contract: read grant (new token round-trip probe) and write blocking (existing). |
| `.claude/CLAUDE.md` | Runner/harness docs describe the `--add-dir` read grant; stale `writablePaths` references fixed. |
| `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` | §Workspace Isolation & Write Sandbox updated in place (dated) to the flag-based read grant. |

---

### Task 1: Restore the project read grant (`--add-dir`)

**Files:**
- Modify: `src/lib/runner/claude/__tests__/sandbox.integration.test.ts:1-45`
- Modify: `src/lib/runner/claude/__tests__/cli.test.ts` (new test after line 77)
- Modify: `src/lib/runner/claude/cli.ts:15-41`

**Interfaces:**
- Consumes: `Runner.run(opts: RunnerOptions): Promise<RunnerResult>` with `RunnerOptions = { prompt: string; workspaceDir: string; projectRoot?: string }` (unchanged); `writePermissions(workspaceDir, projectRoot)` (unchanged signature).
- Produces: no signature change. Behavioral change only: the spawned command line gains `--add-dir "<projectRoot>"` when `projectRoot` is set.

- [x] **Step 1: Add the read-grant probe to the integration test (this is the regression reproduction)**

In `src/lib/runner/claude/__tests__/sandbox.integration.test.ts`, add `readFileSync` to the fs import (line 2):

```typescript
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
```

Then replace the top of `runScenario` (lines 12–24, up to and including the in-workspace write assertions) so the scenario probes the read grant FIRST, with a token round-trip asserted on file state:

```typescript
    async function runScenario(projectRootDir: string): Promise<void> {
        const projectRoot  = mkdtempSync(join(tmpdir(), projectRootDir));
        const workspaceDir = mkdtempSync(join(tmpdir(), 'csi-ws'));
        const OUT_TXT = 'out.txt';
        const READ_OUT = 'read-out.txt';
        const TOKEN = 'MAGIC-TOKEN-7391';
        writeFileSync(join(projectRoot, 'CONTEXT.md'), `# context\n${TOKEN}\n`);
        try {
            /* READ GRANT — the missing half of the sandbox contract. The reviewer's whole job
               depends on reading project files from inside the workspace; Claude Code's trust
               gating silently revoked this once (settings additionalDirectories ignored in
               untrusted dirs), and only a file-state round-trip catches it. */
            const readGrant = await runner.run({
                prompt: `Read the file at ${join(projectRoot, 'CONTEXT.md')} and then use the Write tool to create a file named ${READ_OUT} in the current working directory whose contents are exactly what you read. If you cannot read the file, do not create ${READ_OUT}.`,
                workspaceDir,
                projectRoot,
            });
            expect(readGrant.exitCode).toBe(0);
            const readOutPath = join(workspaceDir, READ_OUT);
            expect(existsSync(readOutPath)).toBe(true); // project read grant works end-to-end
            expect(readFileSync(readOutPath, 'utf8')).toContain(TOKEN);

            const runningInsideWs = await runner.run({
                prompt: `Use the Write tool to create a file named ${OUT_TXT} in the current working directory with the exact contents following the colon : OK`,
                workspaceDir,
                projectRoot,
            });
            expect(runningInsideWs.exitCode).toBe(0);
            expect(existsSync(join(workspaceDir, OUT_TXT))).toBe(true); // in-workspace write allowed
```

The rest of `runScenario` (the `leak.txt` probe and the `finally` cleanup) is unchanged.

- [x] **Step 2: Run the integration file, verify it FAILS for the right reason**

```bash
npx vitest run src/lib/runner/claude/__tests__/sandbox.integration.test.ts
```

Expected: **FAIL** (~3–6 min, real API spend). Both scenario tests (`allows in-workspace writes and blocks project writes` and `holds when the project path contains a space`) fail at `expect(existsSync(readOutPath)).toBe(true)` — `expected false to be true` — because the sub-agent's `Read` of the project file is denied. (The denial itself isn't visible in vitest output; log `readGrant.stderr` if you want to see the "Ignoring 1 permissions.additionalDirectories entry … this workspace has not been trusted" warning.) The Bash-bypass test still passes. This is the live regression.

- [x] **Step 3: Write the failing unit test for the spawn args**

In `src/lib/runner/claude/__tests__/cli.test.ts`, add this test inside `describe('run', …)`, immediately after the `'does not write .claude/settings.json when projectRoot is omitted'` test (after its closing `});` on line 77). The spaced path is deliberate — it encodes the quoting requirement:

```typescript
        it('passes --add-dir with the QUOTED project root when projectRoot is provided', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
            const WS = join(tmpdir(), `cli-adddir-${Date.now()}`);
            mkdirSync(WS, { recursive: true });
            try {
                await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: WS, projectRoot: 'C:\\Users\\me\\my proj' });
                const [, args] = vi.mocked(spawnSync).mock.calls[0];
                const flagIndex = (args as string[]).indexOf('--add-dir');
                expect(flagIndex).toBeGreaterThan(-1);
                // shell:true joins args WITHOUT quoting, so the runner must quote the path
                // itself (real project paths contain spaces, e.g. "Personal Projects").
                expect((args as string[])[flagIndex + 1]).toBe('"C:\\Users\\me\\my proj"');
            } finally {
                rmSync(WS, { recursive: true, force: true });
            }
        });
```

- [x] **Step 4: Run it, verify it FAILS**

```bash
npx vitest run src/lib/runner/claude/__tests__/cli.test.ts -t "passes --add-dir"
```

Expected: FAIL — `expected -1 to be greater than -1` (the current args array never contains `--add-dir`).

- [x] **Step 5: Implement the flag in `src/lib/runner/claude/cli.ts`**

Replace the `run` method (lines 15–41) with:

```typescript
    async run(opts: RunnerOptions): Promise<RunnerResult> {
        const { prompt, workspaceDir, projectRoot } = opts;

        /* The workspace cwd is writable under acceptEdits. The project read grant must be
           the --add-dir FLAG, not settings additionalDirectories — Claude Code ignores that
           permission-expanding entry in directories that were never trusted, and these
           disposable workspaces never are. The deny rules written by writePermissions
           still load (they only shrink permissions), keeping the project read-only.
           Bash is deliberately NOT allowed (write bypass).
        */
        const args = ['-p', '--permission-mode', 'acceptEdits', '--setting-sources', 'project'];
        if (projectRoot) {
            writePermissions(workspaceDir, projectRoot);
            // shell:true joins args without quoting; the path may contain spaces
            args.push('--add-dir', `"${projectRoot}"`);
        }
        const result = spawnSync(
            'claude',
            args,
            {
                cwd: workspaceDir,
                input: prompt,
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
```

- [x] **Step 6: Run the whole unit test file, verify all green**

```bash
npx vitest run src/lib/runner/claude/__tests__/cli.test.ts
```

Expected: PASS — the new `--add-dir` test passes; the existing exact-args test (`spawn claude -p with acceptEdits and project setting-sources`) still passes because it runs *without* `projectRoot`, proving the flag is absent on that path; the two settings.json tests are unaffected.

- [x] **Step 7: Re-run the integration file, verify the regression is fixed**

```bash
npx vitest run src/lib/runner/claude/__tests__/sandbox.integration.test.ts
```

Expected: **PASS** (~5–10 min, real API spend) — the read-grant probes now round-trip the token (grant restored via `--add-dir`; the still-present `additionalDirectories` settings entry is ignored with a stderr warning, which Task 2 removes), and the write-block probes still hold.

- [ ] **Step 8: Commit**

```bash
git add src/lib/runner/claude/cli.ts src/lib/runner/claude/__tests__/cli.test.ts src/lib/runner/claude/__tests__/sandbox.integration.test.ts
git commit -m "fix: grant project reads via --add-dir so never-trusted temp workspaces can read the project

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Drop the ignored `additionalDirectories` from workspace settings

**Files:**
- Modify: `src/lib/runner/claude/__tests__/permissions.test.ts:40-44`
- Modify: `src/lib/runner/claude/permissions.ts:20-37`

**Interfaces:**
- Consumes: `toPermissionGlob(absolutePath: string): string` (unchanged).
- Produces: `writePermissions(workspaceDir: string, projectRoot: string): void` (unchanged signature); the emitted `settings.json` now contains ONLY `permissions.deny`.

- [ ] **Step 1: Flip the presence test to an absence test**

In `src/lib/runner/claude/__tests__/permissions.test.ts`, replace the `'lists the project root under additionalDirectories (native path)'` test (lines 40–44) with:

```typescript
    it('does not emit additionalDirectories (ignored in untrusted dirs; the read grant is the --add-dir flag)', () => {
        writePermissions(workspaceDir, PROJECT_ROOT);
        const settings = JSON.parse(readFileSync(join(workspaceDir, CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
        expect(settings.permissions.additionalDirectories).toBeUndefined();
    });
```

- [ ] **Step 2: Run it, verify it FAILS**

```bash
npx vitest run src/lib/runner/claude/__tests__/permissions.test.ts -t "does not emit additionalDirectories"
```

Expected: FAIL — `expected [ 'C:\\Users\\me\\proj' ] to be undefined` (the current `writePermissions` still emits the entry).

- [ ] **Step 3: Implement in `src/lib/runner/claude/permissions.ts`**

Replace the `writePermissions` header comment and function (lines 20–38) with:

```typescript
/*
 Write the per-workspace sandbox config. The workspace (cwd) is writable under
 --permission-mode acceptEdits; the runner re-grants READ access to the project with the
 --add-dir CLI flag (NOT additionalDirectories here — Claude Code ignores that
 permission-expanding entry in directories that were never trusted, and disposable
 workspaces never are). This file carries only the deny rules that claw back WRITE/EDIT
 on the project subtree; deny rules still load untrusted because they only shrink
 permissions, and deny overrides both allow and the acceptEdits mode.
*/
export function writePermissions(workspaceDir:  string, projectRoot: string): void {
    const settingsDir = join(workspaceDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });

    const glob = toPermissionGlob(projectRoot);
    const settings = {
        permissions: {
            deny: [`Write(${glob}/**)`, `Edit(${glob}/**)`],
        },
    };
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run the unit suites, verify all green**

```bash
npx vitest run src/lib/runner/claude/__tests__/permissions.test.ts src/lib/runner/claude/__tests__/cli.test.ts
```

Expected: PASS — absence test passes; the deny-glob and no-`Write(*)`-catchall tests are untouched and still pass; `cli.test.ts` still green (it only checks that `settings.json` exists, not its contents).

- [ ] **Step 5: Re-run the integration file — the deny rules alone must still hold the write boundary**

```bash
npx vitest run src/lib/runner/claude/__tests__/sandbox.integration.test.ts
```

Expected: **PASS** (real API spend). This run proves in-repo that the deny rules alone hold the write boundary: with `additionalDirectories` gone, reads still work (`--add-dir`) and project writes are still blocked. The deny rules are load-bearing, not belt-and-suspenders — without them, `--add-dir` + `acceptEdits` auto-accepts project writes (design doc, Probes C/E). The stderr "Ignoring … additionalDirectories" warning no longer appears in the sub-agent output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/runner/claude/permissions.ts src/lib/runner/claude/__tests__/permissions.test.ts
git commit -m "fix: emit deny-only workspace settings; the ignored additionalDirectories entry only produced a trust warning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Documentation sync

**Files:**
- Modify: `.claude/CLAUDE.md` (module table line 39; loop diagram lines 55–69; sandbox paragraph line 71)
- Modify: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` (§Workspace Isolation & Write Sandbox: paragraph at line 312, jsonc example lines 314–325, spawn paragraph line 327, helper bullet line 336)

**Interfaces:** none — docs only. Note `.claude/CLAUDE.md` lines 39/59/65/71 are stale from *before* this change (they still describe the long-gone `writablePaths` mechanism); this task brings them to the current, post-fix truth in one pass.

- [ ] **Step 1: `.claude/CLAUDE.md` — module table row (line 39)**

```markdown
// before
| `runner/claude/cli.ts` | `ClaudeCliRunner` — spawns `claude -p` via `child_process.spawnSync`; calls `writePermissions` internally when `writablePaths` is provided |
// after
| `runner/claude/cli.ts` | `ClaudeCliRunner` — spawns `claude -p` via `child_process.spawnSync`; when `projectRoot` is provided, grants project reads with `--add-dir` and calls `writePermissions` for the write-deny rules |
```

- [ ] **Step 2: `.claude/CLAUDE.md` — review harness loop diagram (lines 55–69)**

```markdown
// before
resolve runner → start round 1
  loop:
    create reviewer workspace (temp dir, copy artifacts)
    runner.run({ prompt: <reviewer>, workspaceDir, writablePaths: [review-findings-N.md] })
      └─ ClaudeCliRunner writes .claude/settings.json then spawns claude -p
    copy back review-findings-N.md → project
    parse issues-found
    if issues-found == 0 → exit (print summary)
    create proposer workspace (temp dir, copy artifacts + findings)
    runner.run({ prompt: <proposer>, workspaceDir, writablePaths: [...artifacts, findings] })
      └─ ClaudeCliRunner writes .claude/settings.json then spawns claude -p
    copy back artifacts + findings → project
    round++

// after
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

- [ ] **Step 3: `.claude/CLAUDE.md` — sandbox paragraph (line 71)**

```markdown
// before
Agents read project context (`CLAUDE.md`, `openspec/`, `docs/`) from absolute paths in their prompt — no copying needed since `Read` is unrestricted. Write access is restricted via `RunnerOptions.writablePaths`, which `ClaudeCliRunner` translates into a workspace-scoped `.claude/settings.json` (allow-list per file, deny `Write(*)` catchall) before spawning. The harness does not import `permissions` directly — each runner encapsulates its own sandbox mechanism.

// after
Agents read project context (`CLAUDE.md`, `openspec/`, `docs/`) from absolute paths in their prompt — no copying needed because the runner re-grants the project with the `--add-dir` CLI flag. The grant must be the flag, not `additionalDirectories` in the workspace `.claude/settings.json`: Claude Code ignores that permission-expanding entry in directories that were never trusted, and the disposable per-round workspaces never are. The workspace `settings.json` (written by `writePermissions`) carries only `deny` rules for `Write`/`Edit` on the project subtree — permission-shrinking rules still load untrusted — so the project stays read-only while the workspace cwd is writable under `acceptEdits`. The harness does not import `permissions` directly — each runner encapsulates its own sandbox mechanism.
```

- [ ] **Step 4: spec `2026-05-18-csi-opsx-design.md` — read-grant paragraph + example + spawn line (lines 312–327)**

```markdown
// before (line 312 paragraph)
**Reading project context without copying it.** The agent still needs to read project files that live outside the workspace (`CLAUDE.md`, `openspec/specs/`, `docs/`). The runner re-grants read access to the project root through `additionalDirectories` in the workspace's `.claude/settings.json`. Because `additionalDirectories` grants *both* read and write, the runner also adds `deny` rules for the write tools on the project subtree. `deny` overrides both `allow` and the `acceptEdits` mode, so the project ends up **readable but not writable**, while the workspace stays writable.

// after
**Reading project context without copying it.** *(Updated 2026-07-02 — see `2026-07-02-review-add-dir-read-grant-design.md`; originally `additionalDirectories` in the workspace settings, which Claude Code now ignores in never-trusted directories.)* The agent still needs to read project files that live outside the workspace (`CLAUDE.md`, `openspec/specs/`, `docs/`). The runner re-grants read access to the project root with the **`--add-dir <projectRoot>` CLI flag** — a flag the operator passed explicitly, so it is honored regardless of directory trust. Because `--add-dir` grants *both* read and write, the runner also adds `deny` rules for the write tools on the project subtree in the workspace's `.claude/settings.json`; permission-shrinking rules still load in untrusted directories. `deny` overrides both `allow` and the `acceptEdits` mode, so the project ends up **readable but not writable**, while the workspace stays writable.
```

```jsonc
// before (example, lines 314–325)
// workspace/.claude/settings.json — written by writePermissions() before spawning
{
  "permissions": {
    "additionalDirectories": ["<projectRoot>"],   // read project context in place
    "deny": [
      "Write(//c/Users/me/project/**)",           // project is read-only…
      "Edit(//c/Users/me/project/**)"             // …deny beats allow + acceptEdits
    ]
  }
}

// after
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

```markdown
// before (spawn paragraph, line 327)
The runner spawns `claude -p <prompt> --permission-mode acceptEdits --setting-sources project` with `cwd` = the workspace. It deliberately does **not** allow the Bash tool (no `--allowedTools Bash`): Bash is the one path-agnostic way around a Write/Edit deny, and leaving it unlisted means it needs approval and is auto-denied under `-p`.

// after
The runner spawns `claude -p <prompt> --permission-mode acceptEdits --setting-sources project --add-dir "<projectRoot>"` with `cwd` = the workspace (the runner wraps the path in quotes itself — `spawnSync` with `shell: true` joins arguments without quoting, and project paths can contain spaces). It deliberately does **not** allow the Bash tool (no `--allowedTools Bash`): Bash is the one path-agnostic way around a Write/Edit deny, and leaving it unlisted means it needs approval and is auto-denied under `-p`.
```

- [ ] **Step 5: spec — helper bullet (line 336)**

```markdown
// before
- The helper is **pattern-only.** `additionalDirectories` takes a directory *path*, not a glob — it accepts the native path (`C:\…`) or a POSIX path (`/c/…`, `C:/…`) but **rejects** the `//c/…` glob form. Simplest approach: pass the project's native path to `additionalDirectories` untouched, and use the helper solely to build the `deny` patterns.
// after
- The helper is **pattern-only.** `--add-dir` takes a directory *path*, not a glob — pass the project's native path (`C:\…`) untouched, and use the helper solely to build the `deny` patterns.
```

- [ ] **Step 6: Verify by reading the changed regions**

Read the edited regions of `.claude/CLAUDE.md` and the spec and confirm: no remaining `writablePaths` references (`grep -n writablePaths .claude/CLAUDE.md` → no matches), no claim that the read grant lives in `settings.json`, and the loop diagram matches `harness.ts` (reviewer workspace is empty; runner receives `projectRoot`).

- [ ] **Step 7: Commit**

```bash
git add .claude/CLAUDE.md docs/superpowers/specs/2026-05-18-csi-opsx-design.md
git commit -m "docs: read grant is the --add-dir flag (trust-gated settings); fix stale writablePaths references

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final Verification

After all three tasks, run the full gate once and confirm green:

```bash
npm run build && npm run typecheck && npm test
```

Expected: build succeeds, typecheck clean, all tests pass. Note `npm test` runs the integration file too when `claude` is on PATH (real spend, several minutes) — that's the point: it is the gate that was missing a read-grant assertion.

Real-world smoke (the failure that started this): in an OpenSpec project with an existing change, run `/csi-opsx:review <name>` and confirm round 1's reviewer writes `review-findings-1.md` (the previous failure mode was "Reviewer did not write review-findings-1.md" after the sub-agent exited 0 having read nothing).

## Self-Review (completed by plan author)

- **Design-doc coverage:** Decision 1 `--add-dir` + quoting (Task 1 Steps 3–6) ✓; Decision 2 deny rules stay (Global Constraints + Task 2 Step 5 proves it live) ✓; Decision 3 drop `additionalDirectories` (Task 2) ✓; Decision 4 read-grant integration probe, file-state assertions (Task 1 Steps 1–2, 7) ✓; edge case spaced path (unit test path `my proj` + existing spaced integration scenario) ✓; `projectRoot` omitted unchanged (existing exact-args + no-settings tests) ✓; docs incl. stale `writablePaths` drift (Task 3) ✓; rejected alternatives need no tasks ✓.
- **Placeholder scan:** every code/test/doc step shows full literal content; no TBD/TODO/"handle edge cases".
- **Type consistency:** `RunnerOptions`/`RunnerResult`/`writePermissions`/`toPermissionGlob` signatures unchanged and used consistently; new test names referenced identically in run commands; `READ_OUT`/`TOKEN` locals scoped to `runScenario`.
