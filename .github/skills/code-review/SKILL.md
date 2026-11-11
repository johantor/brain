---
name: code-review
description: Review a pull request or diff in the brain plugin — the Bash hook, the Node capture, scan and report, the manifest and changelog. Use when asked to review code, a PR, or a diff in this repository.
---

# Reviewing a brain change

This repo ships one Bash hook and Node modules with no dependencies. `AGENTS.md` is the
contributor guide and wins on conflict; `CLAUDE.md` is the code map and its gotchas; the plugin is
`plugin/`, and paths below are relative to it. This file is the one rubric and owns the output
format; code rules are the `engineering-principles` skill
(`.github/skills/engineering-principles/SKILL.md`). Copilot reads it directly and Claude Code's
`brain-review` skill loads it. Adapted from the board rubric (johantor/board).

## Scope: one full pass, then only what changed

- **First review: every changed hunk ends as a finding or a Passed line.** Also read what the
  diff makes newly reachable: a new table, a new event kind, a new transcript field.
- **Re-review after a push: review the new commits.** Raise an old, unchanged hunk only if it is
  Blocking. Never reopen a resolved thread with the same point reworded.
- **One root cause, one finding.** When findings share a cause, report the cause once.

## Severity: earn it with an input

- **Blocking** needs a concrete payload, transcript line or database state, and the wrong result
  it gives that the base branch did not. No input, no Blocking.
- **A known gap is not a finding.** The README's *Known gaps* and `CLAUDE.md`'s *Gotchas* are
  accepted on purpose. Flag only a change that widens one.
- **Prefer less code.** When a fix grows a parser or a special case for one edge, say so and
  suggest the smaller rule or accepting the gap in *Known gaps*.
- Style-only notes are not findings unless they break a written convention.

## The hook (`hooks/capture.sh`, `lib/capture.mjs`)

- **It never blocks or fails a session.** Every path exits 0: no Node, an old Node, bad JSON, an
  unwritable directory, a locked database. A change that can exit non-zero, hang, or run longer
  than its `timeout` is Blocking.
- **Async by default.** Only `SessionEnd`, `Stop`, `UserPromptSubmit` and `PostToolUseFailure` run
  in the foreground (`capture.test.sh` asserts it). A new foreground hook needs the reason in
  `CLAUDE.md`.
- **Reflection costs the user's tokens.** It stays off by default, asks at most 3 times a
  session, and never with `stop_hook_active`. A change that can ask more often is Blocking.
- **No fork per event.** Read files directly (`.git/config` through `readSmall`); never spawn
  `git` or a shell from the hook path.
- **Nothing in a cloud container.** `CLAUDE_CODE_REMOTE=true` exits before Node starts.

## Privacy and injection: always a pass

- **Tool output is never stored.** Not `tool_response`, not an error's text past its exit code.
  A change that stores either is Blocking: it lets a fetched page plant text a later reflection
  reads.
- **Free text is scrubbed before it is stored** (`lib/scrub.mjs`). A new text column that skips
  `scrub()` is Blocking; a new pattern needs a case in `tests/brain.test.mjs`.
- **The data stays private**: the directory 0700, files 0600 under `umask 077`. Errors go to
  `errors.log` without the payload.
- **Transcripts are untrusted and undocumented.** Every field is optional; a bad line is skipped;
  only markers and counts are read, never message text past a marker.

## The database (`lib/db.mjs`)

- **Old databases keep loading.** `CREATE ... IF NOT EXISTS` adds; a change to an existing
  table needs a migration, or existing installs break.
- **Concurrent writers.** Every write goes through `tx()`; a long transaction holds every other
  session's hook.
- **Hooks own `cwd` and `started`; the transcript owns tokens, interrupts, model and version.**
  The scan must not overwrite a hook's value.

## Release, tests, docs

- **A change under `plugin/` without a bump**: Warning; Blocking if users miss a fix.
- **A behavior change without a test** that would fail on the base code is a Warning: the hook in
  `capture.test.sh`, everything else in `tests/brain.test.mjs`.
- **`CLAUDE.md` must match the code** in the same PR, and the README's *Known gaps* must match
  what the code still does not handle.

## Verbosity is a finding

- **One rationale, one place.** The reason lives in `AGENTS.md` or `CLAUDE.md`; code comments
  explain *why* in one or two lines and point there. The same explanation in three files is a
  Warning.
- Comments that restate the code, and PR bodies over the template's budget, are nits.

## Output

`## Blocking`, `## Warnings`, `## Passed`. One bullet per finding: `path:line` — defect —
failing input — smallest fix. A Warning should be fixed but does not block merge. Under Passed,
one line per lens applied.

**Every Blocking or Warning finding is a review thread on its line.** A finding that exists only
in the summary cannot be replied to or resolved.
