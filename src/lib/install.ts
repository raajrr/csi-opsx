import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { CommandName, ToolId } from './types.js';
import { getAdapter } from './adapters/index.js';

const SKILL_MD = 'SKILL.md';
const SKILLS_SUBDIR = 'skills';

export function installSkills(projectRoot: string,
                              toolDir: string,
                              commands: CommandName[],
                              sourceDir: string):void{
    for (const cmd of commands){
        const skillSrc = join(sourceDir, cmd, SKILL_MD);
        if (existsSync(skillSrc)){
            const dest = join(projectRoot, toolDir, SKILLS_SUBDIR, `csi-opsx-${cmd}`, SKILL_MD);
            // dirname(dest) - Splits on the last / in a path and returns the parent directory's path
            // mkdirSync then creates any missing folders in that path
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(skillSrc, dest);
        }
    }
}

export function installCommands(projectRoot: string,
                                toolId: ToolId,
                                toolDir: string,
                                commands: CommandName[],
                                sourceDir: string):void{
    const adapter = getAdapter(toolId);
    if(!adapter){ return; }

    for (const cmd of commands){
        const skillSrc = join(sourceDir, cmd, SKILL_MD);
        // If SKILL.md exists, read the content, else use empty string as fallback
        const skillContent = existsSync(skillSrc) ? readFileSync(skillSrc, 'utf8') : '';
        // The location to copy the command to
        const destPath = join(projectRoot, adapter.getCommandPath(toolDir, cmd));
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, adapter.formatCommandFile(cmd, skillContent));
    }
}

export function installThirdPartySkills(projectRoot: string,
                                        toolDir: string,
                                        skillsSourceDir: string):void{
    if(!existsSync(skillsSourceDir)){ return; }
    for (const skillName of readdirSync(skillsSourceDir)){
        // eg: /dist/skills/grill-me
        const srcDir = join(skillsSourceDir, skillName);
        // eg: <project-root>/.claude/skills/grill-me
        const destDir = join(projectRoot, toolDir, SKILLS_SUBDIR, skillName);
        mkdirSync(destDir, { recursive: true });
        for(const file of readdirSync(srcDir)){
            const srcFile = join(srcDir, file);
            // Only copy the srcFile if it is a file. Guarding against subdirectories.
            if(statSync(srcFile).isFile()){
                copyFileSync(join(srcDir, file), join(destDir, file));
            }
        }
    }
}
