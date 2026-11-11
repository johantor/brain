#!/usr/bin/env bash
# Behavioral tests for hooks/capture.sh (brain's capture; never blocks), then the
# Node suite for scrubbing, recording, the transcript scan and the report.
# shellcheck source=tests/lib.sh
# shellcheck disable=SC1090,SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HOOK="capture.sh"

# brain needs Node with node:sqlite; a missing one fails the suite rather than skipping it.
command -v node >/dev/null 2>&1 || die "node is required to run the brain tests"
node --disable-warning=ExperimentalWarning -e 'require("node:sqlite")' 2>/dev/null \
  || die "node 22.13 or later (node:sqlite) is required to run the brain tests"

# These tests may run inside a cloud session; the hook must not see its marker.
unset CLAUDE_CODE_REMOTE
CLAUDE_BRAIN_DIR="$(new_tmpdir)/brain"
CLAUDE_CONFIG_DIR="$(new_tmpdir)"
export CLAUDE_BRAIN_DIR CLAUDE_CONFIG_DIR
db="$CLAUDE_BRAIN_DIR/brain.db"

# count <sql> -> the first column of the first row
count() {
  node --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(Object.values(db.prepare(process.argv[2]).get())[0]);' "$db" "$1"
}

# assert_count <label> <sql> <expected>
assert_count() {
  local got
  got="$(count "$2" 2>&1)"
  if [ "$got" = "$3" ]; then _pass; else _fail "$1: '$2' gave '$got', expected '$3'"; fi
}

assert_allow "SessionStart is recorded" "$HOOK" '{"session_id":"s1","hook_event_name":"SessionStart","cwd":"/w/acme","model":"opus"}'
assert_count "session row" "SELECT model FROM sessions WHERE sid = 's1'" "opus"

assert_allow "prompt is recorded" "$HOOK" '{"session_id":"s1","hook_event_name":"UserPromptSubmit","cwd":"/w/acme","prompt":"no, see /etc/hosts"}'
assert_count "prompt scrubbed" "SELECT text FROM events WHERE kind = 'prompt'" "no, see <path>"

# A cloud container is thrown away: nothing is recorded there.
before="$(count "SELECT count(*) FROM events")"
CLAUDE_CODE_REMOTE=true assert_allow "cloud session" "$HOOK" '{"session_id":"s1","hook_event_name":"UserPromptSubmit","prompt":"x"}'
assert_count "nothing recorded in the cloud" "SELECT count(*) FROM events" "$before"

# Never fails the session: bad input, no session id, an unwritable directory, no Node.
assert_allow "invalid JSON" "$HOOK" 'not json'
assert_allow "no session id" "$HOOK" '{"hook_event_name":"SessionEnd"}'
assert_count "nothing recorded for bad input" "SELECT count(*) FROM events" "$before"

blocker="$(new_tmpdir)/file"
: > "$blocker"
CLAUDE_BRAIN_DIR="$blocker/brain" assert_allow "unwritable brain dir" "$HOOK" \
  '{"session_id":"s2","hook_event_name":"SessionEnd"}'

# Run outside run_hook: the harness itself needs the PATH this case takes away.
nonode="$(new_tmpdir)"
ln -s "$(command -v dirname)" "$nonode/dirname"
status=0
printf '%s' '{"session_id":"s3","hook_event_name":"SessionEnd"}' | PATH="$nonode" "$BASH" "$HOOKS_DIR/$HOOK" || status=$?
if [ "$status" -eq 0 ]; then _pass; else _fail "no node on PATH: expected exit 0, got $status"; fi

# The records are private to the user: prompts can hold client details.
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
if [ "$(mode "$db")" = "600" ]; then _pass; else _fail "brain.db mode is $(mode "$db"), expected 600"; fi
if [ "$(mode "$CLAUDE_BRAIN_DIR")" = "700" ]; then _pass; else _fail "brain dir mode is $(mode "$CLAUDE_BRAIN_DIR"), expected 700"; fi

# Foreground hooks, each with a timeout: SessionEnd lands before the process exits, Stop
# decides on reflection, and the two friction events land before their turn's Stop does.
wiring="$(dirname "${BASH_SOURCE[0]}")/../plugin/hooks/hooks.json"
sync='["PostToolUseFailure","SessionEnd","Stop","UserPromptSubmit"]'
if jq -e --argjson s "$sync" '[.hooks | to_entries[] | select(.value[0].hooks[0] | (.async != true) and (.timeout | type == "number")) | .key] | sort == $s' "$wiring" >/dev/null; then
  _pass
else
  _fail "exactly $sync must run in the foreground with a timeout"
fi
if jq -e --argjson s "$sync" '[.hooks | to_entries[] | select(.key as $k | $s | index($k) | not) | .value[0].hooks[0].async] | all' "$wiring" >/dev/null; then
  _pass
else
  _fail "every other brain hook must be async"
fi
# SessionStart has two: the async capture and scan, and the foreground load, which can print context.
if jq -e '.hooks.SessionStart[1].hooks[0] | (.command | endswith("/hooks/load.sh")) and (.async != true) and (.timeout | type == "number")' "$wiring" >/dev/null; then
  _pass
else
  _fail "SessionStart must run load.sh in the foreground with a timeout"
fi
CLAUDE_CODE_REMOTE=true assert_allow "load in the cloud" "load.sh" '{"session_id":"s9","hook_event_name":"SessionStart","cwd":"/w/acme"}'
if [ -z "$_stdout" ]; then _pass; else _fail "load.sh printed in a cloud session: $_stdout"; fi

# Stop prints a reflection request only when reflection is on and a turn ended clean after friction.
stop='{"session_id":"r1","hook_event_name":"Stop","cwd":"/w/acme"}'
"$BASH" "$HOOKS_DIR/$HOOK" <<<'{"session_id":"r1","hook_event_name":"UserPromptSubmit","cwd":"/w/acme","prompt":"no, use pnpm"}'
out="$("$BASH" "$HOOKS_DIR/$HOOK" <<<"$stop")"
if [ -z "$out" ]; then _pass; else _fail "Stop with reflection off printed: $out"; fi
node "$(dirname "${BASH_SOURCE[0]}")/../plugin/lib/config.mjs" reflect on >/dev/null
"$BASH" "$HOOKS_DIR/$HOOK" <<<'{"session_id":"r2","hook_event_name":"UserPromptSubmit","cwd":"/w/acme","prompt":"no, use pnpm"}'
out="$("$BASH" "$HOOKS_DIR/$HOOK" <<<'{"session_id":"r2","hook_event_name":"Stop","cwd":"/w/acme"}')"
if jq -e '.hookSpecificOutput | .hookEventName == "Stop" and (.additionalContext | test("brain:reflect"))' >/dev/null 2>&1 <<<"$out"; then
  _pass
else
  _fail "Stop with reflection on: expected additionalContext, got: ${out:-nothing}"
fi

# The report runs on the same database.
if node --disable-warning=ExperimentalWarning "$(dirname "${BASH_SOURCE[0]}")/../plugin/lib/report.mjs" | grep -q '^acme '; then
  _pass
else
  _fail "report.mjs does not list the recorded project"
fi

if node --test "$(dirname "${BASH_SOURCE[0]}")"/*.test.mjs >"$FIXTURE_ROOT/node-test.log" 2>&1; then
  _pass
else
  cat "$FIXTURE_ROOT/node-test.log" >&2
  _fail "node --test suite failed"
fi

finish
