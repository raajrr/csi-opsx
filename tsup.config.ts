import { defineConfig } from 'tsup'
import {copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const COMMANDS = ['explore', 'propose', 'apply', 'archive', 'review'] as const;

export default defineConfig({
    entry: { 'bin/cli': 'src/bin/cli.ts'},
    format: ['esm'],
    dts: true,
    clean: true,
    onSuccess: async () => {
        const COMMANDS_DIR = 'commands';
        const SRC_DIR = 'src';
        const DIST_DIR = 'dist';
        const SKILL_MD = 'SKILL.md';
        const SKILLS_DIR = 'skills';
        // copy command skills: src/commands/<name>/SKILL.md → dist/commands/<name>/SKILL.md
        for (const cmd of COMMANDS) {
            const destDir = join(DIST_DIR, COMMANDS_DIR, cmd);
            mkdirSync(destDir, { recursive: true });
            const src = join(SRC_DIR, COMMANDS_DIR, cmd, SKILL_MD);
            if (existsSync(src)) copyFileSync(src, join(destDir, SKILL_MD));
        }
        // copy third-party skills: src/skills/<name>/ → dist/skills/<name>/
        const skillsSrc = join(SRC_DIR, SKILLS_DIR);
        // Wipe stale skills first so it always mirrors src/skills (even if every skill was removed)
        rmSync(join(DIST_DIR, SKILLS_DIR), { recursive: true, force: true });
        if (existsSync(skillsSrc)) {
            for(const skillName of readdirSync(skillsSrc)) {
                const srcDir = join(skillsSrc, skillName);
                const destDir = join(DIST_DIR, SKILLS_DIR, skillName);
                mkdirSync(destDir, { recursive: true });
                for (const file of readdirSync(srcDir)) {
                    copyFileSync(join(srcDir, file), join(destDir, file));
                }
            }
        }
    }
})