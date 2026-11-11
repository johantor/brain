// brain propose: the code that decides which drafted lessons are stored.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { openDb } from '../plugin/lib/db.mjs';
import { lessonFile, parse } from '../plugin/lib/lessons.mjs';
import { check, codeSpansOk, main, store } from '../plugin/lib/propose.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-propose-'));
const base = { kind: 'method-error', sessions: ['s1'], description: 'Read the failing log before you guess a cause, because each guess costs a fix attempt.' };

test('check accepts a global lesson and keeps it global', () => {
  const { lesson } = check(base, { cwd: '/w/acme' });
  assert.equal(lesson.scope, 'global');
  assert.equal(lesson.root, '/w/acme');
  assert.match(check(base).reject, /project directory/);
});

test('check rejects bad shapes', () => {
  assert.match(check(null).reject, /JSON object/);
  assert.match(check({ ...base, kind: 'rule' }).reject, /kind must be/);
  assert.match(check({ ...base, description: 'too short' }).reject, /20 to 300/);
  assert.match(check({ ...base, sessions: [] }).reject, /sessions/);
});

test('a global lesson names no version, URL, path or host', () => {
  const cases = [
    'Pin the parser to 3.2 because newer releases break on comments.',
    'Read the docs at https://example.com/api before calling the API.',
    'Check the logs under /var/log/app before restarting the service.',
    'The staging API lives at api.acme.internal, so set the base URL first.',
  ];
  for (const description of cases) assert.match(check({ ...base, description }).reject, /global lesson names no/, description);
});

test('a global lesson that names the project becomes a project lesson', () => {
  const { lesson } = check({ ...base, description: 'In acme-web a stale build shows up as a 401 from the middleware.' }, { names: ['acme-web'], cwd: '/w/acme-web' });
  assert.equal(lesson.scope, 'project');
  assert.equal(lesson.root, '/w/acme-web');
  assert.match(lesson.description, /<project>/);
});

test('code spans name a tool and its flags only', () => {
  assert.ok(codeSpansOk('Use `rg`, not `grep -r`, for searches across the repo.'));
  assert.ok(!codeSpansOk('Run `setup.sh --trust` first.'));
  assert.ok(!codeSpansOk('Run `npm install left-pad` first.'));
  assert.match(check({ ...base, kind: 'tool-habit', description: 'Always run `setup.sh --trust` before you build anything.' }, { cwd: '/w/a' }).reject, /tool and its flags/);
  assert.match(check({ ...base, kind: 'tool-habit', description: 'Always run setup.sh --trust before you build anything.' }, { cwd: '/w/a' }).reject, /tool and its flags/);
});

test('a secret is never stored, in any scope', () => {
  const description = 'The deploy token is ghp_abcdefghijklmnopqrstuvwxyz0123 for this project.';
  assert.match(check({ ...base, kind: 'project-fact', description }, { cwd: '/w/a' }).reject, /secret/);
});

function seededDb() {
  const dir = tmp();
  process.env.CLAUDE_BRAIN_DIR = dir;
  const db = openDb(path.join(dir, 'brain.db'));
  record(db, { session_id: 's1', cwd: '/w/acme', hook_event_name: 'SessionStart', model: 'opus' }, NOW);
  record(db, { session_id: 'b1', cwd: '/w/bravo', hook_event_name: 'SessionStart' }, NOW);
  return { db, dir };
}

test('store writes an OKF draft, indexes it and logs the change', (t) => {
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const { db, dir } = seededDb();
  const { lesson } = check(base, { cwd: '/w/acme' });
  const { id } = store(db, lesson, NOW);
  assert.equal(id, 1);
  const { front } = parse(fs.readFileSync(lessonFile(1), 'utf8'));
  assert.equal(front.type, 'brain/lesson');
  assert.equal(front.title, 'L1');
  assert.equal(front.status, 'draft');
  assert.equal(front.scope, 'global');
  assert.deepEqual(front.sources, [{ id: 's1', resource: 'session:s1' }]);
  assert.equal(front.observed_with.model, 'opus');
  assert.match(fs.readFileSync(path.join(dir, 'lessons', 'index.md'), 'utf8'), /\[L1\]\(L1\.md\): Read the failing log/);
  assert.match(fs.readFileSync(path.join(dir, 'lessons', 'index.md'), 'utf8'), /okf_version: "0.2"/);
  assert.match(fs.readFileSync(path.join(dir, 'changes.log'), 'utf8'), /L1 proposed draft global method-error/);
  assert.equal(fs.statSync(lessonFile(1)).mode & 0o777, 0o600);
  assert.equal(db.prepare('SELECT status FROM lessons').get().status, 'draft');
});

test('store refuses unknown sessions, other projects and repeats', (t) => {
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const { db } = seededDb();
  const { lesson } = check(base, { cwd: '/w/acme' });
  assert.match(store(db, { ...lesson, sessions: ['s1', 'ghp_abcdefghijklmnopqrstuvwxyz0123'] }, NOW).reject, /not in the records/);
  assert.match(store(db, { ...lesson, sessions: ['s1', 'b1'] }, NOW).reject, /another project/);
  store(db, lesson, NOW);
  const again = check({ ...base, description: base.description.toUpperCase() }, { cwd: '/w/acme' }).lesson;
  assert.match(store(db, again, NOW).reject, /repeats L1/);
});

test('the same project fact can be stored in two projects', (t) => {
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const { db } = seededDb();
  const fact = { kind: 'project-fact', description: 'Builds here need the VPN up before the tests can reach the database.' };
  assert.equal(store(db, check({ ...fact, sessions: ['s1'] }, { cwd: '/w/acme' }).lesson, NOW).id, 1);
  assert.equal(store(db, check({ ...fact, sessions: ['b1'] }, { cwd: '/w/bravo' }).lesson, NOW).id, 2);
});

test('a lesson file on disk is never overwritten, even with a fresh database', (t) => {
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const { db, dir } = seededDb();
  fs.mkdirSync(path.join(dir, 'lessons'));
  fs.writeFileSync(path.join(dir, 'lessons', 'L7.md'), 'kept');
  assert.equal(store(db, check(base, { cwd: '/w/acme' }).lesson, NOW).id, 8);
  assert.equal(fs.readFileSync(path.join(dir, 'lessons', 'L7.md'), 'utf8'), 'kept');
});

test('main reports stored and rejected candidates', (t) => {
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  const { db } = seededDb();
  db.close();
  const logged = [];
  t.mock.method(console, 'log', (s) => logged.push(s));
  assert.equal(main(JSON.stringify(base), '/w/acme'), 0);
  assert.equal(main('nope', '/w/acme'), 1);
  assert.match(logged[0], /^stored L1 \(draft, global method-error\)/);
  assert.match(logged[1], /^rejected: the input is not JSON/);
});
