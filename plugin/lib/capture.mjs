// Hook entry: one Claude Code hook payload on stdin becomes rows in brain.db. No
// model runs here. Tool output is never stored, only its status, so a fetched page
// cannot plant text that a later reflection reads (#3, "Signals").
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx } from './db.mjs';
import { readConfig } from './config.mjs';
import { brainDir, isMain } from './paths.mjs';
import { decide } from './reflect.mjs';
import { scan } from './scan.mjs';
import { projectNames, scrub } from './scrub.mjs';

const PROMPT_MAX = 2000;

// Which tool call a row belongs to. PermissionRequest has no tool_use_id, so the key
// is a hash of the tool and its input, the same in every event of the call (board's).
export function callKey(name, input) {
  return crypto.createHash('sha256').update(`${name}\n${JSON.stringify(input ?? null)}`).digest('hex').slice(0, 16);
}

// The program a failed Bash call ran, without its arguments: `npm`, not the command line.
// Scrubbed like a prompt: the first word can be a token or a project's own script.
export function program(p, names = []) {
  if (p.tool_name !== 'Bash' || typeof p.tool_input?.command !== 'string') return null;
  const word = p.tool_input.command.trim().split(/\s+/).find((w) => !w.includes('='));
  const name = word && scrub(path.basename(word), names);
  return name && /^[\w.+-]{1,40}$/.test(name) ? name : null;
}

// A failed Bash call's error starts with `Exit code N`; a success carries no code.
export function exitCode(error) {
  const m = typeof error === 'string' ? /^Exit code (\d+)/.exec(error) : null;
  return m ? Number(m[1]) : null;
}

const UPSERT_SESSION = `
  INSERT INTO sessions (sid, cwd, started, last) VALUES (?, ?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET
    cwd = coalesce(sessions.cwd, excluded.cwd),
    started = min(coalesce(sessions.started, excluded.started), excluded.started),
    last = max(coalesce(sessions.last, 0), excluded.last)`;

const INSERT_EVENT = 'INSERT INTO events (sid, ts, kind, tool, call, code, text) VALUES (?, ?, ?, ?, ?, ?, ?)';

// Writes one payload. Returns false for a payload brain does not record.
export function record(db, p, now = Date.now()) {
  if (!p || typeof p !== 'object' || typeof p.session_id !== 'string') return false;
  const sid = p.session_id;
  const event = (kind, extra = {}) =>
    db.prepare(INSERT_EVENT).run(sid, now, kind, extra.tool ?? null, extra.call ?? null, extra.code ?? null, extra.text ?? null);
  const call = () => ({ tool: p.tool_name ?? null, call: callKey(p.tool_name, p.tool_input) });

  const write = {
    SessionStart: () => {
      if (typeof p.model === 'string') db.prepare('UPDATE sessions SET model = ? WHERE sid = ?').run(p.model, sid);
    },
    UserPromptSubmit: () => {
      const text = scrub(p.prompt, projectNames(p.cwd));
      if (text) event('prompt', { text: text.slice(0, PROMPT_MAX) });
    },
    PostToolUse: () => event('tool_ok', call()),
    PostToolUseFailure: () => event('tool_fail', { ...call(), code: exitCode(p.error), text: program(p, projectNames(p.cwd)) }),
    PermissionRequest: () => event('permission', call()),
    Stop: () => {},
    SessionEnd: () => {
      db.prepare('UPDATE sessions SET ended = ?, end_reason = ? WHERE sid = ?').run(now, p.reason ?? null, sid);
      // A session the scan already queued as `no-end` did end after all.
      db.prepare(`INSERT INTO queue (sid, reason, ts) VALUES (?, 'end', ?)
        ON CONFLICT(sid) DO UPDATE SET reason = 'end', ts = excluded.ts`).run(sid, now);
    },
  }[p.hook_event_name];
  if (!write) return false;

  tx(db, () => {
    db.prepare(UPSERT_SESSION).run(sid, typeof p.cwd === 'string' ? p.cwd : null, now, now);
    // New activity means a session queued as quiet is not over; the next scan requeues it.
    db.prepare("DELETE FROM queue WHERE sid = ? AND reason = 'no-end'").run(sid);
    write();
  });
  return true;
}

// Errors go to a file, not stderr: no one reads an async hook's stderr, and phase 1's
// gate is "the records look right". The payload never goes in.
export function logError(err) {
  try {
    const line = `${new Date().toISOString()} ${err?.name ?? 'Error'}: ${String(err?.message ?? err).slice(0, 300)}\n`;
    fs.appendFileSync(path.join(brainDir(), 'errors.log'), line, { mode: 0o600 });
  } catch {
    // Nowhere left to report it; the session must go on.
  }
}

export async function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return; // Not a hook payload: nothing to record, and not brain's fault.
  }
  let db;
  try {
    db = openDb();
    record(db, payload);
    // The scan also backfills every transcript on the first run after install.
    if (payload?.hook_event_name === 'SessionStart') await scan(db);
    if (payload?.hook_event_name === 'Stop' && typeof payload.session_id === 'string') {
      const enabled = readConfig().reflect;
      const context = enabled ? tx(db, () => decide(db, payload, { enabled })) : null;
      // additionalContext, not a block: Claude continues, and the transcript shows hook
      // feedback rather than a hook error (#3, "Reflect").
      if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: context } }));
    }
  } catch (err) {
    logError(err);
  } finally {
    db?.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) await main();
