// Holdout scoring: which sessions hold a lesson out, and what the comparison says.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { DAY, openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { select } from '../plugin/lib/load.mjs';
import { check, store } from '../plugin/lib/propose.mjs';
import { undo } from '../plugin/lib/manage.mjs';
import { HOLDOUT, IDLE_DAYS, MIN_SESSIONS, PROBE_SESSIONS, held, probing, scoreAll, scoreLesson } from '../plugin/lib/score.mjs';

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
function setup(t, { n = 40, withIt = 0, without = 2, model, fits = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-score-'));
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 'seed', cwd: '/w/shop', hook_event_name: 'SessionStart', model }, NOW);
  store(db, check({ kind: 'method-error', sessions: ['seed'], description: 'Read the failing log before you guess a cause of the failure.' }, { cwd: '/w/shop' }).lesson, NOW);
  const lesson = { id: 1, kind: 'method-error', scope: 'global', status: 'draft', created: NOW, model: model ?? null };
  let t0 = NOW + 1000;
  for (let i = 0; i < n; i++) {
    const sid = `x${i}`;
    const hook = (p) => record(db, { session_id: sid, cwd: '/w/shop', ...p }, (t0 += 10));
    hook({ hook_event_name: 'SessionStart', model });
    // The ids load.mjs would show: none when held out, or when the lesson did not fit.
    db.prepare("INSERT INTO events (sid, ts, kind, text) VALUES (?, ?, 'loaded', ?)").run(sid, t0, held(sid, lesson, model) || !fits ? ',,' : ',1,');
    hook({ hook_event_name: 'UserPromptSubmit', prompt: 'add a cart' });
    for (let f = 0; f < (held(sid, lesson, model) ? without : withIt); f++) {
      hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: `npm test ${f}` }, error: 'Exit code 1' });
    }
    hook({ hook_event_name: 'SessionEnd' });
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

const statusOf = (db, id) => db.prepare('SELECT status FROM lessons WHERE id = ?').get(id).status;
const retiredOf = (id) => parse(fs.readFileSync(lessonFile(id), 'utf8')).front.retired;

test('a lesson with no effect is archived, and a pinned one is never touched', (t) => {
  const { db } = setup(t, { withIt: 1, without: 1 });
  scoreAll(db, NOW + 1e6);
  assert.equal(statusOf(db, 1), 'deprecated');
  assert.equal(retiredOf(1), 'no effect');
  const pinned = setup(t, { withIt: 1, without: 1 });
  pinned.db.prepare("UPDATE lessons SET status = 'stable'").run();
  scoreAll(pinned.db, NOW + 1e6);
  assert.equal(statusOf(pinned.db, 1), 'stable');
});

// Adds `k` probe sessions under `model`, each with `fails` failures.
function probeSessions(db, k, model, fails, start = NOW + 5e5, prefix = 'p') {
  let t0 = start;
  for (let i = 0; i < k; i++) {
    const hook = (p) => record(db, { session_id: `${prefix}${i}`, cwd: '/w/shop', ...p }, (t0 += 10));
    hook({ hook_event_name: 'SessionStart', model });
    db.prepare("INSERT INTO events (sid, ts, kind) VALUES (?, ?, 'loaded')").run(`${prefix}${i}`, t0);
    hook({ hook_event_name: 'UserPromptSubmit', prompt: 'go' });
    for (let f = 0; f < fails; f++) hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: `x ${f}` }, error: 'Exit code 1' });
    hook({ hook_event_name: 'SessionEnd' });
  }
}

test('a new model puts a lesson on probe: held out in every session', () => {
  const lesson = { id: 1, kind: 'method-error', status: 'draft', model: 'opus-5' };
  assert.ok(probing(lesson, 'opus-6') && held('any', lesson, 'opus-6'));
  assert.ok(!probing({ ...lesson, kind: 'preference' }, 'opus-6'));
  assert.ok(!probing(lesson, 'opus-5'));
});

test('a probe with no more mistakes archives the lesson as fixed', (t) => {
  const { db } = setup(t, { model: 'opus-5', withIt: 1, without: 3 });
  probeSessions(db, PROBE_SESSIONS, 'opus-6', 0);
  scoreAll(db, NOW + 1e6);
  assert.equal(retiredOf(1), 'fixed');
});

test('a probe that sees the mistake again keeps the lesson under the new model', (t) => {
  const { db } = setup(t, { model: 'opus-5', withIt: 1, without: 3 });
  probeSessions(db, PROBE_SESSIONS, 'opus-6', 4);
  scoreAll(db, NOW + 1e6);
  assert.equal(statusOf(db, 1), 'draft');
  assert.equal(db.prepare('SELECT model FROM lessons WHERE id = 1').get().model, 'opus-6');
  assert.equal(db.prepare("SELECT count(*) AS n FROM changes WHERE action = 'kept'").get().n, 1);
  scoreAll(db, NOW + 2e6);
  assert.equal(db.prepare("SELECT count(*) AS n FROM changes WHERE action = 'kept'").get().n, 1, 'the old sessions start no new probe');
});

