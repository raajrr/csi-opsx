import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ToolId } from './types.js';
import { TOOL_DIRS } from './tools.js';

export function hasOpenSpecSkills(projectRoot: string, toolDir: string): boolean {
    const skillsDir = join(projectRoot, toolDir, 'skills');
    if (!existsSync(skillsDir)) return false;
    return readdirSync(skillsDir).some(
        entry => entry.startsWith('openspec-') && existsSync(join(skillsDir, entry, 'SKILL.md'))
    );
}

export function getConfiguredTools(projectRoot: string): ToolId[] {
    return (Object.entries(TOOL_DIRS) as [ToolId, string][])
        .filter(([, dir]) => hasOpenSpecSkills(projectRoot, dir))
        .map(([toolId]) => toolId);
}