import type { Runner, RunnerResult} from '../../lib/runner/index.js';
import { resolveRunner } from '../../lib/runner/index.js';
import type { Workspace } from '../../lib/workspace.js';
import { cleanupWorkspace, copyBack, createWorkspace, sweepOrphanWorkspaces } from '../../lib/workspace.js';
import { findLatestFindingsRound, getFindingsPath, parseIssuesFound, parseStatus } from '../../lib/loop.js';
import { existsSync, readFileSync } from 'fs';
import { enumerateChangeArtifacts, getChangeDirectory, validateChangeName } from '../../lib/artifacts.js';
import type { AgentRole } from '../../lib/types.js';
import { ProposerAgent, ReviewerAgent } from './agents.js';
import { join, resolve } from 'path';

export interface HarnessOptions {
    workspace: string;   // project root (the --workspace CLI arg)
    changeName: string;  // the --change CLI arg
    maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 5;


/*
Run one agent stage in its workspace. The workspace is ALWAYS cleaned up (finally),
even on failure; the copy-back `commit` runs only on a clean exit (exitCode 0).
Cleanup is in the finally and process.exit is left to the caller AFTER this returns,
because calling process.exit inside the try would skip the finally and leak the dir.
*/
async function runStage(
    runner: Runner,
    ws: Workspace,
    prompt: string,
    projectRoot: string,
    commit: () => void
): Promise<RunnerResult> {
    try {
        const result = await runner.run({ prompt, workspaceDir: ws.dir, projectRoot });
        if (result.exitCode === 0) { commit(); }
        return result;
    } finally {
        cleanupWorkspace(ws.dir);
    }
}

export async function runReviewHarness(opts: HarnessOptions): Promise<void> {
    const  projectRoot = resolve(opts.workspace);
    const { changeName, maxRounds = DEFAULT_MAX_ROUNDS } = opts;
    if (maxRounds < 1) {
        console.log(`⚠ csi-opsx: --max-rounds must be at least 1 (got ${maxRounds}). Nothing to do.`);
        return;
    }
    validateChangeName(changeName);
    const changeDir = getChangeDirectory(projectRoot, changeName);
    const artifacts = enumerateChangeArtifacts(projectRoot, changeName);
    if(artifacts.length === 0) {
        console.log(`⚠ csi-opsx: no artifacts found in openspec/changes/${changeName}. Nothing to review.`);
        return;
    }

    const runner = resolveRunner();
    if (!runner) {
        console.log([
            '⚠ csi-opsx: No runner available.',
            '  Automated review loop unavailable.',
            '  Install Claude Code to enable the automated review loop.',
        ].join('\n'));
        return;
    }

    sweepOrphanWorkspaces(projectRoot, changeName);

    // --- Decide the starting phase from the committed findings (resumability) ---
    const OPEN_STATUS = 'open';
    let round = findLatestFindingsRound(changeDir);
    let phase: AgentRole;
    if (round === 0) {
        round = 1;
        phase = 'reviewer';
    } else {
        const latest = readFileSync(getFindingsPath(changeDir, round), 'utf8');
        const status = parseStatus(latest);
        const issue = parseIssuesFound(latest);
        if(status === OPEN_STATUS && issue === 0) {
            /*
            A previous run already converged: its final review found 0 issues. The proposer
            never runs on a 0-issue review, so "open" + 0 is the terminal state, not a resume point.
            */
            printSummary(changeDir, round, artifacts);
            return;
        }
        if (status === OPEN_STATUS) {
            phase = 'proposer'; // reviewer already produced findings; proposer's turn for round N
        } else {
            round++;
            phase = 'reviewer'; // status: addressed -> reviewer for the next round
        }
    }

    /* maxRounds is a per-invocation budget measured from the resume point, not an absolute
    *  ceiling. `round` here is already resume-adjusted (1 on a fresh run; the next/continuing
    *  round on a resume), so endRound = startRound - 1 + maxRounds means "run maxRounds rounds
    *  from wherever we pick up" — identical to the old absolute cap on a fresh run.
    * */
    const startRound = round;
    const endRound = startRound - 1 + maxRounds;
    while (round <= endRound) {
        const findingsName = `review-findings-${round}.md`;

        if(phase === 'reviewer') {
            // Reviewer reads artifacts in place; its workspace is empty and it writes only the findings file.
            const ws = createWorkspace(projectRoot, changeName, phase, round, changeDir, []);
            console.log(`  Round ${round}: reviewer running...`);
            const result = await runStage(
                runner,
                ws,
                ReviewerAgent.buildPrompt({ projectRoot, changeDir, artifactRelPaths: artifacts, round }),
                projectRoot,
                () => { if(existsSync(join(ws.dir, findingsName))) copyBack(ws.dir, changeDir, [findingsName]) }
            );
            // If the runStage process did not exit successfully
            if(result.exitCode !== 0){
                console.error(`Reviewer failed (round ${round}):\n${result.stderr}`);
                process.exit(1);
            }
            const findingsPath = getFindingsPath(changeDir, round);
            // If the reviewer did not create the reviewFindings file
            if(!existsSync(findingsPath)) {
                console.error(`Reviewer did not write ${findingsName}`);
                process.exit(1);
            }
            // If no issues were found after the review, just print the summary and return (stop)
            if (parseIssuesFound(readFileSync(findingsPath, 'utf8')) === 0) {
                printSummary(changeDir, round, artifacts);
                return;
            }
            phase = 'proposer';
        } else {
            // Proposer edits writable copies of the artifacts + findings; commit copies findings LAST.
            const proposerFiles = [...artifacts, findingsName];
            const ws = createWorkspace(projectRoot, changeName, 'proposer', round, changeDir, proposerFiles);
            const issues = parseIssuesFound(readFileSync(getFindingsPath(changeDir, round), 'utf8'));
            console.log(`  Round ${round}: proposer running (${issues} issue${issues === 1 ? '' : 's'})...`);
            const result = await runStage(
                runner,
                ws,
                ProposerAgent.buildPrompt({ projectRoot, changeDir, artifactRelPaths: artifacts, round }),
                projectRoot,
                () => copyBack(ws.dir, changeDir, proposerFiles)
            );
            if (result.exitCode !== 0){
                console.error(`Proposer failed (round ${round}):\n${result.stderr}`);
                process.exit(1);
            }
            round++;
            phase = 'reviewer';
        }
    }
    const counts = issuesPerRound(changeDir, maxRounds);
    console.log([
        `⚠ Review: reached max rounds (${maxRounds}) without converging to 0 issues.`,
        `  Issues found per round: ${counts.join(', ')}`,
        `  Review history: ${Array.from({ length: maxRounds }, (_, i) => `review-findings-${i + 1}.md`).join(', ')}`,
        '  Review the artifacts and the findings files manually.',
    ].join('\n'));
}

function printSummary (changeDir: string, rounds: number, artifacts: string[]): void {
    const findingFiles = Array
        .from({ length: rounds}, (_, r) => `review-findings-${r + 1}.md`);
    const counts = issuesPerRound(changeDir, rounds);
    console.log([
        '✓ Review complete',
        `  Rounds: ${rounds}`,
        '  Final review: 0 issues found',
        `  Issues found per round: ${counts.join(', ')}`,
        `  Artifacts: ${artifacts.join(', ')}`,
        `  Review history: ${findingFiles.join(', ')}`,
    ].join('\n'));
}
/*
Each round's reviewer records its own issues-found; reading them in sequence gives the
convergence trace (e.g. 6, 4, 2). Surfaced on the max-rounds exit so a human can see whether
the loop was still making progress when it stopped. existsSync guards any missing round.
*/
function issuesPerRound(changeDir: string, rounds: number): number[] {
    return Array.from(
        { length: rounds},(_, r) => getFindingsPath(changeDir, r+1))
        .filter(path => existsSync(path))
        .map(path => parseIssuesFound(readFileSync(path, 'utf8'))
        );
}