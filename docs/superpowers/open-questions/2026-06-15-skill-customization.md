# Skill Customization — Per-Command Skills via Explicit Naming (Session 2026-06-15)

**Status:** Decided & Implemented — changes live in the working tree, **not yet committed**.
**Decided:** 2026-06-15 (post-V1).
**Supersedes:** the earlier "per-command skill *directories* + `install.ts` rewiring" sketch — **rejected** (see §3).
**Affects:** `src/skills/`, `src/commands/explore/SKILL.md`, `src/lib/__tests__/install.test.ts`, `README.md`, and the design spec's new **Skill Customization** section.
**Why this doc exists:** to record the architecture decision behind making csi-opsx's per-phase behavior customizable with skills — and the `grill-with-docs` → `grill-me` swap that motivated it — including the alternative we considered and rejected.

---

## TL;DR

1. csi-opsx commands are now **customizable by attaching skills.** A command opts into a skill by **naming it** in a `## Skills` section in its `SKILL.md`.
2. Skills stay flat in `src/skills/<name>/` and install flat to `{toolDir}/skills/<name>/` via `installThirdPartySkills` — **unchanged**. No `install.ts`, build, or layout changes were needed.
3. We **rejected** an earlier directory-scanning design (each command owns a folder of skills; the agent loads "whatever is present"). Explicit naming is simpler and reuses Claude Code's existing by-name skill discovery.
4. The explore phase's bundled skill changed from `grill-with-docs` (relentless interview **+** a `CONTEXT.md` glossary / ADR documentation system) to plain `grill-me` (the interview only), because the doc machinery contradicted explore's own "commit no artifacts" rule.

---

## 1. Context — two threads that merged

Two ideas were on the table after V1 shipped:

- **Thread 1 — swap the explore skill.** Replace Matt Pocock's `grill-with-docs` with his plainer `grill-me`. `grill-with-docs` carried a whole documentation workflow (a `CONTEXT.md` glossary updated inline, ADRs under `docs/adr/`, plus `ADR-FORMAT.md`/`CONTEXT-FORMAT.md` support files). `grill-me` is just the relentless one-question-at-a-time interview.
- **Thread 2 — make commands customizable.** Let each command's behavior be tuned by attaching skills, so csi-opsx stays a thin wrapper and users adapt OpenSpec's phases to their taste.

The two collapsed into **one** idea: explore's grilling is simply *an instance* of "attach a skill to a command." `grill-me` stops being special-cased; it is the default skill the explore command happens to name. Any command can name any bundled skill.

---

## 2. Decision — explicit naming over directory-scanning

**The convention:**

- Skills live flat in `src/skills/<name>/`, are bundled into the package, and install flat to `{toolDir}/skills/<name>/` (this is what `installThirdPartySkills` already does).
- A command opts into a skill by **naming it** in a `## Skills` section in `src/commands/<command>/SKILL.md`.
- At run time the agent loads the named skill on demand via its Skill tool.

**Why this needs no new plumbing.** Claude Code discovers an installed skill by its `SKILL.md` frontmatter (`name`/`description`) and can invoke it by name. A command's `SKILL.md` is both installed as that command's skill *and* baked into the generated slash-command file (`installCommands` reads it through the adapter), so the named reference travels with the command. Flat install + named reference is therefore a **complete** loading path — the existing build and install steps already deliver everything required.

---

## 3. Rejected alternative — directory-scanning

An earlier sketch (recorded in session memory before this decision) had each command own a **directory** of skills, with the `SKILL.md` saying roughly *"load and follow any skills present in this command's directory."* That implied:

- new `install.ts` / build-layout logic to place skills under a per-command location rather than flat;
- a runtime discovery step where the agent scans that directory and loads whatever it finds.

**Rejected.** It adds install/layout machinery *and* runtime directory-discovery for **zero capability gain** over simply naming the skill. Explicit naming reuses the existing flat install and Claude Code's by-name discovery untouched.

> Note: a prior session's memory claimed "the real work here is `install.ts` wiring." That was an artifact of *this* directory-scanning sketch — not of the chosen design. The memory has been corrected.

