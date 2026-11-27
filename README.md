# brain

[![Validate](https://github.com/johantor/brain/actions/workflows/validate.yml/badge.svg)](https://github.com/johantor/brain/actions/workflows/validate.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Learns from every Claude Code session.** brain is a
[Claude Code](https://code.claude.com/docs/en/overview) plugin. It records each session on your
machine, learns from your corrections, and loads what it learned into the next session, with no
`/learn` step. The design is [#3](https://github.com/johantor/brain/issues/3).

```bash
claude plugin marketplace add johantor/plugins
claude plugin install brain@johantor
```

Site: <https://johantor.github.io/brain/>

## How it works

1. **It records.** Hooks write your prompts (scrubbed), failed calls, denied permissions and token
   use to a local SQLite file. Tool output is never stored.
2. **It reflects.** After you correct Claude ("no, …", "wrong"), press Esc and say something else,
   or deny a permission, the next clean stop asks Claude to draft at most two lessons from your
   own words.
3. **It loads.** Each session and each subagent starts with the project's lessons, then the global
   ones. Claude cites a lesson as (L12) when it changes what Claude does.
4. **You decide.** `/brain:lessons` shows how often each lesson was cited and how often its
   mistake happened again, and asks you to keep, pin or forget it.

Learning is on from install. `/brain:learn off` stops the drafting and the loading; the records
continue. Details: [docs/learning.md](docs/learning.md) and [docs/records.md](docs/records.md).

## Commands

| Command | What it does |
|---|---|
| `/brain:report [--days N]` | Sessions, failures, denials and tokens per project and per agent, and lesson evidence. |
| `/brain:lessons` | Review each lesson with its evidence: keep, pin, forget, or promote one to its plugin. |
| `/brain:forget L12` | Stop a lesson for good. `S<n>` removes a brain skill. |
| `/brain:undo` | Reverse brain's latest change to a lesson. |
| `/brain:learn on\|off` | Turn learning on or off. |
| `/brain:promote [<plugin>@<marketplace> on\|off]` | List or change the plugins Promote may draft issues for. |

You can also ask in plain words: "what keeps failing in this repo?", "where do my tokens go?",
"what should go in my global CLAUDE.md?". The `brain` skill answers from the records, read-only.

## Privacy

brain keeps your records on your machine and sends nothing anywhere. It scrubs secrets, URLs,
paths and project names before it stores a prompt, and it never stores tool output. Details:
[SECURITY.md](SECURITY.md).

## Requirements

- [Claude Code](https://code.claude.com/docs/en/overview) with plugin support.
- Node.js 22.13 or later on the `PATH` that Claude Code's hooks see, for `node:sqlite`. With an
  older Node, the hooks do nothing.
- On Windows, Git for Windows, so that `capture.sh` runs in Git Bash.

`CLAUDE_BRAIN_DIR` (default `~/.claude/brain`) sets where the records live, and
`CLAUDE_CONFIG_DIR` (default `~/.claude`) where the transcripts are read from. Uninstalling leaves
`~/.claude/brain`; delete it to remove the records.

## Known gaps

- The scrubber works from pattern lists. A secret in an unknown format, a host under an unlisted
  top-level domain, or a client name that is not the folder, repo or remote name stays in the text.
  A path is scrubbed from two segments up: `/client` alone stays, since it looks like a slash
  command. A path with a space keeps the part after the space.
- A correction is spotted by its first words ("no", "wrong", "actually") or by an Esc before it.
  One worded otherwise after a turn that finished starts no reflection. "no worries", or a message
  sent while Claude is still working, can start one that drafts nothing.
- An approved call that is still running, or an identical call that runs once after two requests,
  counts as a denial until it finishes.
- `brain propose` cannot prove that a lesson's words came from you and not from a page Claude
  read. It blocks the forms an injected rule takes (scripts, URLs, paths, commands with
  arguments), and the line at each session start lists new lessons.
- brain does not prove that a lesson helps. A lesson that prevents a mistake without a citation
  shows nothing, and a repeat is found only after a correction or a denied call. A citation by a
  subagent that made no tool call reads as `subagent`, without its name.
- Promote finds a plugin's repository only for an installed plugin: one loaded with
  `--plugin-dir` never gets Promote.
- Lessons are grouped into a skill by the tool they name, not by subject. brain does not rewrite a
  skill that does not trigger; it retires it after 30 days.
- The transcript format is not documented. A Claude Code update can break the scan; the hooks keep
  working.
- Node prints that `node:sqlite` is experimental. The hook hides the warning; the API could
  still change in a later Node.

## Documentation

- [docs/learning.md](docs/learning.md): reflection, loading, reviewing lessons, brain skills.
- [docs/records.md](docs/records.md): what is recorded, the report, the hooks and the scan.
- [AGENTS.md](AGENTS.md): contributing, validating and releasing.
- [SECURITY.md](SECURITY.md): how brain protects your data, and how to report a vulnerability.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [board](https://github.com/johantor/board): every Claude Code session on one local board.

## License

[Apache-2.0](LICENSE). The plugin collects no data and sends nothing to the maintainers; see
[PRIVACY.md](PRIVACY.md). An independent project, not affiliated with or endorsed by Anthropic.
