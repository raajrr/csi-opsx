# csi-opsx

A CLI wrapper around [OpenSpec](https://github.com/Fission-AI/OpenSpec) that adds an
automated **reviewer → proposer loop** to the spec-writing phase. You write a change
proposal; csi-opsx repeatedly has an AI agent review the artifacts and a second agent
address the findings — in isolated, sandboxed workspaces — until the review comes back
clean (or a round limit is hit).

## What it does

- `explore`, `apply`, `archive` — thin passthroughs to OpenSpec behaviour.
- `propose` — the harnessed command. It runs an AI reviewer against your change
  artifacts (`proposal.md`, `design.md`, `tasks.md`, `specs/*/spec.md`), feeds the
  findings to an AI proposer that revises the artifacts, and re-reviews — looping until
  the reviewer reports zero issues or `--max-rounds` is reached. Each agent runs in a
  temporary workspace where the project is read-only and only the change artifacts are
  writable, so a run can never corrupt your project.

## Prerequisites

- **Node.js 20.19+** (required by the bundled OpenSpec).
- **A supported AI runner** for the propose loop — currently **Claude Code** (`claude`
  on your `PATH`). Without it, `propose` still generates artifacts via OpenSpec, but the
  automated review loop is skipped.

OpenSpec itself is **bundled** — csi-opsx ships and runs its own pinned copy of the
[`@fission-ai/openspec`](https://github.com/Fission-AI/OpenSpec) CLI, so there's no
separate global install to manage. To move to a newer OpenSpec, bump csi-opsx.

## Install

csi-opsx isn't published to npm yet. Install it from a clone:

```bash
git clone https://github.com/raajrr/csi-opsx.git
cd csi-opsx
npm install
npm run build
npm link          # puts `csi-opsx` on your PATH
```

Verify:

```bash
csi-opsx --version
```

## Setup

From the root of a project you want to use csi-opsx in:

```bash
csi-opsx init
```

This runs `openspec init` (which prompts you to pick your AI tool) and then installs the
csi-opsx skills and slash commands for the detected agent. For Claude Code, the commands
become available as `/csi-opsx:explore`, `/csi-opsx:propose`, `/csi-opsx:apply`, and
`/csi-opsx:archive`.

If you upgrade csi-opsx later, re-sync the installed skills with:

```bash
csi-opsx update
```

## Usage

Inside your AI tool, drive the workflow with the slash commands. The headline one:

```
/csi-opsx:propose <change-name>
```

This generates the change artifacts (via OpenSpec's propose behaviour) and then runs the
automated review loop over `openspec/changes/<change-name>/`. Pass an integer to cap the
rounds, e.g. `/csi-opsx:propose <change-name> 3` (the default is 5).

When the loop finishes it prints a summary: the number of rounds, the issue count per
round (the convergence trace), and whether it converged or hit the round limit. The
revised artifacts and the `review-findings-N.md` files are left in your change folder for
inspection.

## Commands

| Command | Purpose |
|---|---|
| `csi-opsx init` | Run `openspec init` and install csi-opsx skills/commands. |
| `csi-opsx update` | Re-run `openspec update` and reinstall csi-opsx skills. |
| `csi-opsx run` | Internal — invoked by the propose skill to drive the harness. Not meant to be run by hand. |

The user-facing surface is the slash commands installed by `init`, not the CLI directly.

## Development

```bash
npm run build       # compile src/ -> dist/ via tsup
npm run dev         # watch-mode build
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:watch  # vitest watch mode
```

The test suite includes integration tests that spawn the real `claude` CLI; those are
automatically skipped when `claude` isn't installed.
