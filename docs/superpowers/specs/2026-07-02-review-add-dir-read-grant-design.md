# csi-opsx Review Workspace Read Grant via `--add-dir` — Design

**Date:** 2026-07-02
**Status:** Draft

---

## Overview

The review harness runs each agent in a fresh, disposable temp workspace and re-grants read access
to the real project so the agent can read context in place. That read grant is currently delivered
through `permissions.additionalDirectories` in the workspace's `.claude/settings.json`
(`src/lib/runner/claude/permissions.ts:33`). Claude Code now **ignores `permissions.additionalDirectories`
from a `.claude/settings.json` in a directory that has never been trusted** — and a per-round temp
dir can never be trusted, because trust is only granted through the interactive dialog (or a manual
`~/.claude.json` edit). The reviewer is therefore sandboxed into an empty folder, can't read
anything, and exits 0 without writing `review-findings-N.md`; the harness then dies at its
missing-findings guard (`src/commands/review/harness.ts:125`).

This change moves the read grant from the settings file to the **`--add-dir <projectRoot>` CLI
flag**, which is honored regardless of trust (the operator passed it explicitly). The write
sandbox — `deny` rules on `Write`/`Edit` over the project subtree — stays in the workspace
`settings.json`, because permission-*shrinking* rules are still honored in untrusted directories.
The grant is identical in scope (`additionalDirectories` ≡ `--add-dir`, both read+write — already
recorded in `docs/superpowers/open-questions/2026-05-29-propose-harness-decisions-and-permission-findings.md:128`),
so this is a channel swap, not a semantics change.

## Problem (root cause)

The mechanism was proven working with live `claude -p` probes on 2026-05-30 (CLI 2.1.158; see the
open-questions doc §5.6). The **CLI changed underneath it**, not the csi-opsx code: on CLI 2.1.198
the same spawn prints to stderr:

> `Ignoring 1 permissions.additionalDirectories entry from .claude/settings.json: this workspace
> has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set
> projects["<workspace>"].hasTrustDialogAccepted: true in C:\Users\Raaj\.claude.json.`

and the JSON result's `permission_denials` shows the blocked `Read` of the project file. Five
probes (2026-07-02, CLI 2.1.198, temp project + temp workspace mirroring `ClaudeCliRunner` exactly)
establish the facts this design rests on:

| Probe | Setup | Result |
|---|---|---|
| A | Current mechanism: `additionalDirectories` + `deny` in workspace `settings.json`; ask sub-agent to read a project file | **Read DENIED**; stderr warning above; `permission_denials` lists the `Read` |
| B | Same, plus `--add-dir <projectRoot>` on the CLI | **Read succeeds** (file contents returned); `permission_denials` empty |
| C | Same as B; ask sub-agent to write `leak.txt` into the project | **Write blocked** ("WRITE-DENIED", no file created); `permission_denials` EMPTY |
| D | Bare untrusted workspace: no `settings.json`, no `--add-dir`; ask sub-agent to write `out.txt` in its cwd | **Write succeeds** — `acceptEdits`' in-cwd auto-accept is not trust-gated, so the reviewer can still write its findings file; the read grant was the only broken half |
| E | `--add-dir` with NO `settings.json` at all; ask sub-agent to write `leak2.txt` into the project | **Write succeeds (leak created)** — without a deny rule, `--add-dir` + `acceptEdits` auto-accepts project writes |

