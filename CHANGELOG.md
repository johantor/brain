# Changelog

All notable changes to the `brain` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.1] - 2026-11-27

### Changed

- The plugin description mentions Promote (#35).

## [0.18.0] - 2026-11-27

### Added

- `/brain:lessons` suggests Promote for a pinned lesson that one plugin's agents cite in two or
  more projects, and drafts an issue for its repository; it sends only on your Send (#33).
- `/brain:promote` lists or changes the plugins Promote may draft for: board, crew and personas
  from the `johantor` marketplace by default.

## [0.17.0] - 2026-11-23

### Added

- A prompt after you press Esc counts as a correction, whatever its words (#30).

## [0.16.0] - 2026-11-23

### Added

- A lesson citation by a subagent names the subagent, in `/brain:lessons`.

## [0.15.0] - 2026-11-23

### Added

- `/brain:lessons` lists each lesson with how often sessions and subagents cited it and how often
  its mistake happened again, suggests pin or forget, and applies your choice per lesson.
- `/brain:report` counts lesson citations and repeats; a reflection names the subagent of a denial.

### Removed

- `/brain:pin`: `/brain:lessons` pins.

## [0.14.0] - 2026-11-17

### Added

- Each subagent starts with the lessons too, not only the main session.

## [0.13.0] - 2026-11-17

### Added

- brain records which agent made each call, and `/brain:report` splits calls, failures and
  denials by agent.

## [0.12.0] - 2026-11-17

### Changed

- Learning is on from install: one switch, `/brain:learn`, drafts and loads lessons, and the first
  session says so once. A config file from an earlier version keeps its choice. `/brain:shadow`
  is removed.
- A failed call alone no longer starts a reflection; a correction or a denied permission does.

## [0.11.2] - 2026-11-17

### Changed

- The reflection and distill requests that Claude Code prints at a stop are one short line; the
  skills hold the steps and the command.

### Fixed

- An `AskUserQuestion` call no longer counts as a denied permission.

## [0.11.1] - 2026-11-13

### Fixed

- A busy database no longer shows `hook timed out after 5s`: a hook waits 2 seconds for it,
  then writes to `errors.log`.

## [0.11.0] - 2026-11-12

### Removed

- Holdout scoring, the model-change probe, and automatic archiving as `no effect` or `fixed`.
  A simulation showed the per-session comparison is mostly noise; every lesson now loads, and
  you forget or pin it.

### Fixed

- The reflect skill, `/brain:shadow`, `/brain:undo` and the `brain` skill no longer say that
  nothing loads drafts.

## [0.10.1] - 2026-11-12

### Fixed

- The plugin description and the README introduction describe loading, scoring, retirement and
  skills, which shipped in 0.6.0 to 0.10.0.

## [0.10.0] - 2026-11-11

### Added

- Personal skills: three lessons on one tool become a `brain-` skill draft, live after 3 days
  unless it or one of its lessons is forgotten (`/brain:forget S<n>`), removed after 30 days
  unused; at most 5 (#18).

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
