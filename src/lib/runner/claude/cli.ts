import { spawnSync } from 'child_process';
import type { Runner, RunnerResult } from '../types.js';

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