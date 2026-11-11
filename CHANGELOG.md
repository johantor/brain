# Changelog

All notable changes to the `brain` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
