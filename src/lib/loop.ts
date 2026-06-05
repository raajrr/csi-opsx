import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export type FindingsStatus = 'open' | 'addressed';

/*
* Extract the block of text between the first pair of --- fences
* eg:
* ---
* issues-found: 2
* round: 1
* status: open
* ---
* */
function frontmatter(content: string): string {
    const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
    return m ? m[1] : '';
}

export function parseIssuesFound(content: string): number {
    const match = frontmatter(content).match(/^issues-found:\s*(\d+)\s*$/m);
    if (!match) throw new Error('Missing issues-found field in findings file');
    return parseInt(match[1], 10);
}

export function parseStatus(content: string): FindingsStatus {
    const match = frontmatter(content).match(/^status:\s*(open|addressed)\s*$/m);
    if (!match) throw new Error('Missing status field in findings file');
    return match[1] as FindingsStatus;
}

export function findLatestFindingsRound(artifactsDir: string): number {
    if(!existsSync(artifactsDir)) { return 0; }
    const rounds = readdirSync(artifactsDir)
        .map((f) => f.match(/^review-findings-(\d+)\.md$/))
        .filter((m): m is RegExpMatchArray => m != null)
        .map((m) => parseInt(m[1], 10));
        /*
        * If the array of review-findings file numbers is empty, return 0
        * Else return the maximum number from that array
        * */
    return rounds.length === 0 ? 0 : Math.max(...rounds);
}

export function getFindingsPath(artifactsDir: string, round: number): string {
    return join(artifactsDir, `review-findings-${round}.md`);
}