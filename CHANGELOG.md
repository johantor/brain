# Changelog

All notable changes to the `brain` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-11-11

### Added

- The `brain` skill proposes auto-memory entries that recur in two or more projects for your
  global `CLAUDE.md`; it edits neither (#17).

## [0.8.0] - 2026-11-11

### Added

- brain retires lessons with no effect, project lessons idle for 90 days, and, after a 5-session
  probe when the model changes, lessons the new model no longer needs (#16).

## [0.7.0] - 2026-11-11

### Added

- Holdout scoring: a lesson you have not pinned sits out about 30% of sessions, and one that
  lowers friction is marked confirmed (#15).

## [0.6.0] - 2026-11-11

### Added

- `/brain:forget`, `/brain:pin` and `/brain:undo`; `learned.md` lists the global lessons (#14).
- A one-line notice at session start lists the lesson changes since the last session (#14).

## [0.5.0] - 2026-11-11

### Added

- `/brain:learn on` loads this project's lessons and the global ones at session start, within
  about 1,000 tokens, and writes `~/.claude/brain/learned.md`; off by default (#13).

## [0.4.1] - 2026-11-11

### Changed

- The plugin description covers the `brain` skill and shadow reflection (#12).

## [0.4.0] - 2026-11-11

### Added

- Shadow reflection, off by default (`/brain:shadow on`): at the first clean stop after friction,
  the `reflect` skill drafts lessons through `brain propose`; nothing loads (#10).
- `/brain:report` shows reflections, their token cost, and the number of draft lessons (#10).

### Changed

- `UserPromptSubmit`, `PostToolUseFailure` and `Stop` hooks run in the foreground, so the Stop
  decision sees its own turn (#10).

## [0.3.0] - 2026-11-11

### Added

- `brain propose` checks a drafted lesson and stores it as an OKF v0.2 file in
  `~/.claude/brain/lessons/`, as a draft that nothing loads (#9).

## [0.2.0] - 2026-11-11

### Added

- The `brain` skill answers questions about your sessions from the records, scoped to the current
  project, through a read-only query command (#8).

## [0.1.1] - 2026-11-11

### Changed

- The design moved to #3; code comments and docs point there (#7).

## [0.1.0] - 2026-11-11

### Added

- Hooks record scrubbed prompts, failing tool calls, permission requests and session ends to
  `~/.claude/brain/brain.db`, with no model; tool output is never stored (#1).
- A transcript scan adds token use, interrupts and sessions with no `SessionEnd`, and backfills
  90 days on the first run (#1).
- `/brain:report` shows the records per project (#1).
