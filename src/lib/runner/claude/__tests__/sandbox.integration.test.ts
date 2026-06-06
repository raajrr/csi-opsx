import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCliRunner } from '../cli.js';
import {rmdirSync} from "node:fs";

const runner = new ClaudeCliRunner();
const claudeAvailable = runner.isAvailable();

// Real claude -p calls — slow and cost money; auto-skipped when claude is absent.
describe.skipIf(!claudeAvailable)('ClaudeCliRunner sandbox (real claude -p', () => {
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