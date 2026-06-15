# csi-opsx Propose

## Step 1: Run /opsx:propose behavior

Follow `/opsx:propose` behavior exactly to generate initial artifacts (proposal.md, design.md, tasks.md, and any spec files).

## Step 2: Check for a supported runner

**2a — Identify the current tool.**

Determine which AI tool (the CLI or IDE) is running this session — not the underlying model. For example: Claude Code is the tool; Claude is the model. A tool like Cursor may run Claude as its model, but the tool is Cursor.

If you cannot determine which tool is running, treat it as unsupported and proceed to 2c.

**2b — Check if the current tool is supported.**

Currently supported runners: Claude Code.

If the current tool is supported, verify its CLI is available by running the following via Bash:

```bash
claude --version
```

If the command exits with code 0, proceed to Step 3.

If the check fails:

```
⚠ csi-opsx: Claude Code CLI not found.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Ensure the Claude Code CLI is installed and on your PATH, then try again.
```

**2c — If the current tool is not supported (or uncertain), inform the user.**

```
⚠ csi-opsx: [current tool] is not a supported runner.
  Supported runners: Claude Code.
  Would you like me to check if a supported runner is installed on your system?
```

Wait for the user's response. If yes, proceed to 2d. If no, stop — the developer reviews artifacts manually.

**2d — Scan for any supported runner.**

Run each of the following shell commands in order via Bash, stopping at the first that exits with code 0:
- Claude Code: `claude --version`

If one is found, proceed to Step 3. The harness will detect and use the available runner automatically.

If none are found:

```
⚠ csi-opsx: No supported runner detected.
  Automated review loop unavailable.
  Artifacts generated via standard /opsx:propose.
  Install a supported runner (e.g. Claude Code) to enable the automated review loop.
```

## Step 3: Resolve the change name and run the harness

1. Determine the change folder name via this cascade:
    - If the user passed an explicit name to `/csi-opsx:propose <name>`, use it.
    - Else, use the change you just created/continued via `/opsx:propose` in this session.
    - Else, list `openspec/changes/` and, if more than one active change exists, ask the user which to review.
2. **Empty-guard:** if no change folder is resolved, or the resolved folder contains no
   artifacts (`proposal.md`/`design.md`/`tasks.md`/`specs/*/spec.md`), stop and tell the
   user there is nothing to review. Do NOT invoke the harness.
3. Run via Bash (the harness enumerates the change folder itself):

   ```bash
   csi-opsx run --command=propose --workspace . --change <name>
   ```

   If the user invoked `/csi-opsx:propose` with an integer (e.g. `/csi-opsx:propose 3`),
   append `--max-rounds=<integer>`. Otherwise, omit it (harness default is 5).

Wait for the harness to complete. Surface the exit summary to the session.

