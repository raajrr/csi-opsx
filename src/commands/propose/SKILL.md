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

Compare against Step 1. Filenames that appear in the second snapshot but not in the first are the generated artifacts. Collect them as a comma-separated list of paths relative to the project root (e.g. `proposal.md,design.md,tasks.md,openspec/specs/auth.md`).

If the artifact list is empty, stop and inform the user that `/opsx:propose` did not generate any files.

## Step 4: Check for a supported runner

**4a — Identify the current tool.**

Determine which AI tool (the CLI or IDE) is running this session — not the underlying model. For example: Claude Code is the tool; Claude is the model. A tool like Cursor may run Claude as its model, but the tool is Cursor.

If you cannot determine which tool is running, treat it as unsupported and proceed to 4c.

**4b — Check if the current tool is supported.**

Currently supported runners: Claude Code.

If the current tool is supported, verify its CLI is available by running the following via Bash:

```bash
claude --version
```

If the command exits with code 0, proceed to Step 5.

If the check fails:

```
⚠ csi-opsx: Claude Code CLI not found.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Ensure the Claude Code CLI is installed and on your PATH, then try again.
```

**4c — If the current tool is not supported (or uncertain), inform the user.**

```
⚠ csi-opsx: [current tool] is not a supported runner.
  Supported runners: Claude Code.
  Would you like me to check if a supported runner is installed on your system?
```

Wait for the user's response. If yes, proceed to 4d. If no, stop — the developer reviews artifacts manually.

**4d — Scan for any supported runner.**

Run each of the following shell commands in order via Bash, stopping at the first that exits with code 0:
- Claude Code: `claude --version`

If one is found, proceed to Step 5. The harness will detect and use the available runner automatically.

If none are found:

```
⚠ csi-opsx: No supported runner detected.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Install a supported runner (e.g. Claude Code) to enable the automated review loop.
```

## Step 5: Delegate to harness

Run via Bash (replace `<artifacts>` with the comma-separated list from Step 3):

```bash
csi-opsx run --command=propose --workspace . --artifacts <artifacts>
```

Wait for the harness to complete. Surface the exit summary to the session.

