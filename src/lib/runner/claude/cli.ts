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
        const { prompt, workspaceDir, writablePaths } = opts;
        if (writablePaths) {
            writePermissions(workspaceDir, writablePaths);
        }
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