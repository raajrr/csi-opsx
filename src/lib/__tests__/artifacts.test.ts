import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateChangeName, getChangeDirectory, enumerateChangeArtifacts} from '../artifacts.js';

const CHANGE = 'add-auth';
describe('artifacts', () => {

    let projectRoot: string;
    let changeDir: string;

    beforeEach(() => {
        projectRoot = join(tmpdir(), `proj-${Date.now()}`);
        changeDir = join(projectRoot, 'openspec', 'changes', CHANGE);
        mkdirSync(changeDir, { recursive: true });
    });
    afterEach(() => {
        rmSync(projectRoot, { recursive: true, force: true });
    });

    describe('validateChangeName', () => {
        it('accepts normal names', () => {
           expect(() => validateChangeName('add-auth_v2.1')).not.toThrow();
        });
        it('rejects traversal and separators', () => {
            // invalid as a whole name (empty / current-dir / parent-dir)
            for (const name of ['', '.', '..']) {
                expect(() => validateChangeName(name)).toThrow();
            }
            for (const fragment of ['/', '\\']) {
                // standalone
                expect(() => validateChangeName(fragment)).toThrow();
                // embedded *in the middle*
                expect(() => validateChangeName(`${CHANGE}${fragment}x`)).toThrow();
            }
        });
    });

    describe('getChangeDirectory', () => {
        it('builds the change directory under openspec/changes', () => {
            expect(getChangeDirectory(projectRoot, CHANGE)).toBe(changeDir);
        });
        it('validates the name before building a path', () => {
            expect(() => getChangeDirectory(projectRoot, '..')).toThrow();
        });
    });

    describe('enumerateChangeArtifacts', () => {
        const PROPOSAL_MD = 'proposal.md';
        const TASKS_MD = 'tasks.md';
        const SPECS_DIR = 'specs';
        const AUTH_DIR = 'auth';
        const SPEC_MD = 'spec.md';
        it('returns only the known artifact files that exist', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, TASKS_MD), 'x'); // design.md intentionally absent
            expect(enumerateChangeArtifacts(projectRoot, CHANGE).sort()).toEqual([PROPOSAL_MD, TASKS_MD]);
        });

        it('includes nested specs/<capability>/spec.md with forward slashes', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            mkdirSync(join(changeDir, SPECS_DIR, AUTH_DIR), { recursive: true });
            writeFileSync(join(changeDir, SPECS_DIR, AUTH_DIR, SPEC_MD), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE).sort())
                .toEqual([PROPOSAL_MD, `${SPECS_DIR}/${AUTH_DIR}/${SPEC_MD}`]);
        });

        it('ignores spec.md files nested deeper than one capability level', () => {
           writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
           mkdirSync(join(changeDir, SPECS_DIR, AUTH_DIR, 'sso'), { recursive: true });
           writeFileSync(join(changeDir, SPECS_DIR, AUTH_DIR, 'sso', SPEC_MD), 'x');
           expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('excludes .openspec.yaml and review-findings files', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, '.openspec.yaml'), 'x');
            writeFileSync(join(changeDir, 'review-findings-1.md'), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('ignores unknown files', () => {
            writeFileSync(join(changeDir, PROPOSAL_MD), 'x');
            writeFileSync(join(changeDir, 'notes.md'), 'x');
            expect(enumerateChangeArtifacts(projectRoot, CHANGE)).toEqual([PROPOSAL_MD]);
        });

        it('throws when the change folder does not exist', () => {
            expect(() => enumerateChangeArtifacts(projectRoot, 'no-such-change')).toThrow();
        });
    });
});