test('a project lesson is archived when its project has had no session for 90 days', (t) => {
  const { db } = setup(t, { n: 0 });
  store(db, check({ kind: 'project-fact', sessions: ['seed'], description: 'Builds here need the VPN up before tests can reach the database.' }, { cwd: '/w/shop' }).lesson, NOW);
  const later = NOW + (IDLE_DAYS + 1) * DAY;
  scoreAll(db, later);
  assert.equal(retiredOf(2), 'project idle');
  assert.equal(statusOf(db, 1), 'draft', 'a global lesson is not tied to a project');
});

test('a session that just started, with no prompt or end yet, is not scored', (t) => {
  const { db, lesson } = setup(t, { n: 0, model: 'opus-5' });
  probeSessions(db, PROBE_SESSIONS - 1, 'opus-6', 1);
  record(db, { session_id: 'now', cwd: '/w/shop', hook_event_name: 'SessionStart', model: 'opus-6' }, NOW + 9e5);
  db.prepare("INSERT INTO events (sid, ts, kind) VALUES ('now', ?, 'loaded')").run(NOW + 9e5);
  assert.equal(scoreLesson(db, lesson, NOW + 9e5 + 1).probe.rates.length, PROBE_SESSIONS - 1);
});

test('a probe counts only the newest model, with five of its own sessions', (t) => {
  const { db, lesson } = setup(t, { n: 0, model: 'opus-5' });
  probeSessions(db, 3, 'opus-6', 0, NOW + 5e5, 'b');
  probeSessions(db, 2, 'opus-7', 2, NOW + 6e5, 'c');
  const s = scoreLesson(db, lesson, NOW + 1e6);
  assert.equal(s.probe.model, 'opus-7');
  assert.equal(s.probe.rates.length, 2);
});

test('undoing a kept probe restores the earlier model, not a veto', (t) => {
  const { db } = setup(t, { model: 'opus-5', withIt: 1, without: 3 });
  probeSessions(db, PROBE_SESSIONS, 'opus-6', 4);
  scoreAll(db, NOW + 1e6);
  undo(db, NOW + 1e6 + 1);
  assert.deepEqual({ ...db.prepare('SELECT status, model FROM lessons WHERE id = 1').get() }, { status: 'draft', model: 'opus-5' });
});

test('the model column is filled from the lesson files on upgrade, and load reads an old schema', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-migrate-'));
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const file = path.join(dir, 'brain.db');
  let db = openDb(file);
  record(db, { session_id: 'seed', cwd: '/w/shop', hook_event_name: 'SessionStart', model: 'opus-5' }, NOW);
  store(db, check({ kind: 'method-error', sessions: ['seed'], description: 'Read the failing log before you guess a cause of the failure.' }, { cwd: '/w/shop' }).lesson, NOW);
  db.exec('ALTER TABLE lessons DROP COLUMN model');
  assert.equal(select(db, '/w/shop', 'x', 'opus-6').chosen.length + select(db, '/w/shop', 'y', 'opus-6').chosen.length > 0, true, 'old schema still loads');
  db.close();
  db = openDb(file);
  assert.equal(db.prepare('SELECT model FROM lessons WHERE id = 1').get().model, 'opus-5');
});

test('a lesson that never fit the budget is never credited', (t) => {
  const { db, lesson } = setup(t, { fits: false });
  const s = scoreLesson(db, lesson);
  assert.equal(s.loadedN, 0);
  assert.equal(s.verdict, 'too few');
});

test('a lesson is confirmed once, even when its verdict comes and goes', (t) => {
  const { db } = setup(t);
  scoreAll(db, NOW + 1e6);
  db.prepare("UPDATE scores SET verdict = 'no effect'").run();
  scoreAll(db, NOW + 2e6);
  assert.equal(db.prepare("SELECT count(*) AS n FROM changes WHERE action = 'confirmed'").get().n, 1);
});

test('undoing a confirmation keeps the draft and drops the verification', (t) => {
  const { db } = setup(t);
  scoreAll(db, NOW + 1e6);
  undo(db, NOW + 1e6 + 1);
  assert.equal(db.prepare('SELECT status FROM lessons WHERE id = 1').get().status, 'draft');
  assert.equal(parse(fs.readFileSync(lessonFile(1), 'utf8')).front.verified, undefined);
});

test('a resumed session counts once in a probe', (t) => {
  const { db, lesson } = setup(t, { n: 0, model: 'opus-5' });
  probeSessions(db, 1, 'opus-6', 0);
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO events (sid, ts, kind, text) VALUES ('p0', ?, 'loaded', ',,')").run(NOW + 6e5 + i);
  assert.equal(scoreLesson(db, lesson, NOW + 1e6).probe.rates.length, 1);
});

test('a session that was shown the lesson is no probe evidence', (t) => {
  const { db, lesson } = setup(t, { n: 0, model: 'opus-5' });
  probeSessions(db, PROBE_SESSIONS, 'opus-6', 0);
  db.prepare("UPDATE events SET text = ',1,' WHERE kind = 'loaded' AND sid LIKE 'p%'").run();
  assert.equal(scoreLesson(db, lesson, NOW + 1e6).probe.rates.length, 0);
});
