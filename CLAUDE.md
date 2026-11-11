# brain — Claude Code notes

This repository is the `brain` Claude Code plugin: the plugin lives in `plugin/`. The `johantor`
marketplace lives in [johantor/plugins](https://github.com/johantor/plugins), and the design in
[johantor/plugins#5](https://github.com/johantor/plugins/issues/5).

**Start with [AGENTS.md](AGENTS.md)**: the contributor guide (layout, validating, releasing,
conventions). It is the single source of truth for working in this repo. This file holds how
Claude works here, then the code map. **Keep it accurate: a PR that changes anything stated here
updates this file in the same commit.**

## Communication style

Use ASD-STE-100 (Simplified Technical English) when you speak to the operator: short sentences,
the active voice, one instruction per sentence, and the same word for the same thing each time.
This applies to what you say to the operator, not to what you write into the repository.

## Engineering rules

Every change follows
[`engineering-principles`](.github/skills/engineering-principles/SKILL.md). Read it before you
write code, and re-read your diff against it before you finish. Before you open a PR or push to
one, run the `brain-review` skill on the diff and fix its Blocking and Warning findings first.

## Brevity

- **Replies**: the result first, then what the operator must decide. Under 150 words unless the
  operator asks for more.
- **Code comments**: explain *why*, in one or two lines. A longer rationale lives once, here or in
  `AGENTS.md`, and the comment points there.
- **Docs and PR bodies**: facts, not history. Before you add a paragraph, cut one.
- **Fixes**: prefer removing code to adding a parser. If a second review round finds new edge
  cases of the mechanism you already patched, stop and ask the operator: redesign, or accept the
  gap and list it in the README's *Known gaps*.

## Map

Paths in *Map* and *Gotchas* are relative to `plugin/`, the directory users install.

- `hooks/capture.sh`: the one hook, wired on 6 events in `hooks/hooks.json`, async on all but
  `SessionEnd` (synchronous, `timeout: 5`, so its row lands before the process exits;
  `capture.test.sh` asserts the split). Exits at once when `CLAUDE_CODE_REMOTE=true`. Runs
  `node --disable-warning=ExperimentalWarning lib/capture.mjs` and always exits 0.
- `lib/capture.mjs`: `record(db, payload)` writes one hook payload in one transaction: it upserts
  the session (`cwd` and `started` first seen, `last` the latest) and adds one `events` row.
  Kinds: `prompt` (scrubbed text, at most 2000 characters), `tool_ok`, `tool_fail` (`code` from
  `Exit code N`, `text` the Bash program name only), `permission`. `call` is board's hash of tool
  name and input, since PermissionRequest has no `tool_use_id`. `SessionEnd` sets `ended` and
  queues the session as `end`. `SessionStart` also runs `scan()`. Errors go to `errors.log`,
  never the payload. `umask 077`.
- `lib/scrub.mjs`: `scrub(text, names)`, ordered regex rules, then the project's names
  (`projectNames(cwd)`: the folder, the repo root, each remote's owner and repo, read from
  `.git/config` as a file through `readSmall`, no git process).
- `lib/db.mjs`: `openDb()` (WAL, `busy_timeout` 5 s, schema by `CREATE ... IF NOT EXISTS`),
  `tx()`, `prune()`. Tables: `sessions` (sid, cwd, started, last, ended, end_reason, model,
  version, tokens_in, tokens_cached, tokens_out, interrupts), `events` (sid, ts, kind, tool, call,
  code, text), `queue` (sid, reason `end`|`no-end`, ts), `transcripts` (sid, sig: mtime and size
  of each file). View `denials`: a `permission` row with no later `tool_ok`/`tool_fail` of the same
  call. Retention: records 90 days, queue 7.
- `lib/scan.mjs`: `scan(db)` reads `<config>/projects/*/<sid>.jsonl` and
  `<sid>/subagents/*.jsonl` whole, only when the signature changed, only within 90 days. Tokens
  are summed once per `message.id`; interrupts are user lines that start with
  `[Request interrupted by user`; model and version come from the main transcript. Hooks own
  `cwd` and `started`. Then queues sessions with no `ended` and silent for 12 hours (`no-end`),
  and prunes.
- `lib/report.mjs` and `commands/report.md`: `/brain:report [--days N]`, one row per project
  (by `cwd`), repeated failures by `call`, the queue.
- `lib/paths.mjs`: `brainDir()` (`CLAUDE_BRAIN_DIR`), `projectsDir()` (`CLAUDE_CONFIG_DIR`),
  `isMain()` (real paths, so a symlinked install runs its main).
- `tests/capture.test.sh`: the hook end to end, then `node --test tests/*.test.mjs`. Node 22.13+
  is required; an older one fails the suite.

## Gotchas

- `node:sqlite` is experimental in Node 22 and prints a warning; the hook and the command pass
  `--disable-warning=ExperimentalWarning`. A Node without it fails to load the module, and the
  wrapper's `|| true` keeps the session going.
- Async hooks land out of order, so no rule depends on their order except through `ts`: a
  `PostToolUse` always runs after its own `PermissionRequest` was answered, so `denials` compares
  timestamps.
- The transcript format is undocumented: every field is optional, and a line that does not parse
  is skipped. One reply is several lines that repeat `message.id` and `usage`.
- Phase 1 has no model and no `Stop` hook. The design's synchronous `UserPromptSubmit` and
  `PostToolUseFailure` arrive with phase 2's reflection, which needs them in order.
