import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../adapters/claude.js';

describe('ClaudeAdapter', () => {
   const adapter = new ClaudeAdapter();

   describe('getSkillPath', () => {
      it('returns csi-opx-{name}/SKILL.md path under toolDir/skills', () => {
          // If the toolDir is .claude and the commandName is explore then
          // the corresponding skill path should be returned.
         expect(adapter.getSkillPath('.claude', 'explore')).toBe(
             '.claude/skills/csi-opsx-explore/SKILL.md',
         )
      });

       it('works for all command names', () => {
           //  Repeat the first test but for the 3 other commands too
           expect(adapter.getSkillPath('.claude', 'propose')).toBe('.claude/skills/csi-opsx-propose/SKILL.md');
           expect(adapter.getSkillPath('.claude', 'apply')).toBe('.claude/skills/csi-opsx-apply/SKILL.md');
           expect(adapter.getSkillPath('.claude', 'archive')).toBe('.claude/skills/csi-opsx-archive/SKILL.md');
       });
   });

   describe('getCommandPath', () => {

       it('returns csi-opsx/{name}.md path under toolDir/commands', () => {
           // If the toolDir is .claude and the commandName is explore then
           // the corresponding command path should be returned.
           expect(adapter.getCommandPath('.claude', 'explore')).toBe('.claude/commands/csi-opsx/explore.md');
       });

       it('works for propose', () => {
           // Same as previous test but for propose rather than explore
           expect(adapter.getCommandPath('.claude', 'propose')).toBe('.claude/commands/csi-opsx/propose.md');
       });
   });

   describe('formatCommandFile', () => {
       it('includes the slash command name in the output', () => {
           const result = adapter.formatCommandFile('explore', '# content');
           expect(result).toContain('/csi-opsx:explore');
       });

       it('references the skill file by name', () => {
           const result = adapter.formatCommandFile('propose', '# content');
           expect(result).toContain('csi-opsx-propose');
       });
   });
});