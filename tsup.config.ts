import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS = ['explore', 'propose', 'apply', 'archive'] as const;

export default defineConfig({
    entry: ['src/bin/cli.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    onSuccess: async () => {
        for (const cmd of COMMANDS) {
            const destDir = join('dist', 'commands', cmd);
            mkdirSync(destDir, { recursive: true });
            for(const asset of ['SKILL.md', 'command.md']) {
                const src = join('src', 'commands', cmd, asset);
                if (existsSync(src)) copyFileSync(src, join(destDir, asset));
            }
        }
    }
})