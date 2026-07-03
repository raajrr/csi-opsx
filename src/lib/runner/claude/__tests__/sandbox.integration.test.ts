import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
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
        const READ_OUTPUT = 'read-output.txt';
        const MAGIC_TOKEN = 'MAGIC_TOKEN-7391';
        writeFileSync(join(projectRoot, 'CONTEXT.md'), `# context\n${MAGIC_TOKEN}`);
        try {
            /*Testing the read grant (permissions). The reviewer's job depends on it being able
            * to read the contents of the project directory from inside the workspace directory. Here
            * we are testing that. A Claude Code update caused the app to regress once. The update caused
            * settings additionalDirectories to be ignored in untrusted directories (like our temp workspace
            * directory that gets created upto twice each round). The agent still exited 0 when broken.
            * This test exists to catch those in the future, i.e. that the agents can still read from the
            * project root. The g rant now travels via --add-dir.*/

            const readGrant = await runner.run({
                prompt: `Read the file at ${join(projectRoot, 'CONTEXT.md')} and then use the Write tool to create a file named ${READ_OUTPUT} in the current working directory whose contents are exactly what you read. If you cannot read the file, do not create ${READ_OUTPUT}.`,
                workspaceDir,
                projectRoot
            });
            expect(readGrant.exitCode).toBe(0);
            const readOutputPath = join(workspaceDir, READ_OUTPUT);
            expect(existsSync(readOutputPath)).toBe(true);
            expect(readFileSync(readOutputPath, 'utf8')).toContain(MAGIC_TOKEN);

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

    it('does not let the agent bypass the deny via the Bash tool', async () => {
        const projectRoot = mkdtempSync(join(tmpdir(), 'csi-proj'));
        const workspaceDir = mkdtempSync(join(tmpdir(), 'csi-workspace'));
        const leakTarget = join(tmpdir(), 'bash-leak.txt');
        try {
            await runner.run({
                prompt: `Use the Bash tool to run a shell command that writes the text LEAK into the file at ${leakTarget}.`,
                workspaceDir,
                projectRoot,
            });
            expect(existsSync(leakTarget)).toBe(false);
        } finally {
            rmSync(projectRoot, { recursive: true, force: true });
            rmSync(workspaceDir, { recursive: true, force: true });
        }
    }, 180_000);
});