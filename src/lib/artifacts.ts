import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const KNOWN_FILES = ['proposal.md', 'design.md', 'tasks.md'];

/*
   A change name must be a single safe path segment — rejected BEFORE any path is built,
   so `--change ..` can never escape openspec/changes/.
*/
export function validateChangeName(name: string): void {
    if (name === '.' || name === '..' || !/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error(`Invalid change name: ${JSON.stringify(name)}`);
    }
}

export function getChangeDirectory(projectRoot: string, changeName: string): string {
    validateChangeName(changeName);
    return join(projectRoot, 'openspec', 'changes', changeName);
}

/*
   Returns artifact paths RELATIVE to the change dir, forward-slashed.
   Deterministic: same folder in -> same list out, no model in the loop.
*/
export function enumerateChangeArtifacts(projectRoot: string, changeName: string): string[] {
    const SPECS_SUBDIR = 'specs';
    const SPEC_MD = 'spec.md';

    const changeDirectory = getChangeDirectory(projectRoot, changeName);
    if(!existsSync(changeDirectory)) {
        throw new Error(`Change folder not found: openspec/changes/${changeName}`);
    }

    const found = KNOWN_FILES.filter(f => existsSync(join(changeDirectory, f)));
    const specsDirectory = join(changeDirectory, SPECS_SUBDIR);

    if(!existsSync(specsDirectory)) { return found; }

    /*
    OpenSpec capabilities are exactly one level deep (specs/<capability>/spec.md) —
    its apply/list/view code never recurses, so neither do we. A deeper spec.md is
    invisible to OpenSpec at apply time and must not become a writable artifact.
    */
    const specs = readdirSync(specsDirectory, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(specsDirectory, entry.name, SPEC_MD)))
        .map(entry => `${SPECS_SUBDIR}/${entry.name}/${SPEC_MD}`);
    return [...found, ...specs];
}