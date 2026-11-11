// Holdout scoring (#3, "Lifecycle"): a lesson sits out about 30% of the sessions it
// would load in, and the friction rates with and without it are compared. The choice
// is a hash of session and lesson, so load.mjs needs no write and the scan can recount.
import crypto from 'node:crypto';
import { projectRoot } from './ask.mjs';
import { DAY, tx } from './db.mjs';
import { recordChange, updateLessonFile } from './lessons.mjs';
import { friction } from './reflect.mjs';

export const HOLDOUT = 0.3;
export const MIN_SESSIONS = 10;
export const PROBE_SESSIONS = 5;
export const IDLE_DAYS = 90;

// On probe: a lesson learned with another model sits out every session until the probe
// decides whether its mistake still happens (#3, "Probe"). Preferences are about the
// user, not the model, so they are never probed.
export function probing(lesson, model) {
  return lesson.kind !== 'preference' && !!lesson.model && !!model && model !== lesson.model;
}

// Pinned lessons always load: the user chose them.
export function held(sid, lesson, model) {
  if (lesson.status === 'stable') return false;
  if (probing(lesson, model)) return true;
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
  const sessions = db.prepare(`SELECT s.sid, s.cwd, s.model FROM sessions s
    WHERE s.started >= ? AND EXISTS (SELECT 1 FROM events e WHERE e.sid = s.sid AND e.kind = 'loaded')`).all(lesson.created);
  // After a probe kept the lesson under a new model, only later sessions count: the probe
  // sessions loaded nothing, and earlier ones ran another model.
  const keptAt = db.prepare("SELECT coalesce(max(ts), 0) AS t FROM changes WHERE lesson = ? AND action = 'kept'").get(lesson.id).t;
  const withIt = [];
  const without = [];
  const probe = [];
  for (const s of sessions) {
    if (s.started < keptAt) continue;
    if (lesson.scope === 'project' && (!s.cwd || projectRoot(s.cwd) !== lesson.project)) continue;
    if (probing(lesson, s.model)) {
      probe.push({ rate: rate(db, s.sid), model: s.model });
      continue;
    }
    (held(s.sid, lesson, s.model) ? without : withIt).push(rate(db, s.sid));
  }
  const loaded = mean(withIt);
  const heldOut = mean(without);
  let verdict = 'unclear';
  if (withIt.length < MIN_SESSIONS || without.length < MIN_SESSIONS) verdict = 'too few';
  else if (loaded >= heldOut) verdict = 'no effect';
  else if (loaded <= heldOut * 0.8) verdict = 'helps';
  return { loadedN: withIt.length, heldN: without.length, loaded, heldOut, verdict, probe };
}

// Archives a lesson: `deprecated` with the reason in the file. Undo brings it back, and
// its key still blocks learning it again.
function archive(db, lesson, reason, now) {
  db.prepare("UPDATE lessons SET status = 'deprecated' WHERE id = ?").run(lesson.id);
  updateLessonFile(lesson.id, { status: 'deprecated', retired: reason });
  recordChange(db, { lesson: lesson.id, action: 'archived', before: { status: lesson.status }, now, note: reason });
}

// Code, not a model, retires lessons (#3, "Staleness"): no effect under holdout, a probe
// that shows the mistake no longer happens, or a project with no session for 90 days.
// Pinned lessons are the user's and are never retired here.
function retire(db, lesson, s, now) {
  if (lesson.status === 'stable') return;
  if (s.verdict === 'no effect') return archive(db, lesson, 'no effect', now);
  if (s.probe.length >= PROBE_SESSIONS) {
    const without = mean(s.probe.map((p) => p.rate));
    if (s.loaded !== null && without <= s.loaded) return archive(db, lesson, 'fixed', now);
    // The mistake came back under the new model: the lesson returns, observed with it.
    const model = s.probe.at(-1).model;
    db.prepare('UPDATE lessons SET model = ? WHERE id = ?').run(model, lesson.id);
    updateLessonFile(lesson.id, { observed_with: { model } });
    return recordChange(db, { lesson: lesson.id, action: 'kept', now, note: `the probe under ${model} saw the mistake again` });
  }
  if (lesson.scope === 'project' && lesson.created < now - IDLE_DAYS * DAY) {
    const recent = db.prepare('SELECT cwd FROM sessions WHERE last >= ?').all(now - IDLE_DAYS * DAY);
    if (!recent.some((r) => r.cwd && projectRoot(r.cwd) === lesson.project)) archive(db, lesson, 'project idle', now);
  }
}

// Scores every live lesson, stores the result, marks a lesson that helps as
// machine-confirmed (OKF `verified` by `process:holdout`) once, and retires stale ones.
export function scoreAll(db, now = Date.now()) {
  const lessons = db.prepare("SELECT id, kind, scope, project, status, created, model FROM lessons WHERE status != 'deprecated'").all();
  for (const l of lessons) {
    const s = scoreLesson(db, l);
    tx(db, () => {
      const was = db.prepare('SELECT verdict FROM scores WHERE lesson = ?').get(l.id)?.verdict;
      db.prepare(`INSERT INTO scores (lesson, loaded_n, held_n, loaded_rate, held_rate, verdict, ts) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lesson) DO UPDATE SET loaded_n = excluded.loaded_n, held_n = excluded.held_n, loaded_rate = excluded.loaded_rate,
          held_rate = excluded.held_rate, verdict = excluded.verdict, ts = excluded.ts`)
        .run(l.id, s.loadedN, s.heldN, s.loaded, s.heldOut, s.verdict, now);
      if (s.verdict === 'helps' && was !== 'helps' && l.status === 'draft') {
        updateLessonFile(l.id, { verified: [{ by: 'process:holdout', at: new Date(now).toISOString() }] });
        recordChange(db, { lesson: l.id, action: 'confirmed', now, note: `holdout: ${s.loadedN} sessions with it, ${s.heldN} without` });
      }
      retire(db, l, s, now);
    });
  }
}
