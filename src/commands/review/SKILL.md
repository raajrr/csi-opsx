# csi-opsx Review

Run the automated reviewer→proposer loop on a change whose artifacts **already exist** — without
generating new artifacts. Use this to re-review or resume a change you created earlier, wrote by
hand, or one left behind by a `review` run that crashed or ran out its round budget.

## Step 1: Resolve the change name

Determine which change to review:

- If the user passed an explicit name to `/csi-opsx:review <name>`, use it.
- Otherwise, list `openspec/changes/` and ask the user which change to review.

Always ask when no name was given — do not auto-select, even if only one change exists.

## Step 2: Guard — the change must have artifacts to review

Verify the resolved change folder exists at `openspec/changes/<name>/` and contains at least one
artifact (`proposal.md`, `design.md`, `tasks.md`, or `specs/*/spec.md`).

If the folder is missing or has no artifacts, stop and tell the user — do NOT invoke the harness:

```
Nothing to review for <name> — run /csi-opsx:propose <name> first.
```

## Step 3: Check for a supported runner

**3a — Identify the current tool.**

Determine which AI tool (the CLI or IDE) is running this session — not the underlying model. For
example: Claude Code is the tool; Claude is the model. A tool like Cursor may run Claude as its
model, but the tool is Cursor.

If you cannot determine which tool is running, treat it as unsupported and proceed to 3c.

**3b — Check if the current tool is supported.**

Currently supported runners: Claude Code.

If the current tool is supported, verify its CLI is available by running the following via Bash:

```bash
claude --version
```

If the command exits with code 0, proceed to Step 4.

If the check fails:

```
⚠ csi-opsx: Claude Code CLI not found.
  Automated review loop unavailable.
  Ensure the Claude Code CLI is installed and on your PATH, then try again.
```

**3c — If the current tool is not supported (or uncertain), inform the user.**

```
⚠ csi-opsx: [current tool] is not a supported runner.
  Supported runners: Claude Code.
  Would you like me to check if a supported runner is installed on your system?
```

Wait for the user's response. If yes, proceed to 3d. If no, stop — the developer reviews the
artifacts manually.

**3d — Scan for any supported runner.**

Run each of the following shell commands in order via Bash, stopping at the first that exits with
code 0:
- Claude Code: `claude --version`

If one is found, proceed to Step 4. The harness will detect and use the available runner automatically.

If none are found:

```
⚠ csi-opsx: No supported runner detected.
  Automated review loop unavailable.
  Install a supported runner (e.g. Claude Code) to run the automated review.
```

## Step 4: Run the harness

Run via Bash (the harness enumerates the change folder itself):

```bash
csi-opsx run --command=review --workspace . --change <name>
```

If the user invoked `/csi-opsx:review` with an integer (e.g. `/csi-opsx:review <name> 3`), append
`--max-rounds=<integer>`. The integer is the number of rounds to run **this** invocation — when
resuming a change that already has `review-findings-N.md`, the harness runs that many *more* rounds
beyond the ones already completed (it is not an absolute round-number ceiling). Otherwise, omit it
(harness default is 5).

Wait for the harness to complete. Surface the exit summary to the session.