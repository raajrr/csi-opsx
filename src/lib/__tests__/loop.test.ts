import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    parseIssuesFound,
    parseStatus,
    findLatestFindingsRound,
    getFindingsPath,
} from '../loop.js';

describe('loop', () => {
   let tmpDir: string;

   beforeEach(() => {
       tmpDir = join(tmpdir(), `loop-test-${Date.now()}`);
       mkdirSync(tmpDir, { recursive: true });
   });

   afterEach(() => {
       rmSync(tmpDir, { recursive: true, force: true });
   });

   describe('parseIssuesFound', () => {
       it('returns the integer from issues-found field', () => {
          expect(parseIssuesFound('---\nissues-found: 3\nstatus: open\n---\n')).toBe(3);
       });

       it('returns 0 when issues-found is 0', () => {
           expect(parseIssuesFound('---\nissues-found: 0\nstatus: open\n---\n')).toBe(0);
       });

       it('throws when issues-found field is absent', () => {
           expect(() => parseIssuesFound('---\nstatus: open\n---\n')).toThrow('Missing issues-found');
       });
   });

    describe('parseStatus', () => {
        it('returns open when status is open', () => {
            expect(parseStatus('---\nissues-found: 2\nstatus: open\n---')).toBe('open');
        });

        it('returns addressed when status is addressed', () => {
            expect(parseStatus('---\nissues-found: 2\nstatus: addressed\n---')).toBe('addressed');
        });

        it('throws when status field is absent', () => {
            expect(() => parseStatus('---\nissues-found: 2\n---')).toThrow('Missing status');
        });
    });

    describe('findLatestFindingsRound', () => {
       it('returns 0 when no review-findings-*.md files exist', () => {
           expect(findLatestFindingsRound(tmpDir)).toBe(0);
       });

        it('returns highest round number present', () => {
            writeFileSync(join(tmpDir, 'review-findings-1.md'), '---\nissues-found: 2\nstatus: addressed\n---');
            writeFileSync(join(tmpDir, 'review-findings-2.md'), '---\nissues-found: 1\nstatus: open\n---');
            expect(findLatestFindingsRound(tmpDir)).toBe(2);
        });

        it('ignores files that do not match the pattern', () => {
           writeFileSync(join(tmpDir, 'proposal.md'), '# proposal');
           writeFileSync(join(tmpDir, 'review-findings-1.md'), '---\nissues-found: 0\nstatus: open\n---');
           expect(findLatestFindingsRound(tmpDir)).toBe(1);
        });

        it('returns 0 when the directory does not exist', () => {
            expect(findLatestFindingsRound(join(tmpDir,
                'no-such-dir'))).toBe(0);
        });
    });

    describe('getFindingsPath', () => {
       it('returns review-findings-N.md in the artifacts directory', () => {
           const TMP_PROJECT_DIR = 'tmp/project';
          expect(getFindingsPath(TMP_PROJECT_DIR, 2)).toBe(join(TMP_PROJECT_DIR, 'review-findings-2.md'));
       });
    });

    describe('frontmatter anchoring',  () => {
        const ISSUES_FOUND = 2;
        const STATUS = 'open';
        const WITH_BODY= [
            '---',
            `issues-found: ${ISSUES_FOUND}`,
            'round: 1',
            `status: ${STATUS}`,
            '---',
            '',
            '## Issue 1: title',
            'is-solved: false',
            'The doc says status: addressed somewhere.',
            '',
        ].join('\n');

        it('parseStatus reads the frontmatter status, ignoring body text', () => {
            expect(parseStatus(WITH_BODY)).toBe(STATUS);
        });

        it('parseIssuesFound reads the frontmatter count, ignoring body text', () => {
            expect(parseIssuesFound(WITH_BODY)).toBe(ISSUES_FOUND);
        });

        it('parseStatus throws when there is no frontmatter block', () => {
            expect(() => parseStatus('## Just a heading\nstatus: open')).toThrow('Missing status');
        });
    });
});