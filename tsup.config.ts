import { defineConfig } from 'tsup'
import {copyFileSync, mkdirSync, existsSync, readdirSync} from 'fs';
import { join } from 'path';

const COMMANDS = ['explore', 'propose', 'apply', 'archive'] as const;

export default defineConfig({
    entry: { 'bin/cli': 'src/bin/cli.ts'},
    format: ['esm'],
    dts: true,
    clean: true,
    onSuccess: async () => {
        const COMMANDS_DIR = 'commands';
        // copy command skills: src/commands/<name>/SKILL.md → dist/commands/<name>/SKILL.md
        for (const cmd of COMMANDS) {
            const destDir = join('dist', COMMANDS_DIR, cmd);
            mkdirSync(destDir, { recursive: true });
            const src = join('src', COMMANDS_DIR, cmd, 'SKILL.md');
            if (existsSync(src)) copyFileSync(src, join(destDir, 'SKILL.md'));
        }
        const SKILLS_DIR = 'skills';
        // copy third-party skills: src/skills/<name>/ → dist/skills/<name>/
        const skillsSrc = join('src', SKILLS_DIR);
        if (existsSync(skillsSrc)) {
            for(const skillName of readdirSync(skillsSrc)) {
                const srcDir = join(skillsSrc, skillName);
                const destDir = join('dist', SKILLS_DIR, skillName);
                mkdirSync(destDir, { recursive: true });
                for (const file of readdirSync(srcDir)) {
                    copyFileSync(join(srcDir, file), join(destDir, file));
                }
            }
        }
    }
})