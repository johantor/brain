// Retirement: a project lesson whose project has had no session for 90 days is archived.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { DAY, openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { check, store } from '../plugin/lib/propose.mjs';
import { IDLE_DAYS, retireIdle } from '../plugin/lib/retire.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');

// L1, a global lesson, and L2, a project lesson of /w/shop.
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-retire-'));
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 'seed', cwd: '/w/shop', hook_event_name: 'SessionStart' }, NOW);
  const add = (kind, description) => store(db, check({ kind, sessions: ['seed'], description }, { cwd: '/w/shop' }).lesson, NOW);
  add('method-error', 'Read the failing log before you guess a cause of the failure.');
  add('project-fact', 'Builds here need the VPN up before tests can reach the database.');
  return db;
}

const statusOf = (db, id) => db.prepare('SELECT status FROM lessons WHERE id = ?').get(id).status;

test('a project lesson is archived when its project has had no session for 90 days', (t) => {
  const db = setup(t);
  retireIdle(db, NOW + (IDLE_DAYS + 1) * DAY);
  assert.equal(statusOf(db, 2), 'deprecated');
  assert.equal(parse(fs.readFileSync(lessonFile(2), 'utf8')).front.retired, 'project idle');
  assert.equal(statusOf(db, 1), 'draft', 'a global lesson is not tied to a project');
});

test('a recent session in the project, or a pin, keeps a project lesson', (t) => {
  const db = setup(t);
  const later = NOW + (IDLE_DAYS + 1) * DAY;
  record(db, { session_id: 'recent', cwd: '/w/shop', hook_event_name: 'SessionStart' }, later - DAY);
  retireIdle(db, later);
  assert.equal(statusOf(db, 2), 'draft');
  const pinned = setup(t);
  pinned.prepare("UPDATE lessons SET status = 'stable' WHERE id = 2").run();
  retireIdle(pinned, later);
  assert.equal(statusOf(pinned, 2), 'stable');
});
