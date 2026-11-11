# brain

[![Validate](https://github.com/johantor/brain/actions/workflows/validate.yml/badge.svg)](https://github.com/johantor/brain/actions/workflows/validate.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Learns from every Claude Code session.** brain is a
[Claude Code](https://code.claude.com/docs/en/overview) plugin that will read each finished session,
work out what went wrong, and make the next session better, with no `/learn` step. The design is
[#3](https://github.com/johantor/brain/issues/3).

brain records the signals, answers questions about them, drafts lessons in shadow mode, and can
load them into each session. Both start off. Phase 3
([#5](https://github.com/johantor/brain/issues/5)) adds vetoes, scoring and retirement.

```bash
claude plugin marketplace add johantor/plugins
claude plugin install brain@johantor
```

## What it records

| Signal | Source |
|---|---|
| Your prompts, scrubbed | `UserPromptSubmit` |
| Failing tool calls: the tool, the program a Bash call ran, the exit code | `PostToolUseFailure` |
| Denied permission dialogs: a request whose call never ran | `PermissionRequest`, `PostToolUse` |
| Session end, and sessions that went quiet for 12 hours without one | `SessionEnd`, the transcript scan |
| Token use (each reply counted once, subagents included), interrupts, model, version | The transcript scan |

Tool output is never stored, not even an error's text past its exit code. A fetched page therefore
cannot plant text that a later reflection reads.

Ended sessions go into a queue for phase 2's reflection. An entry is dropped after 7 days, and a
record after 90.

## Quick start

Use Claude Code as usual. After a few sessions, run:

```
/brain:report
```

It prints one row per project (sessions, prompts, failures, denials, interrupts, tokens out),
the calls that failed twice or more in one session, and the queue. `--days <n>` changes the
window; the default is 14.

## Asking about your sessions

Ask in plain words: "what keeps failing in this repo?", "where do my tokens go?", "which skills
should I create?". The `brain` skill queries the records through a read-only connection and
answers with counts and dates, then a suggestion. It reads the current project only, unless you
ask across projects. It suggests; it creates nothing.

## Shadow reflection

```
/brain:shadow on
```

With reflection on, brain watches for friction: a failing call, a denied permission, or a prompt
that pushes back ("no, …", "wrong", "undo"). At the first turn after it that ends clean, the Stop
hook asks Claude to reflect: the `reflect` skill drafts at most two lessons from your own words and
hands them to `brain propose`, which scrubs them, checks them and stores them as drafts. Nothing
loads into a session. Ask "which lessons did brain draft?" to see them.

It costs tokens in the session that reflects: at most 3 reflections per session, and
`/brain:report` shows the average cost. It starts off for that reason. `/brain:shadow off` stops it.

## Loading lessons

```
/brain:learn on
```

From the next session on, each session starts with this project's lessons, then the global ones,
newest first, up to about 1,000 tokens. They are background: your `CLAUDE.md` and your messages
win, and Claude cites a lesson's ID, such as (L12), when one changes what it does.
`~/.claude/brain/learned.md` lists the global lessons; the `brain` skill lists all of them.
`/brain:learn off` stops loading.

You stay in charge of every lesson:

| To | Do |
|---|---|
| Stop a lesson for good | `/brain:forget L12`, say "forget that lesson", or delete its line in `learned.md` |
| Keep a lesson, loaded first | `/brain:pin L12`, or edit its line in `learned.md` to your wording |
| Reverse brain's latest change | `/brain:undo` |

Each lesson you have not pinned sits out about 30% of the sessions it would load in. brain
compares how often things go wrong with and without it: from 10 sessions on each side, a lesson
that cuts failures, denials and corrections by a fifth is marked confirmed. Ask "which lessons
help?" to see the scores.

A session starts with one line that lists what changed since the last one. Every change is also
in `~/.claude/brain/changes.log`.

## How it works

1. Hooks on 7 events run `hooks/capture.sh`, which hands the payload to Node. Node writes rows to
   `~/.claude/brain/brain.db`, a SQLite file. Four hooks run in the foreground for up to 5
   seconds: `SessionEnd`, so its row lands before Claude Code exits, `Stop`, which decides on
   reflection, and `UserPromptSubmit` and `PostToolUseFailure`, so their rows land before that
   decision. A fifth, `hooks/load.sh` at `SessionStart`, prints the lessons to load. None fails
   a session: no Node, a bad payload or a locked database all exit 0. Errors go to
   `~/.claude/brain/errors.log`.
2. At each `SessionStart`, brain reads every transcript under `~/.claude/projects` that changed
   since its last read, whole, with the subagents' transcripts. The first run reads the last 90
   days, so the records start with your history.

## Privacy

Prompts can hold client code and secrets. brain keeps them on your machine and sends nothing
anywhere.

- **Scrubbed before storage.** Secrets (common token formats, private keys, `password=` and
  similar pairs), URLs, e-mail addresses, absolute paths, IP addresses, host names, and the
  project's folder, repo and remote names become placeholders such as `<path>`.
- **Yours alone.** `~/.claude/brain` is mode 700, and its files 600.
- **Nothing in the cloud.** In a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`), the hooks
  exit at once. The container is thrown away, so its records would be lost anyway.
- **What stays raw:** each session's working directory, so the report can name the project.

## Requirements

- [Claude Code](https://code.claude.com/docs/en/overview) with plugin support.
- Node.js 22.13 or later on the `PATH` that Claude Code's hooks see, for `node:sqlite`. No
  packages to install. With an older Node, the hooks do nothing.
- On Windows, Git for Windows, so that `capture.sh` runs in Git Bash.

| Setting | Default | Effect |
|---|---|---|
| `CLAUDE_BRAIN_DIR` | `~/.claude/brain` | Where `brain.db` and `errors.log` live. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where the transcripts are read from. |

Uninstalling leaves `~/.claude/brain`. Delete it to remove the records.

## Known gaps

- The scrubber works from pattern lists. A secret in an unknown format, a host under an unlisted
  top-level domain, or a client name that is not the folder, repo or remote name stays in the text.
- A path is scrubbed from two segments up: `/client` alone stays, since it looks like a slash
  command. A path with a space keeps the part after the space.
- A correction is spotted by its first words ("no", "wrong", "actually"). A correction worded
  otherwise starts no reflection, and "no worries" starts one that drafts nothing.
- An approved call that is still running, or an identical call that runs once after two requests,
  counts as a denial until it finishes.
- `brain propose` cannot prove that a lesson's words came from you and not from a page Claude
  read. It blocks the forms an injected rule takes (scripts, URLs, paths, commands with
  arguments), stores no other text from the session, and keeps every lesson a draft until phase 3.
- Holdout compares all friction in a session, not the friction a lesson is about, so a lesson
  that helps rarely needs many sessions before its score moves.
- The transcript format is not documented. A Claude Code update can break the scan; the hooks keep
  working.
- Node prints that `node:sqlite` is experimental. The hook hides the warning; the API could
  still change in a later Node.

## Documentation

- [AGENTS.md](AGENTS.md): contributing, validating and releasing.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [SECURITY.md](SECURITY.md): reporting a vulnerability.
- [board](https://github.com/johantor/board): every Claude Code session on one local board.

## License

[Apache-2.0](LICENSE). The plugin collects no data and sends nothing to the maintainers; see
[PRIVACY.md](PRIVACY.md). An independent project, not affiliated with or endorsed by Anthropic.
