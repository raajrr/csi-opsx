// Importing for use within this file
import type { Runner } from './types.js';
import { ClaudeCliRunner } from './claude/cli.js';

// Exporting like an API so that callers don't have to reach into types.ts.
// Sort of like a facade (hide internal implementation)
export type { Runner, RunnerResult } from './types.js';

export function resolveRunner(): Runner | null {
    const claude = new ClaudeCliRunner();
    if(claude.isAvailable()) return claude;
    return null;
}