**Trade-off accepted.** Adding a skill to a command is **two** steps (drop it in `src/skills/`, then name it in the command's `## Skills` section) rather than one (drop it in a per-command folder). More explicit, and far simpler to build and maintain. For an expected ~1 skill per command, the extra step is negligible.

---

## 4. Scope & limits

- Only `/csi-opsx:explore` ships a skill today — `grill-me`. `apply` and `archive` stay bare passthroughs; we deliberately do **not** add an empty `## Skills` section until a command actually has a skill to register (no placeholder clutter). `propose` is excluded entirely: its reviewer→proposer loop *is* its behavior.
- **No per-session selective activation.** To disable a skill, remove it from the command's `## Skills` list (or from `src/skills/`). Acceptable for a minimalist wrapper expecting roughly one skill per command.

---

## 5. `grill-with-docs` → `grill-me`

The explore phase originally bundled `grill-with-docs`: the relentless interview **plus** a documentation system that wrote a `CONTEXT.md` glossary inline and created ADRs for hard-to-reverse decisions. It was replaced by `grill-me` (the interview only) for two reasons:

1. **It contradicted explore's own rule.** `explore/SKILL.md` says "do not commit any artifacts during this session," yet `grill-with-docs` (and the old Outputs section) had it writing `CONTEXT.md` and ADRs. Plain `grill-me` resolves the contradiction — explore is now purely conversational and commits nothing.
2. **It imposed a workflow the phase didn't need.** The glossary/ADR machinery is opinionated; the explore phase only needs the grilling.

`grill-me` source: <https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me> (note: `productivity/`, not the `engineering/` path `grill-with-docs` lived under).

---

## 6. What changed (file by file)

| File | Change |
|------|--------|
| `src/skills/grill-with-docs/` → `src/skills/grill-me/` | Renamed. Deleted `ADR-FORMAT.md` + `CONTEXT-FORMAT.md`. `SKILL.md` replaced with Matt Pocock's plain `grill-me` + an attribution line. |
| `src/commands/explore/SKILL.md` | Rewrote: dropped the "Combines… both active simultaneously" intro, the inline "fallback grilling" block, and the `Outputs` section; added a `## Skills` section naming `grill-me`. |
| `src/lib/__tests__/install.test.ts` | Updated the third-party-skill test to `grill-me` with a single `SKILL.md`; removed the now-unused `GRILL_ADR`/`GRILL_CONTEXT` constants; fixed stale comments. |
| `src/lib/install.ts` | Updated the example-path comments (`grill-with-docs` → `grill-me`). Logic unchanged. |
| `README.md` | Added the "Customising a command's behaviour with skills" section documenting the convention. |
| `docs/superpowers/specs/2026-05-18-csi-opsx-design.md` | Added the **Skill Customization** section; fixed five stale `grill-with-docs` references (Goals, Package Structure, `onSuccess` note, the `/csi-opsx:explore` behavior, Extensibility). |
| **No change** | `installThirdPartySkills` logic, `tsup.config.ts`, the build, and the `propose` harness. That is the whole point of the explicit-naming decision. |

---

## 7. Verification & status

- **The build does not fully prune removed/renamed skills** (verified, not assumed). After the rename, `npm run build` left an **empty** `dist/skills/grill-with-docs/` directory: `tsup`'s `clean` cleared its *files* but not the folder shell, and the `onSuccess` skill-copy is purely *additive* (it copies `src/skills/*` in, never removes what's gone). No stale skill *content* ships — an empty dir has no `SKILL.md`, so Claude Code can't discover a phantom skill — but `installThirdPartySkills` would still `mkdirSync` an empty `grill-with-docs/` into an install. The empty dir was deleted manually for this change. **Follow-up:** make `onSuccess` authoritative — `rmSync('dist/skills', { recursive, force })` before the copy loop — so `dist/skills/` mirrors `src/skills/` exactly on every build.
- The unused `GRILL_*` constants would *not* have failed `tsc` (`tsconfig` enables `strict` but not `noUnusedLocals`); they were removed as dead code regardless.
- **Pending:** a full `npm run typecheck && npm test && npm run build` pass to confirm the rename is green end-to-end, and a commit (nothing is committed yet).

---

## 8. Cross-references

- Design spec — **Skill Customization** section: `docs/superpowers/specs/2026-05-18-csi-opsx-design.md`.
- User-facing docs — README, "Customising a command's behaviour with skills".
- The skill install/discovery mechanics live in `src/lib/install.ts` (`installSkills`, `installCommands`, `installThirdPartySkills`) and `tsup.config.ts` (`onSuccess` skill copy).
