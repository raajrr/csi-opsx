import type { CommandName } from '../types.js';

export interface SkillAdapter {
    getSkillPath(toolDir: string, commandName: CommandName): string;
    getCommandPath(toolDir: string, commandName: CommandName): string;
    formatCommandFile(commandName: CommandName, skillContent: string): string;
}