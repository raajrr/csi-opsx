import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// vi.mock to mock the child_process module needs to come before the import of the child_process module
// because otherwise the import imports the real module and the mock doesn't apply.
vi.mock('child_process', () => ({
    spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
import { ClaudeCliRunner } from '../cli.js';

describe('ClaudeCliRunner', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('isAvailable', () => {
        it('returns true when claude --version exits 0', () => {
           vi.mocked(spawnSync).mockReturnValue( { status: 0 } as ReturnType<typeof spawnSync>);
           expect(new ClaudeCliRunner().isAvailable()).toBe(true);
        });

        it('returns false when claude --version fails', () => {
            vi.mocked(spawnSync).mockReturnValue( { status: 1 } as ReturnType<typeof spawnSync>);
            expect(new ClaudeCliRunner().isAvailable()).toBe(false);
        });

        it('returns false when spawnSync throws (claude not on PATH)', () => {
            vi.mocked(spawnSync).mockImplementation(() => { throw new Error('ENOENT'); });
            expect(new ClaudeCliRunner().isAvailable()).toBe(false);
        });
    });

    describe('run', () => {
        it('spawn claude -p with acceptEdits and project setting-sources (never --allowedTools)', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
            const PROMPT = 'review please';
            const WS = join(tmpdir(), `cli-args-${Date.now()}`);
            mkdirSync(WS, { recursive: true });
            try {
                await new ClaudeCliRunner().run({ prompt: PROMPT, workspaceDir: WS });
                const [cmd, args, opts] = vi.mocked(spawnSync).mock.calls[0];
                expect(cmd).toBe('claude');
                expect(args).toEqual(['-p', PROMPT, '--permission-mode', 'acceptEdits', '--setting-sources', 'project']);
                expect(args).not.toContain('--allowedTools');
                expect(opts).toMatchObject({ cwd: WS });
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

        it('does not write .claude/settings.json when projectRoot is omitted', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>);
            const WS = join(tmpdir(), `cli-perm-${Date.now()}`);
            mkdirSync(WS, { recursive: true });
            try {
                await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: WS });
                expect(existsSync(join(WS, '.claude', 'settings.json'))).toBe(false);
            } finally {
                rmSync(WS, { recursive: true, force: true });
            }
        });

        it('returns exit code 0 and stdout on success', async () => {
           vi.mocked(spawnSync).mockReturnValue( { status: 0, stdout: 'out', stderr: '' } as ReturnType<typeof spawnSync>);
           const r = await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: '/tmp/ws' });
           expect(r.exitCode).toBe(0);
           expect(r.stdout).toBe('out');
        });

        it('returns exit code 1 when status is null (killed)', async () => {
           vi.mocked(spawnSync).mockReturnValue( { status: null, stdout: '', stderr: 'killed'} as ReturnType<typeof spawnSync>);
           const r = await new ClaudeCliRunner().run({ prompt: 'p', workspaceDir: '/tmp/ws' });
           expect(r.exitCode).toBe(1);
           expect(r.stderr).toBe('killed');
        });
    });
});