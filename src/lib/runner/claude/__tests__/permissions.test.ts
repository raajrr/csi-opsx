import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writePermissions } from '../permissions.js';

describe('permissions', () => {
   let tmpDir: string;

   const TMP_CLAUDE_DIR = '.claude';
   const SETTINGS_JSON = 'settings.json';
   const PROPOSAL_MD = 'proposal.md';
   const DESIGN_MD = 'design.md';

   beforeEach(() => {
       tmpDir = join(tmpdir(), `perms-test-${Date.now()}`);
       mkdirSync(tmpDir, { recursive: true });
   });

   afterEach(() => {
       rmSync(tmpDir, { recursive: true, force: true });
   });

   it(`creates ${TMP_CLAUDE_DIR}/${SETTINGS_JSON}`, () => {
       writePermissions(tmpDir, ['review-findings-1.md']);
       expect(existsSync(join(tmpDir, TMP_CLAUDE_DIR, SETTINGS_JSON))).toBe(true);
   });

   it('includes Write() allow entries for each writable file', () => {
       writePermissions(tmpDir, [PROPOSAL_MD, DESIGN_MD]);
       const settings = JSON.parse(readFileSync(join(tmpDir, TMP_CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
       expect(settings.permissions.allow).toContain(`Write(${PROPOSAL_MD})`);
       expect(settings.permissions.allow).toContain(`Write(${DESIGN_MD})`);
   })

    it('includes Write(*) in deny', () => {
        writePermissions(tmpDir, ['review-findings-1.md']);
        const settings = JSON.parse(readFileSync(join(tmpDir, TMP_CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
        expect(settings.permissions.deny).contain(`Write(*)`);
    });

   it('allow list has exactly as many entries as writable files', () => {
       writePermissions(tmpDir, [PROPOSAL_MD, DESIGN_MD, 'tasks.md']);
       const settings = JSON.parse(readFileSync(join(tmpDir, TMP_CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
       expect(settings.permissions.allow).toHaveLength(3);
   });
});