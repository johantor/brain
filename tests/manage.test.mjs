// The user's control over lessons: forget, pin, undo, learned.md and the notice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { notice, select } from '../plugin/lib/load.mjs';
import { forget, pin, undo, writeLearned } from '../plugin/lib/manage.mjs';
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
  assert.equal(notice(db, NOW - 1), 'brain: since the last session, proposed L1, L2; forgotten L2. /brain:undo reverses the latest.');
});
