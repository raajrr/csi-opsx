import type { CommandName } from '../types.js';
import type { SkillAdapter } from './types.js';

export class ClaudeAdapter implements SkillAdapter {
    getSkillPath(toolDir: string, commandName: CommandName): string {
        return `${toolDir}/skills/csi-opsx-${commandName}/SKILL.md`;
    }

    getCommandPath(toolDir: string, commandName: CommandName): string {
        return `${toolDir}/commands/csi-opsx/${commandName}.md`;
    }

    formatCommandFile(commandName: CommandName, _skillContent: string): string {
        return [
            `# /csi-opsx:${commandName}`,
            '',
            `Load and follow the skill at \`csi-opsx-${commandName}/SKILL.md\` exactly.`,
        ].join('\n');
    }
}