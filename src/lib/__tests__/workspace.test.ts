import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {mkdirSync, rmSync, writeFileSync, existsSync, readFileSync} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspace, copyBack, cleanupWorkspace, sweepOrphanWorkspaces } from '../workspace.js'

const CSI_OPSX_PREFIX = 'csi-opsx';
const PROJECT_NAME = 'my-project';
const PROJECT_ROOT = join(tmpdir(), PROJECT_NAME);
const CHANGE_NAME = 'add-auth';
const PROPOSAL_MD = 'proposal.md';
const PROPOSAL_CONTENT = '# Proposal';
const SPECS_DIR = 'specs';
const FEATURE_DIR = 'auth';
const SPEC_MD = 'spec.md';
const SPEC_CONTENT = '# Auth Spec';
const NESTED_SPEC_MD = `${SPECS_DIR}/${FEATURE_DIR}/${SPEC_MD}`;

const PROPOSER_AGENT = 'proposer';
const REVIEWER_AGENT = 'reviewer';

describe('workspace', () => {
    let changeDir: string;

    beforeEach(() => {
        changeDir = join(tmpdir(), `ws-source-${Date.now()}`);
        mkdirSync(join(changeDir, SPECS_DIR, FEATURE_DIR), { recursive: true });
        writeFileSync(join(changeDir, PROPOSAL_MD), PROPOSAL_CONTENT);
        writeFileSync(join(changeDir, NESTED_SPEC_MD), SPEC_CONTENT);
    });

    afterEach(() => {
        rmSync(changeDir, { recursive: true, force: true });
    });

    describe('createWorkspace', () => {
        it('creates a temp dir whose name encodes project base, change, role and round', () => {
            const ROUND_NUMBER = 3;
            const ws = createWorkspace(PROJECT_ROOT, CHANGE_NAME, PROPOSER_AGENT, ROUND_NUMBER, changeDir, []);
            try {
                expect(existsSync(ws.dir)).toBe(true);
                expect(ws.dir).toContain(`${CSI_OPSX_PREFIX}-${PROJECT_NAME}-`);
                expect(ws.dir).toContain(`-${CHANGE_NAME}-${PROPOSER_AGENT}-${ROUND_NUMBER}`);
            } finally {
                rmSync(ws.dir, { recursive: true, force: true });
            }
        });

        it('is deterministic for the same project/change/role/round', () => {
           const ROUND_NUMBER = 1;
           const wsA = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, ROUND_NUMBER, changeDir, []);
           const wsB = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, ROUND_NUMBER, changeDir, []);
           try {
               expect(wsA.dir).toBe(wsB.dir);
           } finally {
               rmSync(wsA.dir, { recursive: true, force: true });
               // This rmSync catches cases when the test fails, i.e. when wsA !== wsB
               rmSync(wsB.dir, { recursive: true, force: true });
           }
        });

        it('copies flat and nested files, preserving structure', () => {
           const ws = createWorkspace(PROJECT_ROOT, CHANGE_NAME, PROPOSER_AGENT, 1, changeDir, [PROPOSAL_MD, NESTED_SPEC_MD]);
           try {
                expect(readFileSync(join(ws.dir, PROPOSAL_MD), 'utf-8')).toBe(PROPOSAL_CONTENT);
                expect(existsSync(join(ws.dir, NESTED_SPEC_MD))).toBe(true);
           } finally {
               rmSync(ws.dir, { recursive: true, force: true });
           }
        });

        it('skips files absent from the source dir', () => {
            const NOPE_MD = 'nope.md';
            const ws = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, 1, changeDir, [NOPE_MD]);
            try { expect(existsSync(join(ws.dir, NOPE_MD))).toBe(false); } finally { rmSync(ws.dir, { recursive: true, force: true }); }
        });
    });

    describe('copyBack', () => {
        it('copies files (incl. nested) from workspace back to the change dir', () => {
            const UPDATED_PROPOSAL_CONTENT = '# Updated';
            const UPDATED_SPEC_CONTENT = '# Updated Spec';
            const ws = createWorkspace(PROJECT_ROOT, CHANGE_NAME, PROPOSER_AGENT, 1, changeDir, [PROPOSAL_MD, NESTED_SPEC_MD]);
            try {
                writeFileSync(join(ws.dir, PROPOSAL_MD), UPDATED_PROPOSAL_CONTENT);
                writeFileSync(join(ws.dir, NESTED_SPEC_MD), UPDATED_SPEC_CONTENT);
                copyBack(ws.dir, changeDir, [PROPOSAL_MD, NESTED_SPEC_MD]);
                expect(readFileSync(join(changeDir, PROPOSAL_MD), 'utf-8')).toBe(UPDATED_PROPOSAL_CONTENT);
                expect(readFileSync(join(changeDir, NESTED_SPEC_MD), 'utf-8')).toBe(UPDATED_SPEC_CONTENT);
            } finally {
                rmSync(ws.dir, { recursive: true, force: true });
            }
        });
    });

    describe('cleanupWorkspace', () => {
        it('removes the workspace dir', () => {
            const ws = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, 1, changeDir, []);
            cleanupWorkspace(ws.dir);
            expect(existsSync(ws.dir)).toBe(false);
        });

        it('does not throw if workspace does not exist', () => {
            expect(() => cleanupWorkspace(join(tmpdir(), 'csi-opsx-absent'))).not.toThrow();
        });
    });

    describe('sweepOrphanWorkspaces', () => {
        it('removes leftover dirs for this project+change but leaves other changes alone', () => {
            const mine = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, 1, changeDir, []);
            const other = createWorkspace(PROJECT_ROOT, 'add-billing', REVIEWER_AGENT, 1, changeDir, []);
            try {
                sweepOrphanWorkspaces(PROJECT_ROOT, CHANGE_NAME);
                expect(existsSync(mine.dir)).toBe(false);
                expect(existsSync(other.dir)).toBe(true);
            } finally {
                rmSync(mine.dir, { recursive: true, force: true });
                rmSync(other.dir, { recursive: true, force: true });
            }
        });

        it('does not sweep a change whose name merely extends this one (add-auth vs add-auth-extra)', () => {
            const mine = createWorkspace(PROJECT_ROOT, CHANGE_NAME, REVIEWER_AGENT, 1, changeDir, []);
            const sibling = createWorkspace(PROJECT_ROOT, `${CHANGE_NAME}-extra`, REVIEWER_AGENT, 1, changeDir, []);
            try {
                sweepOrphanWorkspaces(PROJECT_ROOT, CHANGE_NAME);
                expect(existsSync(mine.dir)).toBe(false);
                expect(existsSync(sibling.dir)).toBe(true);
            } finally {
                rmSync(mine.dir, { recursive: true, force: true });
                rmSync(sibling.dir, { recursive: true, force: true });
            }
        });
    });
});