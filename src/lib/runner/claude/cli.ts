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

        /*The workspace cwd is writable under acceptEdits. Read permission to the project must
        * be granted via the --add-dir flag. Claude Code ignores the additionalDirectories field
        * in the settings.json in untrusted directories (which temporary workspaces created for
        * the use of the reviewer and proposer are). The deny rules written by writePermissions still
        * take effect (since they shrink permissions), keeping the project read-only. Bash is
        * deliberately not allowed (write bypass)*/
        const args = ['-p', '--permission-mode', 'acceptEdits', '--setting-sources', 'project'];
        if (projectRoot) {
            writePermissions(workspaceDir, projectRoot);
            // shell:true joins args without enclosing them in quotes. Paths may contain spaces.
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
}