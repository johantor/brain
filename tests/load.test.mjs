// SessionStart loading: which lessons load, in what order, within the budget.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { main as configMain } from '../plugin/lib/config.mjs';
import { openDb } from '../plugin/lib/db.mjs';
import { BUDGET, context, main, select } from '../plugin/lib/load.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-load-'));

function lesson(db, id, { scope = 'global', project = null, status = 'draft', created = id, description = `Lesson number ${id} says to do the right thing.` } = {}) {
  db.prepare(`INSERT INTO lessons (id, key, description, kind, scope, project, status, created)
    VALUES (?, ?, ?, 'method-error', ?, ?, ?, ?)`).run(id, `k${id}`, description, scope, project, status, created);
}

test('select loads this project first, then global, newest first, skipping deprecated and other projects', () => {
  const db = openDb(path.join(tmp(), 'brain.db'));
  lesson(db, 1);
  lesson(db, 2, { scope: 'project', project: '/w/shop' });
  lesson(db, 3, { scope: 'project', project: '/w/other' });
  lesson(db, 4, { status: 'deprecated' });
  lesson(db, 5);
  const { chosen, left } = select(db, '/w/shop');
  assert.deepEqual(chosen.map((l) => l.id), [2, 5, 1]);
  assert.equal(left, 0);
  assert.match(context(chosen, left), /^brain lessons: .*\n- L2 \(method-error\): Lesson number 2/);
  assert.equal(context([], 0), null);
});

test('select stops at the budget and says how many were left out', () => {
  const db = openDb(path.join(tmp(), 'brain.db'));
  for (let i = 1; i <= 60; i++) lesson(db, i, { description: `${'Long lesson text that fills the budget quickly. '.repeat(3)}${i}` });
  const { chosen, left } = select(db, '/w/shop');
  assert.ok(chosen.length < 60 && left === 60 - chosen.length);
  assert.ok(context(chosen, left).length <= BUDGET, `${context(chosen, left).length} characters`);
  assert.match(context(chosen, left), /more lessons did not fit/);
});

test('main prints nothing while learning is off, and the lessons once it is on', (t) => {
  const dir = tmp();
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 's1', cwd: '/w/shop', hook_event_name: 'SessionStart' }, 1);
  lesson(db, 1);
  db.close();
  const out = [];
  t.mock.method(process.stdout, 'write', (s) => out.push(s));
  t.mock.method(console, 'log', () => {});
  main(JSON.stringify({ cwd: '/w/shop' }));
  assert.equal(out.length, 0);
  configMain(['learn', 'on']);
  main(JSON.stringify({ cwd: '/w/shop' }));
  const ctx = JSON.parse(out[0]).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'SessionStart');
  assert.match(ctx.additionalContext, /L1 \(method-error\)/);
  assert.match(fs.readFileSync(path.join(dir, 'learned.md'), 'utf8'), /- L1 \(method-error\)/);
  main('not json');
  assert.equal(out.length, 1);
});

test('the context, overflow line included, never passes the budget', () => {
  const db = openDb(path.join(tmp(), 'brain.db'));
  for (let i = 1; i <= 13; i++) lesson(db, i, { description: `${'x'.repeat(290)}${String(i).padStart(7, '0')}` });
  const { chosen, left } = select(db, '/w/shop');
  assert.ok(left > 0);
  assert.ok(context(chosen, left).length <= BUDGET, `${context(chosen, left).length} characters`);
});
