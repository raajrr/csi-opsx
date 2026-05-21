import type { ToolId } from '../types.js';
import type { SkillAdapter } from './types.js';
import { ClaudeAdapter } from './claude.js';

export type { SkillAdapter };

const ADAPTERS: Partial<Record<ToolId, SkillAdapter>> = {
    claude: new ClaudeAdapter(),
};

export function getAdapter(toolId: ToolId): SkillAdapter | undefined {
    return ADAPTERS[toolId];
}