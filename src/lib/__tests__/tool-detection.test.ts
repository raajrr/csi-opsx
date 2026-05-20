import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { hasOpenSpecSkills, getConfiguredTools } from '../tool-detection.js';

describe('tool-detection', () => {
    let tmpDir: string;

    beforeEach(() => {
        // Sets tmpDir to something like /tmp/csi-detect-<date-now>
        tmpDir = join(tmpdir(), `csi-detect-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        // Removes the temporary directory
        rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('hasOpenSpecSkills', () => {
        it('returns false when toolDir does not exist', () => {
            // No directory exists, so expect false
            expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
        });

        it('returns false when skills dir exists but has no openspec-* entries', () => {
            // Make a directory called .claude/skills/openspec-explore under tempDir
            mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true });
            // Directory exists but there are no skills in it. So, expect false.
            expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
        });

        it('returns false when openspec-* dir exists but SKILL.md is missing', () => {
            // Make a directory called .claude/skills/openspec-explore under tempDir
            mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-explore'), { recursive: true });
            // Directory exists, but SKILL.md is missing. So, expect false.
            expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(false);
        });

        it('returns true when openspec-*/SKILL.md exists', () => {
            // Make a directory called .claude/skills/openspec-explore under tempDir
            mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-explore'), { recursive: true });
            // Create a file called .claude/skills/openspec-explore/SKILL.md with data "# skill under tempDir"
            writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-explore', 'SKILL.md'), '# skill');
            // Should expect true because the .claude/skills/openspec-explore directory exists and contains the SKILL.md
            expect(hasOpenSpecSkills(tmpDir, '.claude')).toBe(true);
        });
    });

    describe('getConfiguredTools', () => {
        it('returns an empty array when no tools are configured', () => {
            // Here tmpDir is an empty temp directory which means no tools have been configured.
            // So, an empty array should be returned.
            expect(getConfiguredTools(tmpDir)).toEqual([]);
        });

        it('returns claude when .claude openspec skills exist', () => {
            // Make a directory called .claude/skills/openspec-propose under tmpDir
            mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-propose'), { recursive: true });
            // Create a file called .claude/skills/openspec-propose/SKILL.md with data "# skill" under tmpDir
            writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
            // Since an openspec skill exists in a subdirectory of .claude under tmpDir, Claude has been configured.
            // No other directories have been created under tmpDir for this test.
            // So, expect an array with one configured tool.
            expect(getConfiguredTools(tmpDir)).toEqual(['claude']);
        });

        it('returns multiple tools when both have openspec skills', () => {
            // Make a directory called .claude/skills/openspec-propose under tmpDir
            mkdirSync(join(tmpDir, '.claude', 'skills', 'openspec-propose'), { recursive: true });
            // Create a file called .claude/skills/openspec-propose/SKILL.md with data "# skill" under tmpDir
            writeFileSync(join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
            // Make a directory called .cursor/skills/openspec-propose under tmpDir
            mkdirSync(join(tmpDir, '.cursor', 'skills', 'openspec-propose'), { recursive: true });
            // Create a file called .cursor/skills/openspec-propose/SKILL.md with data "# skill" under tmpDir
            writeFileSync(join(tmpDir, '.cursor', 'skills', 'openspec-propose', 'SKILL.md'), '# skill');
            const result = getConfiguredTools(tmpDir);
            // Since an openspec skill exists in a subdirectory of .claude under tmpDir, Claude has been configured.
            // Since an openspec skill exists in a subdirectory of .cursor under tmpDir, Cursor has been configured.
            // Expect the returned array to contain exactly these to tools.
            expect(result).toContain('claude');
            expect(result).toContain('cursor');
        });
    });
});