Probes C and E together prove the `deny` rules **still load in untrusted directories and are the
active blocker**: E shows the same write sails through when no deny rule exists, so C's block can
only be the rule firing. C's empty `permission_denials` confirms it independently — Probe A shows
would-prompt auto-denies DO get recorded there, so an empty array on a blocked write means a
pre-emptive deny-*rule* block (file state is the only ground truth, reaffirming the 2026-05-18
spec's "Testing the sandbox"). The asymmetry this reveals — settings that **expand** permissions
are trust-gated, settings that only **shrink** them still load — is what makes the fix safe, and
it is visible in the warning itself: only the `additionalDirectories` entry is called out as
ignored.

### Why no test caught it

`src/lib/runner/claude/__tests__/sandbox.integration.test.ts` pins only the **deny half** of the
sandbox contract (in-workspace write allowed, project write blocked). It never asserts the **grant
half** — that the agent can actually read `CONTEXT.md` from the project. When the read grant
vanished, writes were still blocked (even more so), so the suite stayed green while the harness was
completely broken. (Probe D confirms the other behavior the harness depends on — in-cwd writes
under `acceptEdits` — survived the CLI change, so the read grant was both the single point of
breakage and the single unpinned behavior.) A sandbox contract has two halves; this change pins
both.

## Decision

1. **`ClaudeCliRunner.run` appends `--add-dir <projectRoot>` to the spawn args** when
   `opts.projectRoot` is set. The value must be **wrapped in literal double quotes** by the runner:
   `spawnSync` with `shell: true` joins the args array into a command line *without* quoting, and
   real project paths contain spaces (`D:\Development\Personal Projects\csi-opsx`).
2. **`writePermissions` stops emitting `additionalDirectories`** and keeps only the `deny` rules.
   The entry is ignored anyway, and every spawn prints the stderr trust warning — noise in every
   round, and a dead config line that misleads future debugging.
3. **The integration test gains a read-grant probe**: the sub-agent is asked to read a
   token-bearing `CONTEXT.md` from the probe project and write its contents into a file in the
   workspace; the test asserts the workspace file exists and contains the token. File state is the
   assertion, per the established ground-truth rule. This is the regression reproduction and the
   permanent guard against the next silent CLI behavior change.

### Rejected alternatives

- **Pre-seed trust in `~/.claude.json`** (`projects["<ws>"].hasTrustDialogAccepted: true` — the
  escape hatch the warning itself names). Rejected: mutates the user's *global* config once per
  disposable workspace (two per round), leaving unbounded cruft or requiring cleanup plumbing;
  racy across concurrent runs; depends on an undocumented file format that can change like this one
  did.
- **`--dangerously-skip-permissions`.** Rejected: removes the write sandbox entirely — the proposer
  could write anywhere in the project, which the whole workspace design exists to prevent.
- **Copy project context into the workspace.** Rejected: reverses the locked "read context in
  place, no copying" architecture; the context set (`CLAUDE.md`, `openspec/`, `docs/`) is open-ended
  and large.
- **Keep `additionalDirectories` alongside `--add-dir`** "for older CLIs". Rejected: older CLIs
  honor `--add-dir` too (the flag long predates the gating), so the entry buys nothing and keeps the
  per-spawn stderr warning.

## Relationship to prior decisions (this reverses one)

The 2026-05-30 "FINAL MECHANISM" chose settings-based `additionalDirectories` as the read-grant
channel (`docs/superpowers/open-questions/2026-05-29-propose-harness-decisions-and-permission-findings.md:139`;
spec §Workspace Isolation & Write Sandbox, `docs/superpowers/specs/2026-05-18-csi-opsx-design.md:312-327`).
That decision was correct when made and verified on CLI 2.1.158; CLI-side trust gating has since
invalidated the channel. Everything else from that spike **stands**: the workspace-cwd two-way
boundary, `acceptEdits`, the MSYS `//c/...` glob form for deny rules, no Bash, file-state-only
integration assertions. Notably, the spike's own finding that `additionalDirectories` ≡ `--add-dir`
(line 128) is what guarantees the swap is behavior-preserving. The 2026-05-18 spec is the living
source of truth (precedent: it was already updated in place on 2026-05-30), so its Workspace
Isolation section is updated in place with a dated pointer to this document.

## Edge cases

- **Project path with spaces.** Handled by the runner quoting the `--add-dir` value (Decision 1).
  The unit test uses a spaced path, and the existing spaced-path integration scenario
  (`holds when the project path contains a space`) now exercises quoting end-to-end via its new
  read-grant probe.
- **`projectRoot` omitted** (`RunnerOptions.projectRoot?`). Unchanged: no `--add-dir`, no
  `settings.json` — same as today.
- **Older Claude CLI versions.** `--add-dir` predates the trust gating, so the fix works on both
  sides of the CLI change. No version detection needed.
- **The stderr trust warning.** Disappears once the ignored `additionalDirectories` entry is
  dropped — there is nothing left to warn about.
- **Future gating of `deny` rules.** Considered unlikely (they only shrink permissions), but if it
  happened, project writes would auto-accept — Probe E shows `--add-dir` + `acceptEdits` does
  exactly that when no deny rule applies — and the existing write-block integration assertions
  would go red. The suite now guards both halves of the contract.

## Files changed

| File | Change |
|---|---|
| `src/lib/runner/claude/cli.ts` | Build the args array; append `--add-dir "<projectRoot>"` (quoted) when `projectRoot` is set; update the sandbox comment. |
| `src/lib/runner/claude/permissions.ts` | Drop `additionalDirectories` from the emitted settings; keep the `deny` rules; update the header comment. |
| `src/lib/runner/claude/__tests__/cli.test.ts` | New test: `--add-dir` present with the quoted (spaced) project root; existing no-`projectRoot` exact-args test keeps guarding the flag's absence. |
| `src/lib/runner/claude/__tests__/permissions.test.ts` | Replace the `additionalDirectories` presence test with an absence test. |
| `src/lib/runner/claude/__tests__/sandbox.integration.test.ts` | Add the read-grant probe (token round-trip, file-state assertion) to `runScenario`. |
| `.claude/CLAUDE.md` | Fix the stale `writablePaths` description (three spots) and document the `--add-dir` read grant + deny-only `settings.json`. |
| `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` | Update §Workspace Isolation & Write Sandbox: read grant via `--add-dir`, deny-only `settings.json` example, quoted spawn line, dated pointer here. |

## Testing

- **RED first, at the integration boundary**: the read-grant probe fails under the current code on
  CLI 2.1.198 (`read-out.txt` never created — the sub-agent's Read is denied). This is the
  regression reproduction. *Note: the RED step requires a trust-gating CLI (observed on 2.1.198;
  the release that introduced the gating is unknown) — on an older, non-gating CLI the pre-fix
  code still passes this probe.*
- **RED first, at the unit level**: the new `cli.test.ts` assertion fails (`--add-dir` not in the
  spawn args) before the `cli.ts` change.
- **Deny-half regression check**: after dropping `additionalDirectories`, the existing write-block
  integration assertions must still pass — Probes C and E prove the deny rules load untrusted and
  are the active blocker (without them the write auto-accepts).
- Integration runs spawn real `claude -p` (cost money, minutes per scenario, auto-skipped when
  `claude` is absent) — run deliberately, not in watch mode.
- `npm run build`, `npm run typecheck`, `npm test` all green at the end.

## Out of scope (YAGNI)

- **Improving the harness's missing-findings error message** (e.g. hinting at runner sandbox
  problems). The existing exit-1 guard fired correctly and pointed at the right file; the real fix
  is upstream.
- **Runner-side CLI version detection / dual-mode grants.** `--add-dir` works on old and new CLIs.
- **Pre-seeding or managing directory trust.** Rejected above; no trust plumbing anywhere.
- **Codex/Copilot runners.** Separate queued track; the `Runner` contract is unchanged by this fix.

## Open Questions

- None blocking. (Which exact CLI release introduced the gating is unknown — the public changelog
  doesn't mention it — but immaterial, since `--add-dir` works on both sides of the change.)

## Decisions

1. **Deliver the project read grant with the `--add-dir` CLI flag** (quoted by the runner).
   *Rejected:* pre-seeding `hasTrustDialogAccepted` in `~/.claude.json` (global-config cruft, racy,
   undocumented format); `--dangerously-skip-permissions` (destroys the write sandbox); copying
   context into the workspace (reverses the in-place-read architecture).
2. **Keep the write clawback as `deny` rules in the workspace `settings.json`** — proven still
   honored in untrusted dirs *and load-bearing* (Probes C/E: without them, `--add-dir` +
   `acceptEdits` auto-accepts project writes). *Rejected:* moving the denies to `--disallowedTools`
   rule specifiers on the command line (unnecessary given Probes C/E; unverified whether its
   specifiers match path globs; and it would pull the deny patterns away from `toPermissionGlob`
   in `permissions.ts`, whose unit tests keep the platform-specific glob form honest).
3. **Drop `additionalDirectories` from `writePermissions` entirely.** *Rejected:* keeping it for
   older CLIs (buys nothing — `--add-dir` works there too — and keeps a per-spawn stderr warning
   plus a dead, misleading config line).
4. **Pin the read grant in the integration suite with a file-state token round-trip.** *Rejected:*
   unit-only/JSON-shape assertions — the exact structure-vs-behavior gap that let both the original
   non-functional sandbox (2026-05-29) and this regression slip through.
