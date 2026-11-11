# Contributing to brain

`brain` is a Claude Code plugin. The plugin lives in `plugin/`, the directory the marketplace
installs, so the repo tooling around it never reaches users. The design is
[johantor/plugins#5](https://github.com/johantor/plugins/issues/5); a change that departs from it
says so in the PR. The code map and gotchas are in [CLAUDE.md](CLAUDE.md). Keep it accurate: a PR
that changes anything it states updates it in the same commit.

The review rubric, the release scripts and the shared rules are adapted from
[johantor/board](https://github.com/johantor/board). When one changes there, check whether it
applies here.

## Repository layout

- `plugin/`: the plugin: `.claude-plugin/`, `hooks/`, `lib/` and `commands/` (CLAUDE.md, *Map*).
  `README.md` and `CHANGELOG.md` stay at the root.
- `tests/`: the hook suite (`capture.test.sh`, harness in `lib.sh`), the Node suite
  (`brain.test.mjs`), and `release.test.sh` for the release scripts.
- `scripts/`: repo tooling, never part of the plugin's behaviour: `check-changelog.sh` (the
  release gate) and `release-notes.sh` (used by `auto-release.yml`). Copies of board's.
- `.github/`: `workflows/` (CI and release), `skills/` (the repo's own skills, never shipped:
  `code-review`, the one rubric Copilot reads through `copilot-instructions.md`;
  `engineering-principles`, a copy of crew's; and `writing-style`), the PR and issue templates.
  `.claude/skills/` holds thin wrappers for Claude Code (`brain-review` adds the shell steps;
  `steward` says how a session drives a PR).
- `.claude/crew.md`: the crew configuration, for developing brain with the `crew` plugin.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `PRIVACY.md`, `SECURITY.md`: copies of board's, adapted.
  `CONTRIBUTING.md` only points here.

## Validating changes

Run what CI runs (`.github/workflows/validate.yml`) before you push:

```bash
shellcheck plugin/hooks/*.sh tests/*.sh scripts/*.sh
bash tests/capture.test.sh          # hook end to end, then the Node suite
bash tests/release.test.sh          # the changelog gate and the release notes
scripts/check-changelog.sh main     # a change under plugin/ => version bump
```

Node 22.13 or later and `jq` are required.

## Releasing

One rule holds: **a change under `plugin/` bumps the version.** A tag carries everything merged
since the previous tag, so an unbumped change ships inside the next release, described nowhere.
Only `plugin/` reaches users, so only `plugin/` counts; a comment inside a shipped hook counts
too. Patch for a fix, minor for an addition, major for a break; several in a day is fine.

1. Bump `version` in `plugin/.claude-plugin/plugin.json` and add a matching `CHANGELOG.md` entry
   in the same PR. CI's `manifest` job fails unless they agree, and `check-changelog.sh` fails a
   change under `plugin/` without a bump; `tests/release.test.sh` pins it. crew and board use the
   same script.
2. Merge to `main`. `auto-release.yml` sees the version has no `v<version>` tag, and creates the
   tag and GitHub Release with that version's changelog section (`scripts/release-notes.sh`). No
   entry → it skips with a warning.
3. After the first release, and when the description changes, update brain's entry in the
   marketplace, [johantor/plugins](https://github.com/johantor/plugins).

**Changelog entries are terse.** One bullet per change under its Keep-a-Changelog heading, one
line, two at most: *what changed*, with the PR as `(#N)`. The why belongs in the PR and commit.

## Conventions

- Hooks never block a session: `capture.sh` always exits 0, and only `SessionEnd` runs
  synchronously (CLAUDE.md, *Gotchas*).
- Tool output is never stored, and free text is scrubbed before it is (README, *Privacy*).
- No runtime dependencies beyond Node's standard library.
- Code follows the `engineering-principles` skill (`.github/skills/engineering-principles/`).
- Code comments explain *why* in one or two lines; a longer rationale lives once, in `CLAUDE.md`
  or here, and the comment points to it.
- Keep diffs minimal-scope; list unrelated improvements rather than bundling them.
- **Self-review the diff before every PR and every push to one.** Use the rubric,
  `.github/skills/code-review/SKILL.md` (the `brain-review` skill runs it with the checks), and fix
  every Blocking and Warning first. Copilot reviews with the same rubric.
- PR titles follow Conventional Commits, `type(scope): summary`, with `(vX.Y.Z)` when the PR bumps.
- **PR descriptions have a hard budget**: summary 150 words and 5 bullets at most, whole body
  under 400 words. Verification is a result ("ran X, all green"), not a transcript.
- **Every review comment gets a reply, then the thread is resolved.** A correct finding is fixed
  and pushed now, whatever its label; decline only a finding that is wrong, and say why.
- One branch and PR per issue, from the latest `main`; link the issue with `Closes #N`.
- **Name the branch for what it changes**: `<type>/<issue>-<slug>`, with the Conventional
  Commits type and a slug of three to five words, such as `fix/12-scrub-azure-keys`.
- READMEs, changelogs, PR bodies and issues follow the `writing-style` skill
  (`.github/skills/writing-style/SKILL.md`).
