# What brain records

## Signals

| Signal | Source |
|---|---|
| Your prompts, scrubbed | `UserPromptSubmit` |
| Failing tool calls: the tool, the program a Bash call ran, the exit code | `PostToolUseFailure` |
| Denied permission dialogs: a request whose call never ran | `PermissionRequest`, `PostToolUse` |
| Which agent made a call: a subagent, or a session started with `--agent`, scrubbed | Each hook's `agent_type` |
| Session end, and sessions that went quiet for 12 hours without one | `SessionEnd`, the transcript scan |
| Token use (each reply counted once, subagents included), interrupts, model, version | The transcript scan |
| Lesson citations such as (L12), in the session and its subagents | The transcript scan |

Tool output is never stored, and prompts are scrubbed first ([SECURITY.md](../SECURITY.md)). A
queued session is dropped after 7 days, and a record after 90.

## The report

`/brain:report` prints one row per project: sessions, prompts, failures, denials, interrupts and
tokens out. It lists the calls that failed twice or more in one session. Once a subagent or an
`--agent` session made a call, it splits calls, failures and denials by agent; `(main/unknown)`
holds the main session and calls recorded without an agent. It ends with the reflections and
their cost, the lessons with their citations and repeats, and the queue. `--days <n>` changes the
window; the default is 14.

## Asking

Ask in plain words: "what keeps failing in this repo?", "where do my tokens go?", "which skills
should I create?". The `brain` skill queries the records through a read-only connection and
answers with counts and dates, then a suggestion. It reads the current project only, unless you
ask across projects. It suggests; it creates nothing.

## Hooks and the scan

1. Hooks on 7 events run `hooks/capture.sh`, which hands the payload to Node. Node writes rows to
   `~/.claude/brain/brain.db`, a SQLite file. Four hooks run in the foreground for up to 5
   seconds: `SessionEnd`, so its row lands before Claude Code exits, `Stop`, which decides on
   reflection, and `UserPromptSubmit` and `PostToolUseFailure`, so their rows land before that
   decision. A fifth, `hooks/load.sh` at `SessionStart` and `SubagentStart`, prints the lessons
   to load. None fails a session: no Node, a bad payload or a locked database all exit 0.
   Errors go to `~/.claude/brain/errors.log`.
2. At each `SessionStart`, brain reads every transcript under `~/.claude/projects` that changed
   since its last read, whole, with the subagents' transcripts. The first run reads the last 90
   days, so the records start with your history.
