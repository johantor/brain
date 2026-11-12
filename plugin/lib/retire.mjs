// Code, not a model, retires lessons (#3, "Staleness"): a project lesson whose project has
// had no session for 90 days. Pinned lessons are the user's and never retired. Lessons are
// not scored: a per-session friction count is too noisy to judge one lesson (README,
// Known gaps), so the user's forget and undo decide the rest.
import { projectRoot } from './ask.mjs';
import { DAY, tx } from './db.mjs';
import { recordChange, updateLessonFile } from './lessons.mjs';

export const IDLE_DAYS = 90;

export function retireIdle(db, now = Date.now()) {
  const since = now - IDLE_DAYS * DAY;
  const live = new Set(db.prepare('SELECT DISTINCT cwd FROM sessions WHERE last >= ? AND cwd IS NOT NULL').all(since).map((r) => projectRoot(r.cwd)));
  const candidates = db.prepare("SELECT id FROM lessons WHERE scope = 'project' AND status NOT IN ('deprecated', 'stable') AND created < ?").all(since);
  for (const { id } of candidates) {
    // Reread inside the lock: a lesson pinned or forgotten meanwhile is left alone.
    tx(db, () => {
      const l = db.prepare('SELECT id, status, project FROM lessons WHERE id = ?').get(id);
      if (!l || l.status === 'deprecated' || l.status === 'stable' || live.has(l.project)) return;
      db.prepare("UPDATE lessons SET status = 'deprecated' WHERE id = ?").run(l.id);
      updateLessonFile(l.id, { status: 'deprecated', retired: 'project idle' });
      recordChange(db, { lesson: l.id, action: 'archived', before: { status: l.status }, now, note: 'project idle' });
    });
  }
}
