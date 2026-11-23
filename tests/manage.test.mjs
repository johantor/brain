// The user's control over lessons: forget, pin, undo, learned.md and the notice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { DAY, openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { notice, select } from '../plugin/lib/load.mjs';
import { forget, list, main, pin, repeat, suggest, undo, writeLearned } from '../plugin/lib/manage.mjs';
import { check, store } from '../plugin/lib/propose.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');

// A database with two stored global drafts, L1 and L2, in CLAUDE_BRAIN_DIR.
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-manage-'));
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 's1', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW);
  for (const description of ['Read the failing log before you guess a cause of the failure.', 'Ask before you rename a public function that other code may call.']) {
    store(db, check({ kind: 'method-error', sessions: ['s1'], description }, { cwd: '/w/shop' }).lesson, NOW);
  }
  return { db, dir };
}

const front = (id) => parse(fs.readFileSync(lessonFile(id), 'utf8')).front;

test('forget vetoes a lesson: not loaded, and not learned again', (t) => {
  const { db } = setup(t);
  assert.match(forget(db, 1, NOW + 1), /forgot L1/);
  assert.equal(front(1).status, 'deprecated');
  assert.equal(front(1).retired, 'vetoed');
  assert.deepEqual(select(db, '/w/shop').chosen.map((l) => l.id), [2]);
  const again = check({ kind: 'method-error', sessions: ['s1'], description: 'Read the failing log before you guess a cause of the failure.' }, { cwd: '/w/shop' }).lesson;
  assert.match(store(db, again, NOW + 2).reject, /repeats L1/);
  assert.match(forget(db, 9, NOW), /no lesson L9/);
});

test('pin marks a lesson stable, verified by a person, and loads it first', (t) => {
  const { db } = setup(t);
  assert.match(pin(db, 1, NOW + 1), /pinned L1/);
  assert.equal(front(1).status, 'stable');
  assert.equal(front(1).verified[0].by, 'human:local');
  assert.deepEqual(select(db, '/w/shop').chosen.map((l) => l.id), [1, 2]);
});

test('undo reverses the latest change, and a second undo the one before', (t) => {
  const { db } = setup(t);
  forget(db, 1, NOW + 1);
  assert.match(undo(db, NOW + 2), /undid "forgotten" on L1/);
  assert.equal(front(1).status, 'draft');
  assert.match(undo(db, NOW + 3), /undid "proposed" on L2/);
  assert.equal(front(2).status, 'deprecated');
});

test('learned.md lists the live global lessons and says how to change them', (t) => {
  const { db, dir } = setup(t);
  forget(db, 1, NOW + 1);
  writeLearned(db);
  const text = fs.readFileSync(path.join(dir, 'learned.md'), 'utf8');
  assert.match(text, /\/brain:forget L<n>/);
  assert.match(text, /^- L2 \(method-error\): Ask before you rename/m);
  assert.doesNotMatch(text, /- L1 /);
  assert.ok(!fs.existsSync(path.join(dir, '.learned.json')));
});

test('the notice lists changes since the last one', (t) => {
  const { db } = setup(t);
  forget(db, 2, NOW + 10);
  assert.equal(notice(db, NOW + 10), null);
  assert.equal(notice(db, NOW - 1), 'brain: since the last session, proposed L1, L2; forgotten L2. /brain:undo reverses the latest lesson change; /brain:forget S<n> removes a skill.');
});

test('repeat records that a lesson\'s mistake happened again, for a known lesson and session', (t) => {
  const { db } = setup(t);
  record(db, { session_id: 's2', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW + 1);
  assert.match(repeat(db, 1, 's2', NOW + 1), /mistake of L1 happened again/);
  assert.match(repeat(db, 9, 's1', NOW + 1), /no lesson L9/);
  assert.match(repeat(db, 1, 'nope', NOW + 1), /no session nope/);
  record(db, { session_id: 'old', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW - 1);
  assert.match(repeat(db, 1, 'old', NOW + 1), /not loaded in session old/, 'the lesson is newer than the session');
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'repeat' AND code = 1").get().n, 1);
});

test('list shows each live lesson with its citations, repeats and a suggestion', (t) => {
  const { db } = setup(t);
  const cite = db.prepare("INSERT INTO events (sid, ts, kind, code, text) VALUES ('s1', ?, 'cite', ?, ?)");
  cite.run(NOW, 2, 'main');
  cite.run(NOW, 2, 'crew:frontend');
  record(db, { session_id: 's2', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW);
  repeat(db, 1, 's2', NOW);
  const out = list(db, NOW + 3 * DAY);
  assert.match(out, /^L1 draft, global method-error, 3 days old: cited 0 times, repeated 1 time\. Suggest: forget\n {2}Read the failing log/m);
  assert.match(out, /^L2 draft, global method-error, 3 days old: cited 2 times \(1 in subagents: crew:frontend 1\), repeated 0 times\. Suggest: pin$/m);
  forget(db, 1, NOW);
  assert.doesNotMatch(list(db, NOW), /^L1 /m);
});

test('suggest: pin what is cited and never repeated, forget what repeats as often as it is cited', () => {
  assert.equal(suggest({ status: 'draft', cited: 2, repeated: 0 }), 'pin');
  assert.equal(suggest({ status: 'stable', cited: 5, repeated: 0 }), 'keep');
  assert.equal(suggest({ status: 'draft', cited: 1, repeated: 0 }), 'keep');
  assert.equal(suggest({ status: 'draft', cited: 3, repeated: 1 }), 'keep');
  assert.equal(suggest({ status: 'stable', cited: 1, repeated: 1 }), 'forget');
});

test('main pins or forgets several lessons in one call, and rejects a bad id', (t) => {
  const { db } = setup(t);
  db.close();
  assert.equal(main(['pin', 'L1', 'L2']), 0);
  assert.equal(main(['forget', 'L1', 'x']), 2);
  assert.equal(main(['repeat', 'L1']), 2);
  const again = openDb();
  t.after(() => again.close());
  assert.deepEqual(again.prepare('SELECT status FROM lessons ORDER BY id').all().map((r) => r.status), ['stable', 'stable']);
});
