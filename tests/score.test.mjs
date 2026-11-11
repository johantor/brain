// Holdout scoring: which sessions hold a lesson out, and what the comparison says.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { select } from '../plugin/lib/load.mjs';
import { check, store } from '../plugin/lib/propose.mjs';
import { HOLDOUT, MIN_SESSIONS, held, scoreAll, scoreLesson } from '../plugin/lib/score.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');

test('about 30% of sessions hold a draft out, the same ones every time; a pinned lesson never', () => {
  const sids = Array.from({ length: 2000 }, (_, i) => `s${i}`);
  const share = sids.filter((s) => held(s, { id: 7, status: 'draft' })).length / sids.length;
  assert.ok(Math.abs(share - HOLDOUT) < 0.04, `share ${share}`);
  assert.equal(held('s1', { id: 7, status: 'draft' }), held('s1', { id: 7, status: 'draft' }));
  assert.ok(!sids.some((s) => held(s, { id: 7, status: 'stable' })));
});

// A database in CLAUDE_BRAIN_DIR with one global draft L1 and `n` scored sessions. A
// session that loads L1 gets `withIt` failures, one that holds it out `without`.
function setup(t, { n = 40, withIt = 0, without = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-score-'));
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 'seed', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW);
  store(db, check({ kind: 'method-error', sessions: ['seed'], description: 'Read the failing log before you guess a cause of the failure.' }, { cwd: '/w/shop' }).lesson, NOW);
  const lesson = { id: 1, scope: 'global', status: 'draft', created: NOW };
  let t0 = NOW + 1000;
  for (let i = 0; i < n; i++) {
    const sid = `x${i}`;
    const hook = (p) => record(db, { session_id: sid, cwd: '/w/shop', ...p }, (t0 += 10));
    hook({ hook_event_name: 'SessionStart' });
    db.prepare("INSERT INTO events (sid, ts, kind) VALUES (?, ?, 'loaded')").run(sid, t0);
    hook({ hook_event_name: 'UserPromptSubmit', prompt: 'add a cart' });
    for (let f = 0; f < (held(sid, lesson) ? without : withIt); f++) {
      hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: `npm test ${f}` }, error: 'Exit code 1' });
    }
  }
  return { db, lesson };
}

test('a lesson whose sessions fail less than the held-out ones helps, and is confirmed once', (t) => {
  const { db, lesson } = setup(t);
  const s = scoreLesson(db, lesson);
  assert.ok(s.loadedN >= MIN_SESSIONS && s.heldN >= MIN_SESSIONS);
  assert.equal(s.verdict, 'helps');
  scoreAll(db, NOW + 1e6);
  scoreAll(db, NOW + 2e6);
  assert.equal(parse(fs.readFileSync(lessonFile(1), 'utf8')).front.verified[0].by, 'process:holdout');
  assert.equal(db.prepare("SELECT count(*) AS n FROM changes WHERE action = 'confirmed'").get().n, 1);
});

test('no difference is no effect; too few sessions is no verdict', (t) => {
  const { db, lesson } = setup(t, { withIt: 1, without: 1 });
  assert.equal(scoreLesson(db, lesson).verdict, 'no effect');
  const few = setup(t, { n: 8 });
  assert.equal(scoreLesson(few.db, few.lesson).verdict, 'too few');
});

test('load leaves a lesson out of the sessions that hold it', (t) => {
  const { db } = setup(t, { n: 0 });
  const sids = Array.from({ length: 50 }, (_, i) => `y${i}`);
  const loadedIn = sids.filter((s) => select(db, '/w/shop', s).chosen.length === 1).length;
  assert.equal(loadedIn, sids.filter((s) => !held(s, { id: 1, status: 'draft' })).length);
});
