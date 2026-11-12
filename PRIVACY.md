# Privacy Policy

**Effective date:** 2026-11-11

This policy covers the `brain` plugin published from this repository and distributed through the
`johantor` marketplace.

## The short version

The plugin collects nothing. It runs on your machine, there is no server behind it, no account and
no telemetry, and no data of yours reaches the maintainers.

## Data processed on your machine

The hooks write to `~/.claude/brain/brain.db` (directory mode 700, files mode 600): the session id
and working directory, your prompts with secrets, URLs, e-mail addresses, paths, host names and
project names scrubbed, the tool name, exit code and Bash program of each failing call, a hash of
each tool call's input, and timestamps. They never store tool output. At each session start the
plugin reads the transcripts under `~/.claude/projects` for token counts, interrupts, the model and
the Claude Code version. Records are deleted after 90 days. Draft lessons are stored as files in
`~/.claude/brain/lessons/`, scrubbed the same way, and each change to one is logged in
`~/.claude/brain/changes.log`. Errors go to `~/.claude/brain/errors.log`
without the hook payload.

## Data that leaves your machine

None, from the plugin. It makes no network requests, and in a Claude Code cloud session it records
nothing. With loading on (`/brain:learn on`), the lessons for the current project become part of
the session's context, so Claude Code sends them to Anthropic like the rest of that session. Claude Code itself sends your prompts to Anthropic, under
[Anthropic's Privacy Policy](https://www.anthropic.com/legal/privacy), with or without this plugin.

## Third parties

The maintainers share no data with anyone, because they receive none.

## Changes to this policy

Changes are made in this file, and its history is public in this repository's git log. A later
phase that loads lessons into sessions updates this file first.

## Contact

Questions about this policy: open an issue at <https://github.com/johantor/brain/issues>. To
report a security vulnerability, follow [SECURITY.md](SECURITY.md) instead.
