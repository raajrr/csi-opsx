import { mkdirSync, copyFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { AgentRole } from './types.js';

export interface Workspace {
    dir: string;
}

export function createWorkspace(
    role: AgentRole,
    round: number,
    artifactsDir: string,
    relativeFiles: string[]
): Workspace {
    const workspaceDir = join(tmpdir(), `csi-opsx-${role}-${round}-${Date.now()}`);
    mkdirSync(workspaceDir, { recursive: true });

    for (const relFile of relativeFiles) {
        const src = join(artifactsDir, relFile);
        if (existsSync(src)) {
            const dest = join(workspaceDir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }

    return { dir: workspaceDir };
}

export function copyBack(workspaceDir: string, artifactsDir: string, relativeFiles: string[]): void {
    for (const relFile of relativeFiles) {
        const src = join(workspaceDir, relFile);
        if(existsSync(src)) {
            const dest = join(artifactsDir, relFile);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    }
}

export function cleanupWorkspace(workspaceDir: string): void {
    if (existsSync(workspaceDir)) {
        rmSync(workspaceDir, { recursive: true, force: true });
    }
}