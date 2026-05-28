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
        it('calls claude -p with the prompt and --allowedTools Read,Write', async () => {
            vi.mocked(spawnSync).mockReturnValue({
                status: 0, stdout: '', stderr: '',
            } as ReturnType<typeof spawnSync>);
            const TEST_PROMPT = 'test prompt';
            const TMP_WORKSPACE = '/tmp/workspace';
            const runner = new ClaudeCliRunner();
            await runner.run({ prompt: TEST_PROMPT, workspaceDir: TMP_WORKSPACE });

            expect(spawnSync).toHaveBeenCalledWith(
                'claude',
                ['-p', TEST_PROMPT, '--allowedTools', 'Read,Write'],
                expect.objectContaining({ cwd: TMP_WORKSPACE })
            );
        });

        it('returns exitCode 0 on success', async () => {
            const EXIT_CODE = 0;
            const OUTPUT = 'output';
            vi.mocked(spawnSync).mockReturnValue({
                status: EXIT_CODE, stdout: OUTPUT, stderr: '',
            } as ReturnType<typeof spawnSync>);
            const result = await new ClaudeCliRunner().run({ prompt: 'prompt', workspaceDir: 'tmp/ws' });
            expect(result.exitCode).toBe(EXIT_CODE);
            expect(result.stdout).toBe(OUTPUT);
        });

        it('returns exitCode 1 when status is null', async () => {
            vi.mocked(spawnSync).mockReturnValue({
                status: null, stdout: '', stderr: 'killed',
            } as ReturnType<typeof spawnSync>);
            const result = await new ClaudeCliRunner().run({ prompt: 'prompt', workspaceDir: 'tmp/ws' });
            expect(result.exitCode).toBe(1);
        });

        it('writes .claude/settings.json when writablePaths is provided', async () => {
            vi.mocked(spawnSync).mockReturnValue({
                status: 0, stdout: '', stderr: '',
            } as ReturnType<typeof spawnSync>);

            const tmpWs = join(tmpdir(), `cli-run-test-${Date.now()}`);
            mkdirSync(tmpWs, { recursive: true });
            try {
                await new ClaudeCliRunner().run({
                    prompt: 'prompt',
                    workspaceDir: tmpWs,
                    writablePaths: ['proposal.md'],
                });
                expect(existsSync(join(tmpWs, '.claude', 'settings.json'))).toBe(true);
            } finally {
                rmSync(tmpWs, { recursive: true, force: true });
            }
        });

        it('does not write settings.json when writablePaths is omitted', async () => {
            vi.mocked(spawnSync).mockReturnValue({
                status: 0, stdout: '', stderr: '',
            } as ReturnType<typeof spawnSync>);
            const tmpWs = join(tmpdir(), `cli-run-test-${Date.now()}`);
            mkdirSync(tmpWs, { recursive: true });
            try {
                await new ClaudeCliRunner().run({ prompt: 'prompt', workspaceDir: tmpWs });
                expect(existsSync(join(tmpWs, '.claude', 'settings.json'))).toBe(false);
            } finally {
                rmSync(tmpWs, { recursive: true, force: true });
            }
        });
    });
});