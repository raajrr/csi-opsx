# csi-opsx Propose

## Step 1: Snapshot git status

Before running the propose step, record the current git status:

```bash
git status --porcelain
```

Store this output for comparison in Step 3.

## Step 2: Run /opsx:propose behavior

Follow `/opsx:propose` behavior exactly to generate initial artifacts (proposal.md, design.md, tasks.md, and any spec files).

## Step 3: Identify generated artifacts

After the propose step completes, snapshot git status again:

```bash
git status --porcelain
```

Compare against Step 1. Lines that appear in the second snapshot but not the first are the generated artifacts. Collect the filenames from those lines as a comma-separated list of paths relative to the project root (e.g. `proposal.md,design.md,tasks.md,openspec/specs/auth.md`).

## Step 4: Check for Claude Code CLI

Run:

```bash
claude --version
```

If this command succeeds (exit code 0), proceed to Step 5.

If it fails, print the following and stop — the developer reviews artifacts manually:

```
⚠ csi-opsx: Claude Code not detected.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Install Claude Code to enable the automated review loop.
```

## Step 5: Delegate to harness

Run via Bash (replace `<artifacts>` with the comma-separated list from Step 3):

```bash
csi-opsx run --command=propose --workspace . --artifacts <artifacts>
```

Wait for the harness to complete. Surface the exit summary to the session.