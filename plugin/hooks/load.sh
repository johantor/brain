#!/usr/bin/env bash
# SessionStart in the foreground: prints the lessons to load, or nothing. Always exits 0,
# like capture.sh, and loads nothing in a cloud container, which records nothing either.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
node --disable-warning=ExperimentalWarning "$(dirname "${BASH_SOURCE[0]}")/../lib/load.mjs" || true
exit 0
