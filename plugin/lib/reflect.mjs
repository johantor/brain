// The Stop hook's decision: reflect now or not. Reflection waits for the first clean
// stop after friction, so the lesson can pair the dead end with what fixed it (#3,
// "Reflect"). Code decides when; the agent only drafts, and propose.mjs decides what.
import { DAY, QUEUE_DAYS } from './db.mjs';
import { projectRoot } from './ask.mjs';
import { waitingClusters } from './skills.mjs';

export const MAX_PER_SESSION = 3;

// A prompt that pushes back on the last turn. A cheap marker, not a classifier: the
// reflection itself judges whether there was a lesson.
export const CORRECTION = /^\s*(no|nope|not that|wrong|stop|don'?t|actually|that'?s not|that is not|undo|revert|why did you)\b/i;

// Friction in one session after `since`: denied permissions, corrections and prompts after an
// interrupt (`code` 1, capture.mjs), each as { kind, ts, what }. A failed call alone is not friction: a lesson comes from the user's
// words, so a reflection with none to read stores nothing and only spends tokens.
export function friction(db, sid, since) {
  const rows = db.prepare(`
    SELECT 'denial' AS kind, ts, tool AS what, NULL AS prompt, agent FROM denials WHERE sid = $sid AND ts > $since
    UNION ALL SELECT CASE code WHEN 1 THEN 'interrupt' ELSE 'correction' END, ts, NULL, text, NULL
      FROM events WHERE sid = $sid AND kind = 'prompt' AND ts > $since
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
    // Name the subagent: the user does not see its calls, and its mistake may repeat a lesson.
    const key = f.kind === 'correction' ? 'a correction from the user'
      : f.kind === 'interrupt' ? 'an interrupt and a new instruction from the user'
        : `a denied ${f.what ?? 'tool'} call${f.agent ? ` by ${f.agent}` : ''}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} (x${n})` : k)).join(', ');
}

// Claude Code prints a Stop hook's text in the chat, so each message is one line: the
// skill holds the steps and the command.
const instruction = (sid, what, fromRecord) =>
  `brain: reflect on ${fromRecord ? 'the earlier session' : 'this session'} ${sid}: ${what}. Use the brain:reflect skill.`;

const distillInstruction = (cluster) =>
  `brain: ${cluster.lessons.length} lessons name \`${cluster.tool}\`: ${cluster.lessons.map((l) => `L${l.id}`).join(', ')}. Use the brain:distill skill.`;

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
  const inTurn = items.some((f) => f.ts > turnStart || (f.ts === turnStart && f.kind === 'denial'));
  const mark = () => db.prepare("INSERT INTO events (sid, ts, kind) VALUES (?, ?, 'reflect')").run(sid, now);
  if (items.length && !inTurn) {
    mark();
    return instruction(sid, describe(items), false);
  }
  if (items.length) return null;

  // A clean stop with room for a skill and a group of lessons waiting for one. A group
  // is asked about once a week at most, so "no skill" is not asked again every session.
  const asked = db.prepare("SELECT 1 FROM events WHERE kind = 'reflect' AND text = ? AND ts > ?");
  const cluster = waitingClusters(db).find((c) => !asked.get(`distill:${c.tool}`, now - 7 * DAY));
  if (cluster) {
    db.prepare("INSERT INTO events (sid, ts, kind, text) VALUES (?, ?, 'reflect', ?)").run(sid, now, `distill:${cluster.tool}`);
    return distillInstruction(cluster);
  }

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
