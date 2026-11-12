// Holdout scoring (#3, "Lifecycle"): a lesson sits out about 30% of the sessions it
// would load in, and the friction rates with and without it are compared. The choice
// is a hash of session and lesson, so load.mjs needs no write and the scan can recount.
import crypto from 'node:crypto';
import { projectRoot } from './ask.mjs';
import { tx } from './db.mjs';
import { recordChange, updateLessonFile } from './lessons.mjs';
import { friction } from './reflect.mjs';

export const HOLDOUT = 0.3;
export const MIN_SESSIONS = 10;

// Pinned lessons always load: the user chose them.
export function held(sid, lesson) {
  if (lesson.status === 'stable') return false;
  return crypto.createHash('sha256').update(`${sid}:${lesson.id}`).digest()[0] / 256 < HOLDOUT;
}

// Friction per prompt in one session: failures, denials and corrections.
function rate(db, sid) {
  const prompts = db.prepare("SELECT count(*) AS n FROM events WHERE sid = ? AND kind = 'prompt'").get(sid).n;
  return friction(db, sid, 0).length / Math.max(prompts, 1);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Compares sessions that loaded the lesson with sessions that held it out: only sessions
// that loaded lessons (a `loaded` event), started after the lesson, in its scope.
export function scoreLesson(db, lesson) {
  const sessions = db.prepare(`SELECT s.sid, s.cwd, e.text AS ids FROM sessions s JOIN events e ON e.sid = s.sid AND e.kind = 'loaded'
    WHERE s.started >= ?`).all(lesson.created);
  const withIt = [];
  const without = [];
  for (const s of sessions) {
    if (lesson.scope === 'project' && (!s.cwd || projectRoot(s.cwd) !== lesson.project)) continue;
    // Loaded: the session's list holds it. Held: the hash held it out. A lesson that did
    // not fit the budget is neither, and that session does not count.
    if (s.ids?.includes(`,${lesson.id},`)) withIt.push(rate(db, s.sid));
    else if (held(s.sid, lesson)) without.push(rate(db, s.sid));
  }
  const loaded = mean(withIt);
  const heldOut = mean(without);
  let verdict = 'unclear';
  if (withIt.length < MIN_SESSIONS || without.length < MIN_SESSIONS) verdict = 'too few';
  else if (loaded >= heldOut) verdict = 'no effect';
  else if (loaded <= heldOut * 0.8) verdict = 'helps';
  return { loadedN: withIt.length, heldN: without.length, loaded, heldOut, verdict };
}

// Scores every live lesson, stores the result, and marks a lesson that helps as
// machine-confirmed (OKF `verified` by `process:holdout`), once.
export function scoreAll(db, now = Date.now()) {
  const lessons = db.prepare("SELECT id, scope, project, status, created FROM lessons WHERE status != 'deprecated'").all();
  for (const l of lessons) {
    const s = scoreLesson(db, l);
    tx(db, () => {
      db.prepare(`INSERT INTO scores (lesson, loaded_n, held_n, loaded_rate, held_rate, verdict, ts) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lesson) DO UPDATE SET loaded_n = excluded.loaded_n, held_n = excluded.held_n, loaded_rate = excluded.loaded_rate,
          held_rate = excluded.held_rate, verdict = excluded.verdict, ts = excluded.ts`)
        .run(l.id, s.loadedN, s.heldN, s.loaded, s.heldOut, s.verdict, now);
      // Once per lesson: the history, not the last verdict, says whether it was confirmed.
      const confirmed = db.prepare("SELECT 1 FROM changes WHERE lesson = ? AND action = 'confirmed' AND undone = 0").get(l.id);
      if (s.verdict === 'helps' && !confirmed && l.status === 'draft') {
        updateLessonFile(l.id, { verified: [{ by: 'process:holdout', at: new Date(now).toISOString() }] });
        // `before` lets undo remove the confirmation without vetoing the draft.
        recordChange(db, { lesson: l.id, action: 'confirmed', before: { status: l.status }, now, note: `holdout: ${s.loadedN} sessions with it, ${s.heldN} without` });
      }
    });
  }
}
