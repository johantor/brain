// The `brain` skill's query command: read-only, scoped to the current project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { MAX_ROWS, ask, main, projectRoot } from '../plugin/lib/ask.mjs';
import { record } from '../plugin/lib/capture.mjs';
import { openDb } from '../plugin/lib/db.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ask-'));

// seeded() -> a read-only connection over sessions in /w/shop, /w/shop/api, /w/shop-two and /w/other
function seeded() {
  const file = path.join(tmp(), 'brain.db');
  const db = openDb(file);
  for (const [sid, cwd] of [['a', '/w/shop'], ['b', '/w/shop/api'], ['c', '/w/shop-two'], ['d', '/w/other']]) {
    record(db, { session_id: sid, cwd, hook_event_name: 'UserPromptSubmit', prompt: `in ${sid}` }, 1000);
  }
  db.close();
  return new DatabaseSync(file, { readOnly: true });
}

test('my_* views hold only the current project and its subfolders', () => {
  const db = seeded();
  assert.equal(ask(db, 'SELECT group_concat(sid) AS s FROM (SELECT sid FROM my_events ORDER BY sid)', { root: '/w/shop' }), 's\na,b');
  assert.equal(ask(db, 'SELECT count(*) AS n FROM my_sessions', { root: '/w/none' }), 'n\n0');
});

test('--all reads every project through the base tables', () => {
  const db = seeded();
  assert.equal(ask(db, 'SELECT count(*) AS n FROM sessions', { all: true }), 'n\n4');
});

test('only a SELECT runs, and the connection cannot write', () => {
  const db = seeded();
  assert.throws(() => ask(db, 'DELETE FROM events', { root: '/w/shop' }), /only one SELECT/);
  assert.throws(() => ask(db, "WITH x AS (SELECT 1) INSERT INTO queue VALUES ('a', 'end', 1)", { all: true }), /readonly/);
});

test('rows are capped and cells are flattened', () => {
  const db = seeded();
  const out = ask(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_ROWS + 5}) SELECT i, 'a' || char(10) || 'b' AS t FROM n`, { all: true });
  const lines = out.split('\n');
  assert.equal(lines.length, MAX_ROWS + 2);
  assert.equal(lines[1], '1\ta b');
  assert.match(lines.at(-1), /5 more rows/);
  assert.equal(ask(db, 'SELECT 1 WHERE 0', { all: true }), '(no rows)');
});

test('projectRoot is the nearest folder with .git', () => {
  const root = path.join(tmp(), 'repo');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  assert.equal(projectRoot(path.join(root, 'src', 'deep')), root);
  const loose = tmp();
  assert.equal(projectRoot(loose), loose);
});

test('main reads the query with and without --cwd and --all', (t) => {
  const dir = tmp();
  process.env.CLAUDE_BRAIN_DIR = dir;
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 'a', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, 1);
  db.close();
  const logged = [];
  t.mock.method(console, 'log', (s) => logged.push(s));
  assert.equal(main(['SELECT count(*) AS n FROM my_events']), 0);
  assert.equal(main(['--cwd', '/w/shop', 'SELECT count(*) AS n FROM my_events']), 0);
  assert.equal(main(['SELECT count(*) AS n FROM events', '--all']), 0);
  assert.deepEqual(logged, ['n\n0', 'n\n1', 'n\n1']);
});
