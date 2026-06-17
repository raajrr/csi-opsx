import type { AgentRole } from '../../lib/types.js';

export interface PromptArgs {
    projectRoot: string;        // Read-only root directory for the project (absolute)
    changeDir: string;          // <projectRoot>/openspec/changes/<name> (absolute)
    artifactRelPaths: string[]; // artifact paths relative to changeDir
    round: number;              // Round number for review/propose round
}

export interface AgentConfig {
    role: AgentRole;
    buildPrompt(args: PromptArgs): string;
}

function contextBlock(projectRoot: string): string {
    return [
        `Read these for project context (READ-ONLY — you cannot and must not modify them):`,
        `- ${projectRoot}/CLAUDE.md or ${projectRoot}/AGENTS.md (project conventions, if present)`,
        `- ${projectRoot}/openspec/ (existing specs and schemas)`,
        `- ${projectRoot}/docs/ (ADRs and other docs, if present)`,
        `- the project's source code under ${projectRoot}/ — when a claim or requirement`,
        `  depends on how the system actually behaves, read the specific source files`,
        `  involved rather than relying on documentation alone. Read only what's relevant.`,
    ].join('\n');
}

export const ReviewerAgent: AgentConfig = {
    role: 'reviewer',
    buildPrompt({ projectRoot, changeDir, artifactRelPaths, round }) {
        const artifactList = artifactRelPaths.map((a) => `- ${changeDir}/${a}`).join('\n');
        const prior =
            round > 1
                ? `\nAlso read ${changeDir}/review-findings-${round - 1}.md and verify each prior issue was actually addressed.\n`
                : '';
        return `Please thoroughly review the following artifact files (READ-ONLY — review them, do not modify them):
${artifactList}

${contextBlock(projectRoot)}
${prior}
Review the artifacts for: inconsistencies between artifacts, missing edge cases or error handling,
ambiguous or contradictory requirements, and violations of the project conventions. Evaluate them for
logical or semantic errors in light of the goals the artifacts themselves state, in the context of this project.

If addressing an issue would require implementation that exceeds the scope of this change, do not treat it as a
defect to fix here. Raise it as an issue whose resolution is for the proposer to RECORD it under a Non-Goals, Future
Work, or Open Questions section of proposal.md or design.md (whichever fits) — say so in its description. Reserve
this for substantive concerns, not nitpicks, and do not re-raise anything already captured in one of those sections. 

Write your findings to a NEW file named "review-findings-${round}.md" in your CURRENT WORKING DIRECTORY
(not in the project, not in the change folder). The file MUST BEGIN with the frontmatter block below — its
very first line is "---", with no title or other text before it. Use exactly this format:

---
issues-found: <integer; 0 if none>
round: ${round}
status: open
---

## Issue 1: <short title>
is-solved: false
<description, naming which artifact it appears in>

Repeat the "## Issue N" block for every issue, each starting with "is-solved: false".
If there are no issues, write "issues-found: 0" and include no issue sections.

Write each issue's description so it is specific and unambiguous — name the artifact it appears in, point to
the exact location, and explain why it is a problem — so that both the proposer agent and a human reader can
act on it without guessing. This clarity guidance applies to your prose; keep the frontmatter and the
"## Issue N" / "is-solved:" lines exactly as specified above so the harness can parse them.`;
    },
};

export const ProposerAgent: AgentConfig = {
    role: 'proposer',
    buildPrompt({ projectRoot, artifactRelPaths, round }) {
        const artifactList = artifactRelPaths.map((a) => `- ${a}`).join('\n');
        return `Please thoroughly evaluate the reviewer's findings and address every issue they raise.

Your CURRENT WORKING DIRECTORY contains writable copies of the artifacts to revise:
${artifactList}

It also contains the reviewer's findings: review-findings-${round}.md

${contextBlock(projectRoot)}

review-findings-${round}.md contains a reviewer agent's findings — design, consistency, and
correctness problems it identified in the artifacts. For each issue whose "is-solved" is false,
evaluate it and apply the fix its description calls for, editing the artifact copies in your
working directory. If you judge an issue to be invalid, you may leave it unfixed and explain why
in its resolution (below) rather than forcing a change.

Then update review-findings-${round}.md in your working directory:
- For each issue you fixed, change its "is-solved: false" to "is-solved: true".
- Under each issue add a line: "**Resolution (proposer):** <what you changed, or why you did not fix it>".
- When your pass is complete, change the frontmatter "status: open" to "status: addressed".
- Do NOT change "issues-found" — it records how many issues this review found and stays fixed even as
  you resolve them; it is not a live count of what remains. Also do not alter the reviewer's issue titles or descriptions.

When you revise the artifacts, write clearly, precisely, and consistently, so that a downstream reviewer
agent and a human reader arrive at the same unambiguous understanding. Do not sacrifice any file's required
structure for style — in particular, preserve the findings file's frontmatter and "is-solved:" lines exactly.

Only edit files inside your working directory. Do not create or modify any other files.`;
    },
};