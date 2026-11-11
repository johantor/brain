#!/usr/bin/env bash
# Hands the hook payload to capture.mjs, which writes it to brain.db. Always exits 0:
# brain only watches, and a missing Node must not disturb the session. A cloud
# container is thrown away with its records, so brain records nothing there (#5).
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
node --disable-warning=ExperimentalWarning "$(dirname "${BASH_SOURCE[0]}")/../lib/capture.mjs" || true
exit 0
