import {mkdirSync, copyFileSync, existsSync, rmSync, readdirSync} from 'fs';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import type { AgentRole } from './types.js';

export interface Workspace {
    dir: string;
}

/* Deterministic prefix shared by every temp dir for one (project, change).
   pathHash disambiguates two same-named checkouts that share the OS temp namespace.
*/
function workspacePrefix(projectRoot: string, changeName: string): string {
    const base = basename(projectRoot);
    /*
    Windows and (default) macOS filesystems are case-insensitive, so normalize
    case before hashing. NOTE: a case-sensitive-formatted APFS volume would be
    mishandled here — rare enough to accept.
     */
    const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';
    const normalized = caseInsensitiveFs ? projectRoot.toLowerCase() : projectRoot;
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    return `csi-opsx-${base}-${hash}-${changeName}`;
}

export function createWorkspace(
    projectRoot: string,
    changeName: string,
    role: AgentRole,
    round: number,
    artifactsDir: string,
    relativeFiles: string[]
): Workspace {
    const workspaceDir = join(tmpdir(), `${workspacePrefix(projectRoot, changeName)}-${role}-${round}`);
    // Deterministic name: remove any stale dir from a prior crashed run before recreating.
    if(existsSync(workspaceDir)) { rmSync(workspaceDir, { recursive: true, force: true }); }
    mkdirSync(workspaceDir, { recursive: true });

    for (const relFile of relativeFiles) {
        const src = join(artifactsDir, relFile);
        if(existsSync(src)) {
            const dest = join(workspaceDir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }

    return { dir: workspaceDir };
}

// Copies files in list order — callers that need atomicity put the commit-marker file last.
export function copyBack(workspaceDir: string, artifactsDir: string, relativeFiles: string[]): void {
    for(const relFile of relativeFiles) {
        const src = join(workspaceDir, relFile);
        /*  Skip listed files that aren't present in the workspace — tolerates optional
            artifacts (e.g. design.md / tasks.md) the agent didn't produce this round.
        */
        if(existsSync(src)) {
            const dest = join(artifactsDir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }
}

export function cleanupWorkspace(workspaceDir: string): void {
    if(existsSync(workspaceDir)) {
        rmSync(workspaceDir, { recursive: true, force: true });
    }
}

/*
Remove orphaned temp dirs from prior crashed runs — scoped to this (project, change)
by matching the exact workspace-name shape under the OS temp dir. The matching rules
(escaping + anchoring) are explained inline below.
*/
export function sweepOrphanWorkspaces(projectRoot: string, changeName: string): void {
    const prefix = workspacePrefix(projectRoot, changeName);
    /*
    `prefix` embeds the project's folder name, which can contain regex metacharacters
    ('.', '(', '+', …). Inserted into a pattern raw, those would act as operators —
    e.g. an unescaped '.' means "any character", so a prefix built from "My.App" would
    also match a DIFFERENT project's dir like "MyXApp" and we'd delete its workspaces.
    This replace puts a backslash before every metachar ($& = the matched char) so each
    is matched literally.
    */
    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /*
    Require the FULL name, anchored start (^) to end ($): <prefix>-<role>-<round>.
    The role word immediately after the prefix and the trailing $ are what stop a sweep
    of "add-auth" from also deleting "add-auth-extra" (the next chunk would be "extra",
    not a role) or a suffixed leftover like "...-reviewer-1-old". \\d -> \d: backslashes
    are doubled because this regex is built from a string, not written as a /literal/.
    */
    const pattern = new RegExp(`^${safePrefix}-(reviewer|proposer)-\\d+$`);
    const base = tmpdir();

    for(const entry of readdirSync(base)){
        if(pattern.test(entry)){
            rmSync(join(base, entry), { recursive: true, force: true });
        }
    }

}