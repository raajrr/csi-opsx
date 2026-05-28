export type ToolId = 'claude' | 'cursor' | 'gemini' | 'codex' | 'github-copilot';
export type CommandName = 'explore' | 'propose' | 'apply' | 'archive';
export type AgentRole = 'reviewer' | 'proposer';
export const COMMAND_NAMES: CommandName[] = ['explore', 'propose', 'apply', 'archive'];