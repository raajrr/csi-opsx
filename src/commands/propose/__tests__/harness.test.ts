import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../../lib/runner/index.js', () => ({ resolveRunner: vi.fn() }));

import { resolveRunner } from '../../../lib/runner/index.js';
import { runProposeHarness } from '../harness.js';
import {write} from "node:fs";

const CHANGE = 'add-auth';

describe('runProposeHarness', () => {
    let projectRoot: string;
    let changeDir: string;

    const PROPOSAL_MD = 'proposal.md';
    const PROPOSAL_CONTENT = '# Proposal';
    const DESIGN_MD = 'design.md';
    const DESIGN_CONTENT = '# Design';
    const REVIEW_FINDINGS_1 = 'review-findings-1.md';
    const REVIEW_FINDINGS_2 = 'review-findings-2.md';

    beforeEach(() => {
        projectRoot = join(tmpdir(), `harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        changeDir = join(projectRoot, 'openspec', 'changes', CHANGE);
        mkdirSync(changeDir, { recursive: true });
        writeFileSync(join(changeDir, PROPOSAL_MD), PROPOSAL_CONTENT);
        writeFileSync(join(changeDir, DESIGN_MD), DESIGN_CONTENT);
    });
    afterEach(() => {
        rmSync(projectRoot, { recursive: true, force: true });
        vi.resetAllMocks();
    });

    const findings = (issues: number, round: number, status: 'open' | 'addressed') =>
        `---\nissues-found: ${issues}\nround: ${round}\nstatus: ${status}\n---\n`;

    it('prints a notice and exits when no runner is available', async () => {
        vi.mocked(resolveRunner).mockReturnValue(null);
        const log = vi.spyOn(console, 'log');
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE});
        expect(log).toHaveBeenCalledWith(expect.stringContaining('No runner available'));
    });

    it('exits cleanly when the first review finds 0 issues', async () => {
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
                writeFileSync(join(workspaceDir, REVIEW_FINDINGS_1), findings(0, 1, 'open'));
                return { exitCode: 0, stdout: '', stderr: ''}
            }),
        });
        const log = vi.spyOn(console, 'log');
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE});
        /* Verify that the review findings file that was created in the workspace directory in the mock
        *  got copied over
        * */
        expect(existsSync(join(changeDir, REVIEW_FINDINGS_1))).toBe(true);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('csi-opsx propose complete'));
    });

    it('runs reviewer -> proposer -> reviewer until 0 issues', async () => {
        const UPDATED_PROPOSAL_CONTENT = '# Updated';
        let n = 0;
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir }: { workspaceDir: string}) => {
                n++;
                switch (n) {
                    case 1: writeFileSync(join(workspaceDir, REVIEW_FINDINGS_1), findings(1, 1, 'open')  + '## Issue 1\nis-solved: false\nx');
                            break;
                    case 2: writeFileSync(join(workspaceDir, REVIEW_FINDINGS_1), findings(1, 1, 'addressed'));
                            writeFileSync(join(workspaceDir, PROPOSAL_MD), UPDATED_PROPOSAL_CONTENT);
                            break;
                    case 3: writeFileSync(join(workspaceDir, REVIEW_FINDINGS_2), findings(0, 2, 'open'));
                            break;
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            }),
        });
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE});
        expect(n).toBe(3);
        expect(readFileSync(join(changeDir, PROPOSAL_MD), 'utf8')).toBe(UPDATED_PROPOSAL_CONTENT);
        expect(existsSync(join(changeDir, REVIEW_FINDINGS_1))).toBe(true);
        expect(existsSync(join(changeDir, REVIEW_FINDINGS_2))).toBe(true);
    });

    it('resumes status=addressed by running the reviewer for the next round', async () => {
        /* Create a review-findings-1.md file in the change directory with status addressed to indicate
        *  one review -> propose cycle.*/
        writeFileSync(join(changeDir, REVIEW_FINDINGS_1), findings(1, 1, 'addressed'));
        let n = 0;
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir }: { workspaceDir: string}) => {
                n++;
                writeFileSync(join(workspaceDir, REVIEW_FINDINGS_2), findings(0, 2, 'open'));
                return { exitCode: 0, stdout: '', stderr: ''};
            }),
        });
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE});
        expect(n).toBe(1);
        expect(existsSync(join(changeDir, REVIEW_FINDINGS_2))).toBe(true);
    });

    it('resumes status=open (issues>0) by running the proposer for the same round', async () => {
        // File to indicate that the reviewer has run and found issues
        writeFileSync(join(changeDir, REVIEW_FINDINGS_1), findings(2, 1, 'open') + '## Issue 1\nis-solved: false\nx');
        const runProposerMock = vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
            // Simulate the proposer addressing the 2 issues
            writeFileSync(join(workspaceDir, REVIEW_FINDINGS_1), findings(2, 1, 'addressed'));
            return { exitCode: 0, stdout: '', stderr: ''};
        });
        let n = 0;
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir } : { workspaceDir: string}) => {
                n++;
                if ( n === 1 ) { return runProposerMock({ workspaceDir }); }
                /* Once the issues have been addressed, the reviewer should be called again
                *  and this time we simulate it finding 0 issues. */
                writeFileSync(join(workspaceDir, REVIEW_FINDINGS_2), findings(0, 2, 'open'));
                return { exitCode: 0, stdout: '', stderr: '' };
            }),
        });
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE});
        expect(n).toBe(2);
        expect(existsSync(join(changeDir, REVIEW_FINDINGS_2))).toBe(true);
    });

    it('does NOT copy back artifacts when the proposer exits non-zero', async () => {
        let n = 0;
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
                n++;
                if ( n === 1 ) {
                    // Simulating first review run with issues found
                    writeFileSync(join(workspaceDir, REVIEW_FINDINGS_1), findings(1, 1, 'open') + '## Issue 1\nis-solved: false\nx');
                    return { exitCode: 0, stdout: '', stderr: '' };
                }
                // Simulating a crash while proposer is in the midst of addressing issues
                writeFileSync(join(workspaceDir, PROPOSAL_MD), '# Should NOT be committed.');
                return { exitCode: 1, stdout: '', stderr: 'boom' };
            }),
        });
        // Spy on process.exit
        const exitSpy = vi.spyOn(process, 'exit')
            // And replace the real process.exit with a mock implementation so that instead of aborting it throws an Error
            .mockImplementation(((): never => { throw new Error('exit'); }));
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE}).catch(() => {});
        expect(readFileSync(join(changeDir, PROPOSAL_MD), 'utf8')).toBe(PROPOSAL_CONTENT); // unchanged
        // Removes the mocked process.exit and puts the real one back in place
        exitSpy.mockRestore();
    });

    it('respects maxRounds when the reviewer keeps finding issues', async () => {
        let n = 0;
        vi.mocked(resolveRunner).mockReturnValue({
            isAvailable: () => true,
            run: vi.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
                n++;
                const round = Math.ceil(n/2);
                const REVIEW_FINDINGS = `review-findings-${round}.md`;
                // Odd n => reviewer is running
                if (n%2 === 1)
                    // Simulate the case where whenever a reviewer runs it finds an issue
                    writeFileSync(join(workspaceDir, REVIEW_FINDINGS), findings(1, round, 'open') + '## Issue\nis-solved: false\nx');
                else
                    // Simulate proposer addressing the issue
                    writeFileSync(join(workspaceDir, REVIEW_FINDINGS), findings(1, round, 'addressed'));
                return { exitCode: 0, stdout: '', stderr: '' };
            }),
        });
        const log = vi.spyOn(console, 'log');
        // Run the review -> propose loop for only 2 rounds
        await runProposeHarness({ workspace: projectRoot, changeName: CHANGE, maxRounds: 2});
        expect(n).toBe(4); // 2 * (review -> propose rounds)
        expect(log).toHaveBeenCalledWith(expect.stringContaining('reached max rounds'));
    });
});