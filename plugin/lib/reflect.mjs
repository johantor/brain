// The Stop hook's decision: reflect now or not. Reflection waits for the first clean
// stop after friction, so the lesson can pair the dead end with what fixed it (#3,
// "Reflect"). Code decides when; the agent only drafts, and propose.mjs decides what.
import { fileURLToPath } from 'node:url';
import { DAY, QUEUE_DAYS } from './db.mjs';
import { projectRoot } from './ask.mjs';

export const MAX_PER_SESSION = 3;
const PROPOSE = fileURLToPath(new URL('./propose.mjs', import.meta.url));

// A prompt that pushes back on the last turn. A cheap marker, not a classifier: the
// reflection itself judges whether there was a lesson.
export const CORRECTION = /^\s*(no|nope|not that|wrong|stop|don'?t|actually|that'?s not|that is not|undo|revert|why did you)\b/i;

// Friction in one session after `since`: failing calls, denied permissions and
// corrections, each as { kind, ts, what }.
export function friction(db, sid, since) {
  const rows = db.prepare(`
    SELECT 'failure' AS kind, ts, coalesce(text, tool) AS what, NULL AS prompt FROM events
      WHERE sid = $sid AND kind = 'tool_fail' AND ts > $since
    UNION ALL SELECT 'denial', ts, tool, NULL FROM denials WHERE sid = $sid AND ts > $since
    UNION ALL SELECT 'correction', ts, NULL, text FROM events WHERE sid = $sid AND kind = 'prompt' AND ts > $since
    ORDER BY ts`).all({ sid, since });
  return rows.filter((r) => r.kind !== 'correction' || CORRECTION.test(r.prompt ?? ''));
}

const lastTs = (db, sid, kind) => db.prepare('SELECT max(ts) AS t FROM events WHERE sid = ? AND kind = ?').get(sid, kind).t ?? 0;

// Friction counts from the session's last reflection: one it ran (`reflect`), or one
// another session ran on its record (`reflected`, which costs nothing here).
const reflectedAt = (db, sid) =>
  db.prepare("SELECT max(ts) AS t FROM events WHERE sid = ? AND kind IN ('reflect', 'reflected')").get(sid).t ?? 0;

function describe(items) {
  const counts = {};
  for (const f of items) {
    const key = f.kind === 'correction' ? 'a correction from the user' : f.kind === 'denial' ? `a denied ${f.what ?? 'tool'} call` : `a failed ${f.what ?? 'call'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} (x${n})` : k)).join(', ');
}

function instruction(sid, what, fromRecord) {
  const source = fromRecord
    ? `an earlier session in this project (${sid}) that ended before it could reflect. Read its record with the brain skill (my_events WHERE sid = '${sid}')`
    : 'this session';
  return [
    `brain: shadow reflection. Since the last reflection, ${source} had ${what}.`,
    'Use the brain:reflect skill now, briefly, before you stop.',
    `Propose with: node --disable-warning=ExperimentalWarning "${PROPOSE}" (sessions: ["${sid}"]).`,
    'Then end the turn with one short line on what you stored, or "no lesson".',
  ].join(' ');
}

// Returns the additionalContext to send, or null to let the stop proceed. Run it in one
// transaction (capture.mjs does), so two sessions cannot claim the same queued episode.
export function decide(db, payload, { enabled, now = Date.now() }) {
  if (!enabled || payload.stop_hook_active) return null;
  if (Array.isArray(payload.background_tasks) && payload.background_tasks.length) return null;
  const sid = payload.session_id;
  const reflections = db.prepare("SELECT count(*) AS n FROM events WHERE sid = ? AND kind = 'reflect'").get(sid).n;
  if (reflections >= MAX_PER_SESSION) return null;

  const since = reflectedAt(db, sid);
  const turnStart = lastTs(db, sid, 'prompt');
  const items = friction(db, sid, since);
  // A correction opens the turn it starts; anything else inside this turn means the
  // trouble is not over yet.
  const inTurn = items.some((f) => f.ts > turnStart || (f.ts === turnStart && f.kind !== 'correction'));
  const mark = () => db.prepare("INSERT INTO events (sid, ts, kind) VALUES (?, ?, 'reflect')").run(sid, now);
  if (items.length && !inTurn) {
    mark();
    return instruction(sid, describe(items), false);
  }
  if (items.length) return null;

  // A clean session can take one queued session of the same project.
  const cwd = db.prepare('SELECT cwd FROM sessions WHERE sid = ?').get(sid)?.cwd;
  if (!cwd) return null;
  const root = projectRoot(cwd);
  for (const q of db.prepare('SELECT q.sid, s.cwd FROM queue q JOIN sessions s ON s.sid = q.sid WHERE q.sid != ? AND q.ts >= ? ORDER BY q.ts DESC')
    .all(sid, now - QUEUE_DAYS * DAY)) {
    if (!q.cwd || projectRoot(q.cwd) !== root) continue;
    const past = friction(db, q.sid, reflectedAt(db, q.sid));
    db.prepare('DELETE FROM queue WHERE sid = ?').run(q.sid);
    if (!past.length) continue;
    db.prepare("INSERT INTO events (sid, ts, kind) VALUES (?, ?, 'reflected')").run(q.sid, now);
    mark();
    return instruction(q.sid, describe(past), true);
  }
  return null;
}
