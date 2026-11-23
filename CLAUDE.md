# brain — Claude Code notes

This repository is the `brain` Claude Code plugin: the plugin lives in `plugin/`. The `johantor`
marketplace lives in [johantor/plugins](https://github.com/johantor/plugins), and the design in
[#3](https://github.com/johantor/brain/issues/3).

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

## Developing with crew

The repo carries a crew configuration in [.claude/crew.md](.claude/crew.md), so `/crew:feature`
and `claude --agent crew:lead` work here: `lead` plans and delegates each step to a worker
subagent that edits files in this working tree. It is ordinary in-repo development, not remote
execution. With the crew hooks loaded, reads and writes go through `Read`, `Edit` and `Write`,
not the shell, and nothing is pushed until the operator runs `/crew:pr`.

## Map

Paths in *Map* and *Gotchas* are relative to `plugin/`, the directory users install.

- `hooks/capture.sh`: the one hook, wired on 7 events in `hooks/hooks.json`. Synchronous with
  `timeout: 5`: `SessionEnd` (its row lands before the process exits), `Stop` (it decides on
  reflection), `UserPromptSubmit` and `PostToolUseFailure` (their rows land before their turn's
  `Stop`). The rest are async; `capture.test.sh` asserts the split. Exits at once when
  `CLAUDE_CODE_REMOTE=true`. Runs `node --disable-warning=ExperimentalWarning lib/capture.mjs`
  and always exits 0.
- `hooks/load.sh` and `lib/load.mjs`: a second `SessionStart` hook, and the `SubagentStart`
  hook, in the foreground (`timeout: 5`), apart from the async capture, whose scan can take long.
  A subagent never sees the session's context, so each one gets the lessons again. With `learn`
  on it opens `brain.db` read-only, prints the project's lessons, then global ones, newest first, non-
  `deprecated`, pinned (`stable`) first, within `BUDGET` (4,000 characters) as
  `additionalContext`, plus, at `SessionStart` only, a `systemMessage` for the user listing
  `changes` since the `.noticed` file's mtime, after a one-time welcome line (`.welcomed`) that
  says brain is on.
  Prints nothing when off or on any error, which goes to `errors.log`.
- `lib/retire.mjs`: `retireIdle()` (async `SessionStart`, with `learn` on) archives a project
  lesson whose project has had no session for `IDLE_DAYS` (90): `deprecated`, `retired` in the
  file and an `archived` change; pinned lessons never, and each lesson is reread inside its
  transaction. Nothing scores lessons: holdout judged noise (README, *Known gaps*), so every
  lesson loads.
- `lib/skills.mjs`, `skills/distill/SKILL.md`: `clusters()` groups live global lessons by the
  tools their code spans name; `MIN_LESSONS` (3) make a cluster. At a clean `Stop` with no
  friction, `reflect.decide()` asks for `brain:distill` on the first of `waitingClusters()` (no
  live skill covers it; at most `MAX_SKILLS`, 5) not asked about in 7 days. `propose()` takes
  the draft's `tool`, and inside one transaction checks the cluster, the name, and the text like a
  global lesson (scrubbed with the project's names, no placeholders, code spans of a tool and
  flags only, no script names; a description of at most 200 characters, a prose body with no
  frontmatter or tool settings), writes brain's own frontmatter and stages it under
  `<brain dir>/skills/` as `pending`, with its source lesson ids. `lifecycle()` (async
  `SessionStart`, with `learn` on) installs a pending skill in `<config>/skills/brain-<name>/`
  after `VETO_DAYS` (3), unless a source lesson is now `deprecated` (then it retires it), and
  retires an active one with no `Skill` call for `UNUSED_DAYS` (30). An install that fails to log
  removes its folder again. brain removes only an active skill's folder whose `SKILL.md` names
  it. Skill changes are `changes` rows with lesson 0, which undo skips; `/brain:forget S<n>`
  retires one. `capture.mjs` keeps the scrubbed skill name of a `Skill`
  call. `lifecycle()` rereads each row inside its transaction.
- `lib/memory.mjs`: reads every `<config>/projects/*/memory/MEMORY.md` (one entry per line;
  list markers and links dropped, case and punctuation ignored) and prints the entries found in
  2+ projects that `~/.claude/CLAUDE.md` does not hold yet. Writes nothing (#2). The `brain`
  skill runs it.
- `lib/manage.mjs` and `commands/lessons.md`, `forget.md`, `undo.md`: forget sets `deprecated`
  (`retired: "vetoed"` in the file; the key still blocks re-learning), pin sets `stable` with
  `verified: human:local`, undo restores the `before` of the latest `changes` row not undone (a
  proposal undoes to a veto) and marks its own row undone; forget and pin take several ids.
  `list` prints each live lesson with its `cite` and `repeat` counts and `suggest()`'s choice;
  `/brain:lessons` asks the user per lesson and applies it (there is no pin command). `repeat`
  adds a `repeat` event (lesson id in `code`), which the reflect skill runs when a loaded lesson
  covers the friction; it refuses a lesson created after the session started. `writeLearned()` writes `learned.md`,
  a read-only view of the global lessons; with `learn` on, the async `SessionStart` capture runs
  it before its scan. Hand edits are overwritten: they would race between sessions and skip the
  checks `propose.mjs` makes (#14).
- `lib/capture.mjs`: `record(db, payload)` writes one hook payload in one transaction: it upserts
  the session (`cwd` and `started` first seen, `last` the latest) and adds one `events` row.
  Each row keeps `agent`, the payload's `agent_type` scrubbed like a skill name (null in
  the main session, before 0.13.0, or when scrubbed away), so friction splits by agent. A
  payload with both keeps its `agent_id` (`agentId()`: no `agent-` prefix) and type in `agents`.
  Kinds: `prompt` (scrubbed text, at most 2000 characters), `tool_ok`, `tool_fail` (`code` from
  `Exit code N`, `text` the Bash program name only, scrubbed), `permission` (not for
  `AskUserQuestion`: a question is not a permission). Any new activity
  drops the session's `no-end` queue entry. `call` is board's hash of tool
  name and input, since PermissionRequest has no `tool_use_id`. `SessionEnd` sets `ended` and
  queues the session as `end`. `SessionStart` also runs `scan()`. Errors go to `errors.log`,
  never the payload.
- `lib/scrub.mjs`: `scrub(text, names)`, ordered regex rules, then the project's names
  (`projectNames(cwd)`: the folder, the repo root, each remote's owner and repo, read from
  `.git/config` as a file through `readSmall`, no git process; a worktree's `.git` file is
  followed through `commondir` to the shared config). Paths need two segments.
- `lib/db.mjs`: `openDb()` (`umask 077`, chmods an existing directory to 700 and database to
  600, WAL, `busy_timeout` `BUSY_MS` (2 s, under the hooks' 5 s timeout), schema by `CREATE ... IF NOT EXISTS`),
  `tx()`, `prune()`. Tables: `sessions` (sid, cwd, started, last, ended, end_reason, model,
  version, tokens_in, tokens_cached, tokens_out, interrupts), `events` (sid, ts, kind, tool, call,
  code, text, agent: added by `ALTER TABLE` to a database from before 0.13.0, which also replaces `denials`), `queue` (sid, reason `end`|`no-end`, ts), `transcripts` (sid, sig: mtime and size
  of each file), `agents` (sid, id, type: pruned with its session), `lessons` (id, key, description, kind, scope, project, status, created: an index
  of the lesson files), `changes` (id, ts, lesson, action, before as JSON, undone), `skills` (id, name, tool,
  description, body, status, created, activated, lessons). Databases from 0.8.0 to 0.10.x also
  hold a `scores` table and a `lessons.model` column, both unused. View `denials`: a
  `permission` row with no later `tool_ok`/`tool_fail` of the same call by the same agent. Retention: records 90 days, queue 7.
- `lib/scan.mjs`: `scan(db)` reads `<config>/projects/*/<sid>.jsonl` and
  `<sid>/subagents/*.jsonl` whole, only when the signature changed, only within 90 days. Tokens
  are summed once per `message.id`; interrupts are user lines that start with
  `[Request interrupted by user`; each `(L<n>)` in assistant text is one `cite` event per reply
  and lesson (`code` the id, `text` `main`, the subagent's type from `agents` by the file's
  `agent-<id>` name, or `subagent` when no hook named it), replaced on each reread (`SIG`'s
  prefix is bumped when the scan reads something new, so an upgrade rereads once); model and version come from the main transcript. Hooks own
  `cwd` and `started`. Then queues sessions with no `ended` and silent for 12 hours (`no-end`),
  and prunes.
- `lib/report.mjs` and `commands/report.md`: `/brain:report [--days N]`, one row per project
  (by `cwd`), event counts and repeated failures within the window, calls, failures and denials
  by agent once a named agent made a call, interrupts and tokens as
  whole-session totals, lessons with citations and repeats, the queue.
- `lib/ask.mjs` and `skills/brain/SKILL.md`: the `brain` skill runs one `SELECT`/`WITH` per call
  on a `readOnly` connection and prints tab-separated rows (at most 200, cells clipped). Temp
  views `my_sessions`, `my_events`, `my_denials`, `my_queue` hold the project of `--cwd`
  (`projectRoot()`: the nearest `.git`, else the folder) and its subfolders, and `my_lessons` the
  global lessons plus that project's; `--all` uses the base tables. The scope steers answers;
  it is not a boundary, since every row is the user's own.
- `lib/lessons.mjs`: one OKF v0.2 file per lesson, `lessons/L<id>.md`, the source of truth;
  frontmatter values are JSON (valid YAML), so `parse()` needs no YAML parser. The body holds no
  session text. `lessons/index.md` carries `okf_version` and lists every lesson. A lesson file is
  hard-linked into place, so an existing one is never replaced; `maxFileId()` keeps a lost
  database from reusing a number. `logChange()` appends to `changes.log`.
- `lib/propose.mjs`: `brain propose` takes one JSON candidate (`description`, `kind`, `sessions`)
  on stdin. `check()` scrubs it and decides: a secret, e-mail or IP rejects in any scope; a global
  lesson with a version, URL, path, host or script name is rejected, one that names the project
  becomes a project lesson, and its code spans may hold only a tool and flags. `store()` needs
  every session in the records and in the proposing project, and refuses a repeat (`key`: scope,
  project and normalized text, checked inside the write transaction). It writes a `draft`.
- `lib/reflect.mjs`: `decide(db, payload, { enabled })` for `Stop`. Friction is `denials` and
  `CORRECTION` prompts after the session's last `reflect` row, not `tool_fail` (no words of the
  user to learn from). It asks when there is friction and none inside this turn (a correction opens its own turn), else, in a clean
  session, for one queued session of the same project. Skips when off, on `stop_hook_active`,
  with `background_tasks`, or after 3 per session. `capture.mjs` runs it in one transaction, so
  two sessions cannot claim one queued session. Asking adds a `reflect` row to the session that
  runs it and a `reflected` row (no cost, not counted) to a queued one; friction counts from the
  later of the two. `capture.mjs` prints the request as `hookSpecificOutput.additionalContext`,
  not a block. The scan stores each
  reflection's token cost in that row's `code`.
- `lib/config.mjs` and `commands/learn.md`: `config.json`, one switch, `learn`, on by default:
  it gates reflection and loading. A pre-0.12.0 file with `reflect` or `learn` on reads as on,
  one with both off as off.
- `skills/reflect/SKILL.md`: records a `repeat` when a loaded lesson covers the friction, else
  drafts at most two lessons from the user's words, never tool output, and runs `propose.mjs`. A
  denial names its agent in the hook message. The hook message is one line (Claude Code prints it in the chat): the
  session and its friction, or the tool and lesson ids; the skills hold the steps.
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
- `PermissionRequest` and `PostToolUse` stay async, so at `Stop` an approved call can still look
  denied. It only delays a reflection by a turn: the late row clears the denial.
