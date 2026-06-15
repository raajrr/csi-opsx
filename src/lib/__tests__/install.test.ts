import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSkills, installCommands, installThirdPartySkills } from '../install.js';

const EXPLORE_SKILL = '# Explore Skill';
const PROPOSE_SKILL = '# Propose Skill';
const GRILL_SKILL   = '# Grill';

describe('install', () => {
    // The directory of the project in which csi-opsx will be initialized.
    let projectDir: string;
    // Directory where csi-opsx's commands sit (eg: dist/commands/).
    let sourceDir: string;
    // Directory where third party skills like "grill-with-docs" sit.
    let thirdPartyDir: string;

    beforeEach(() => {

        projectDir = join(tmpdir(), `csi-install-${Date.now()}`);
        sourceDir = join(tmpdir(), `csi-source-${Date.now()}`);
        thirdPartyDir = join(tmpdir(), `csi-skills-${Date.now()}`);

        // Make the source directories for explore and propose (eg: dist/commands/explore)
        mkdirSync(join(sourceDir, 'explore'), { recursive: true });
        mkdirSync(join(sourceDir, 'propose'), { recursive: true });

        // Write the dist/commands/explore/SKILL.md file
        writeFileSync(join(sourceDir, 'explore', 'SKILL.md'), EXPLORE_SKILL);
        // Write the dist/commands/propose/SKILL.md file
        writeFileSync(join(sourceDir, 'propose', 'SKILL.md'), PROPOSE_SKILL);

        // Make the directory for the project in which csi-opsx will be initialized
        mkdirSync(projectDir, { recursive: true });
        // Make the directory where csi-opsx's third party skills will live (eg: dist/skills/)
        mkdirSync(thirdPartyDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(sourceDir, { recursive: true, force: true });
        rmSync(thirdPartyDir, { recursive: true, force: true });
    });

    describe('installSkills', () => {
        it('copies SKILL.md to toolDir/skills/csi-opsx-{name}/SKILL.md', () => {
            // Call installSkills with a project directory for Claude to install one skill,
            // i.e. explore, and the source directory, i.e directory where the command is in
            // csi-opsx package.
            installSkills(projectDir, '.claude', ['explore'], sourceDir);
            // Path of the file that the installSkills function should create for the explore
            // skill
            const dest = join(projectDir, '.claude', 'skills', 'csi-opsx-explore', 'SKILL.md');
            // The file should exist
            expect(existsSync(dest)).toBe(true);
            // The file should exist and should contain the expected content.
            expect(readFileSync(dest, 'utf8')).toBe(EXPLORE_SKILL);
        });

        it('installs all specified commands', () => {
            // Call installSkills with a project directory for Claude to install two skills,
            // namely explore, and propose, and the source directory, i.e directory where the
            // commands are in csi-opsx package.
            installSkills(projectDir, '.claude', ['explore', 'propose'], sourceDir);
            // Files for each of the skills should exist.
            expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-explore', 'SKILL.md'))).toBe(true);
            expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-propose', 'SKILL.md'))).toBe(true);
        });

        it('skips commands with no SKILL.md in source', () => {
            // Call installSkills with a project directory for Claude to install one skill,
            // i.e. apply, and the source directory, i.e directory where the command is in
            // csi-opsx package.
            installSkills(projectDir, '.claude', ['apply'], sourceDir);
            // Since we don't have an apply command for the test setup, the directory shouldn't
            // be created.
            expect(existsSync(join(projectDir, '.claude', 'skills', 'csi-opsx-apply', 'SKILL.md'))).toBe(false);
        });
    });

    describe('installCommands', () => {
        it('writes command file to toolDir/commands/csi-opsx/{name}.md for claude', () => {
            // Call installCommands with a project directory for Claude to install one command,
            // i.e. explore, and the source directory, i.e. directory where the command is in
            // csi-opsx package, and with tool id claude.
            installCommands(projectDir, 'claude', '.claude', ['explore'], sourceDir);
            // Path of the file that the installCommands function should create for the explore
            // command
            const dest = join(projectDir, '.claude', 'commands', 'csi-opsx', 'explore.md');
            // The file should exist
            expect(existsSync(dest)).toBe(true);
            // The created file should contain the name of the command which, since this test cases uses claude
            // as the tool should contain /csi-opsx:explore (implementation detail of ClaudeAdapter)
            expect(readFileSync(dest, 'utf8')).toContain('/csi-opsx:explore');
        });

        it('skips tool IDs with no registered adapter', () => {
            // Call installCommands with a project directory for Cursor to install one command,
            // i.e. explore, and the source directory, i.e. directory where the command is in
            // csi-opsx package, and with tool id cursor.
            installCommands(projectDir, 'cursor', '.cursor', ['explore'], sourceDir);
            // Since as of the writing of this test cursor doesn't have a registered adapter in this app
            // installCommands shouldn't create a directory to copy the commands over for this tool.
            expect(existsSync(join(projectDir, '.cursor', 'commands', 'csi-opsx', 'explore.md'))).toBe(false);
        });

        it('still writes command file when SKILL.md is absent in source', () => {
                installCommands(projectDir, 'claude', '.claude', ['apply'], sourceDir);
                const dest = join(projectDir, '.claude', 'commands', 'csi-opsx', 'apply.md');
                expect(existsSync(dest)).toBe(true);
            });
    });

    describe('installThirdPartySkills', () => {
        it('copies all files from each skill directory to toolDir/skills/{name}/', () => {
            // Create a directory for grill-me
            mkdirSync(join(thirdPartyDir, 'grill-me'), { recursive: true });
            // Create the grill-me files (resembling the actual grill-me structure)
            writeFileSync(join(thirdPartyDir, 'grill-me', 'SKILL.md'), GRILL_SKILL);
            // Run installThirdPartySkills
            installThirdPartySkills(projectDir, '.claude', thirdPartyDir);
            // Path to the directory that should be created.
            const dest = join(projectDir, '.claude', 'skills', 'grill-me');
            // The three files should exist in the destination directory
            expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
            // The SKILL.md file should contain the expected content
            expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toBe(GRILL_SKILL);
        });

        it('is a no-op when skillsSourceDir does not exist', () => {
            expect(() =>
                // If no third party skill directory exists, the app shouldn't throw an exception
                installThirdPartySkills(projectDir, '.claude', join(thirdPartyDir, 'nonexistent'))
            ).not.toThrow();
        });

        it('installs multiple skill directories', () => {
            // Create 2 third party skill directories
            mkdirSync(join(thirdPartyDir, 'skill-a'), { recursive: true });
            mkdirSync(join(thirdPartyDir, 'skill-b'), { recursive: true });
            // Create SKILL.md files for each skill
            writeFileSync(join(thirdPartyDir, 'skill-a', 'SKILL.md'), '# A');
            writeFileSync(join(thirdPartyDir, 'skill-b', 'SKILL.md'), '# B');
            installThirdPartySkills(projectDir, '.claude', thirdPartyDir);
            // Both SKILL.md files should be copied over to corresponding directories under .claude/skills
            // when the tool is claude
            expect(existsSync(join(projectDir, '.claude', 'skills', 'skill-a', 'SKILL.md'))).toBe(true);
            expect(existsSync(join(projectDir, '.claude', 'skills', 'skill-b', 'SKILL.md'))).toBe(true);
        });
    });
});