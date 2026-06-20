# csi-opsx Propose

## Propose Behavior

Follow `/opsx:propose` behavior exactly to generate the initial artifacts
(`proposal.md`, `design.md`, `tasks.md`, and any spec files).

## Skills
Load and follow these skills if relevant to the work:

## Session End

When the artifacts are generated, surface the change name you just created
(you already know it from the `/opsx:propose` run — no lookup needed) and
suggest the review step:

> "Artifacts generated for `<name>`. Ready to review? Run
> `/csi-opsx:review <name>` to run the automated reviewer→proposer loop —
> optionally cap the rounds with a trailing number, e.g. `/csi-opsx:review <name> 3` (default 5)."