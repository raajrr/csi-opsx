import type { ToolId } from './types.js';

export const TOOL_DIRS: Record<ToolId, string> = {
    'claude':         '.claude',
    'cursor':         '.cursor',
    'gemini':         '.gemini',
    'codex':          '.codex',
    'github-copilot': '.github',
};