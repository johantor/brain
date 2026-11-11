# brain

[![Validate](https://github.com/johantor/brain/actions/workflows/validate.yml/badge.svg)](https://github.com/johantor/brain/actions/workflows/validate.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Learns from every Claude Code session.** brain is a
[Claude Code](https://code.claude.com/docs/en/overview) plugin that will read each finished session,
work out what went wrong, and make the next session better, with no `/learn` step. The design is
[#3](https://github.com/johantor/brain/issues/3).

This is **phase 1, Record**. brain records the signals and learns nothing yet. No model runs, and
nothing is loaded into a session. The gate to phase 2 is two weeks of records that look right.

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

## How it works

1. Hooks on 6 events run `hooks/capture.sh`, which hands the payload to Node. Node writes rows to
   `~/.claude/brain/brain.db`, a SQLite file. Five hooks are async. `SessionEnd` runs in the
   foreground for up to 5 seconds, so its row lands before Claude Code exits. None fails a
   session: no Node, a bad payload or a locked database all exit 0. Errors go to
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
- A correction in a prompt is stored as a prompt. Telling it apart from a new request needs a
  model, which is phase 2.
- An approved call that is still running, or an identical call that runs once after two requests,
  counts as a denial until it finishes.
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
