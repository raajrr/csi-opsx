import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspace, copyBack, cleanupWorkspace } from '../workspace.js';

describe('workspace', () => {
    let artifactsDir: string;

    const PROPOSAL_MD = 'proposal.md';
    const PROPOSAL_CONTENT = '# Proposal';
    const DESIGN_MD = 'design.md';
    const DESIGN_CONTENT = '# Design';
    const AUTH_MD = 'auth.md';
    const AUTH_CONTENT = '# Auth Spec';
    const OPENSPEC_DIR = 'openspec';
    const SPECS_DIR = 'specs';
    const AUTH_MD_SUBDIR = `${OPENSPEC_DIR}/${SPECS_DIR}/${AUTH_MD}`;

    beforeEach(() => {
        artifactsDir = join(tmpdir(), `ws-test-${Date.now()}`);
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(join(artifactsDir, PROPOSAL_MD), PROPOSAL_CONTENT);
        writeFileSync(join(artifactsDir, DESIGN_MD), DESIGN_CONTENT);
        mkdirSync(join(artifactsDir, OPENSPEC_DIR, SPECS_DIR), { recursive: true });
        writeFileSync(join(artifactsDir, OPENSPEC_DIR, SPECS_DIR, AUTH_MD), AUTH_CONTENT);
    });

    afterEach(() => {
        rmSync(artifactsDir, { recursive: true, force: true });
    });

    describe('createWorkspace', () => {
       it('creates a temp workspace directory', () => {
        const ws = createWorkspace('reviewer', 1, artifactsDir, [PROPOSAL_MD]);
        expect(existsSync(ws.dir)).toBe(true);
        rmSync(ws.dir, { recursive: true, force: true });
       });

       it('copies flat files into workspace directory', () => {
           const ws = createWorkspace('reviewer', 1, artifactsDir, [PROPOSAL_MD, DESIGN_MD]);
           expect(readFileSync(join(ws.dir, PROPOSAL_MD), 'utf-8')).toBe(PROPOSAL_CONTENT);
           expect(readFileSync(join(ws.dir, DESIGN_MD), 'utf-8')).toBe(DESIGN_CONTENT);
           rmSync(ws.dir, { recursive: true, force: true });
       });

       it('preserves subdirectory structure for nested paths', () => {
           const ws = createWorkspace('reviewer', 1, artifactsDir, [AUTH_MD_SUBDIR]);
           expect(existsSync(join(ws.dir, OPENSPEC_DIR, SPECS_DIR, AUTH_MD))).toBe(true);
           rmSync(ws.dir, { recursive: true, force: true });
       });

       it('skips files that do not exist in the artifacts directory', () => {
           const ws = createWorkspace('reviewer', 1, artifactsDir, ['nonexistent.md']);
           expect(existsSync(join(ws.dir, 'nonexistent.md'))).toBe(false);
           rmSync(ws.dir, { recursive: true, force: true });
       });

        it('dir name contains the role and round', () => {
            const ws = createWorkspace('proposer', 3, artifactsDir, []);
            expect(ws.dir).toContain('proposer');
            expect(ws.dir).toContain('3');
            rmSync(ws.dir, { recursive: true, force: true });
        });
    });

    describe('copyBack', () => {
        it('copies a file from workspace back to the artifacts directory', () => {
            const REVIEW_FINDINGS_1 = 'review-findings-1.md'
            const REVIEW_CONTENT = '---\nissues-found: 2\n---';
            const ws = createWorkspace('reviewer', 1, artifactsDir, []);
            writeFileSync(join(ws.dir, REVIEW_FINDINGS_1), REVIEW_CONTENT);
            copyBack(ws.dir, artifactsDir, [REVIEW_FINDINGS_1]);
            expect(readFileSync(join(artifactsDir, REVIEW_FINDINGS_1), 'utf-8')).toBe(REVIEW_CONTENT);
            rmSync(ws.dir, { recursive: true, force: true });
        });

        it('preserves subdirectory structure when copying back', () => {
            const UPDATED_AUTH_CONTENT = '# Updated Auth';
            const ws = createWorkspace('reviewer', 1, artifactsDir, [AUTH_MD_SUBDIR]);
            writeFileSync(join(ws.dir, AUTH_MD_SUBDIR), UPDATED_AUTH_CONTENT);
            copyBack(ws.dir, artifactsDir, [AUTH_MD_SUBDIR]);
            expect(readFileSync(join(artifactsDir, AUTH_MD_SUBDIR), 'utf-8')).toBe(UPDATED_AUTH_CONTENT);
            rmSync(ws.dir, { recursive: true, force: true });
        });

        it('copies multiple files with mixed paths back to the artifacts directory', () => {
            const UPDATED_PROPOSAL_CONTENT = '# Updated Proposal';
            const UPDATED_AUTH_CONTENT = '# Updated Auth';
            const ws = createWorkspace('reviewer', 1, artifactsDir, [PROPOSAL_MD, AUTH_MD_SUBDIR]);
            writeFileSync(join(ws.dir, PROPOSAL_MD), UPDATED_PROPOSAL_CONTENT);
            writeFileSync(join(ws.dir, AUTH_MD_SUBDIR), UPDATED_AUTH_CONTENT);
            copyBack(ws.dir, artifactsDir, [PROPOSAL_MD, AUTH_MD_SUBDIR]);
            expect(readFileSync(join(artifactsDir, PROPOSAL_MD), 'utf-8')).toBe(UPDATED_PROPOSAL_CONTENT);
            expect(readFileSync(join(artifactsDir, AUTH_MD_SUBDIR), 'utf-8')).toBe(UPDATED_AUTH_CONTENT);
            rmSync(ws.dir, { recursive: true, force: true });
        });
    });

    describe('cleanupWorkspace', () => {
        it('removes the workspace directory', () => {
            const ws = createWorkspace('reviewer', 1, artifactsDir, []);
            cleanupWorkspace(ws.dir);
            expect(existsSync(ws.dir)).toBe(false);
        });

        it('does not throw if workspace does not exist', () => {
            expect(() => cleanupWorkspace('/tmp/nonexistent-csi-opsx-xyz')).not.toThrow();
        });
    });
})