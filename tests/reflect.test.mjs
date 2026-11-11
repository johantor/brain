// The Stop hook's decision: reflect at the first clean stop after friction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record } from '../plugin/lib/capture.mjs';
import { main as configMain, readConfig } from '../plugin/lib/config.mjs';
import { openDb } from '../plugin/lib/db.mjs';
import { MAX_PER_SESSION, decide } from '../plugin/lib/reflect.mjs';
import { scan } from '../plugin/lib/scan.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-reflect-'));
const freshDb = () => openDb(path.join(tmp(), 'brain.db'));

// A session in /w/shop driven one hook at a time, at increasing timestamps.
function session(db, sid = 's1', cwd = '/w/shop') {
  let t = NOW;
  const hook = (p) => record(db, { session_id: sid, cwd, ...p }, (t += 1000));
  return {
    prompt: (text) => hook({ hook_event_name: 'UserPromptSubmit', prompt: text }),
    fail: () => hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' }),
    ok: () => hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test -- --fix' } }),
    stop: (extra = {}) => decide(db, { session_id: sid, ...extra }, { enabled: true, now: (t += 1000) }),
  };
}

test('off by default, and nothing without friction', () => {
  const db = freshDb();
  const s = session(db);
  s.prompt('add a cart');
  s.fail();
  s.prompt('go on');
  s.ok();
  assert.equal(decide(db, { session_id: 's1' }, { enabled: false }), null);
  const clean = session(freshDb());
  clean.prompt('add a cart');
  clean.ok();
  assert.equal(clean.stop(), null);
});

test('waits while the trouble lasts, then reflects once at the first clean stop', () => {
  const db = freshDb();
  const s = session(db);
  s.prompt('add a cart');
  s.fail();
  assert.equal(s.stop(), null, 'the failure is in this turn');
  s.prompt('try again');
  s.ok();
  const context = s.stop();
  assert.match(context, /a failed npm/);
  assert.match(context, /brain:reflect/);
  assert.match(context, /propose\.mjs/);
  s.prompt('next task');
  s.ok();
  assert.equal(s.stop(), null, 'that friction is already reflected on');
});

test('a correction opens its turn, so that turn can end clean', () => {
  const db = freshDb();
  const s = session(db);
  s.prompt('no, use pnpm here');
  s.ok();
  assert.match(s.stop(), /a correction from the user/);
});

test('stop_hook_active, background tasks and the per-session cap all skip', () => {
  const db = freshDb();
  const s = session(db);
  s.prompt('no, not like that');
  assert.equal(s.stop({ stop_hook_active: true }), null);
  assert.equal(s.stop({ background_tasks: [{ id: 'b1' }] }), null);
  for (let i = 0; i < MAX_PER_SESSION; i++) {
    s.prompt('wrong again');
    assert.ok(s.stop(), `reflection ${i + 1}`);
  }
  s.prompt('wrong once more');
  assert.equal(s.stop(), null);
});

test('a clean session takes one queued session of the same project', () => {
  const db = freshDb();
  const old = session(db, 'old', '/w/shop/api');
  old.prompt('no, that is the wrong table');
  db.prepare("INSERT INTO queue (sid, reason, ts) VALUES ('old', 'no-end', ?)").run(NOW);
  const other = session(db, 'far', '/w/elsewhere');
  other.prompt('no');
  db.prepare("INSERT INTO queue (sid, reason, ts) VALUES ('far', 'no-end', ?)").run(NOW);
  const now = session(db, 'new', '/w/shop/api');
  now.prompt('add a cart');
  now.ok();
  const context = now.stop();
  assert.match(context, /earlier session in this project \(old\)/);
  assert.deepEqual(db.prepare('SELECT sid FROM queue').all().map((r) => r.sid), ['far']);
  assert.equal(now.stop(), null, 'one per stop, and the queued one is marked');
  const kinds = db.prepare("SELECT sid, kind FROM events WHERE kind IN ('reflect', 'reflected') ORDER BY sid").all().map((r) => `${r.sid}:${r.kind}`);
  assert.deepEqual(kinds, ['new:reflect', 'old:reflected'], 'only the session that runs it counts a reflection');
});

test('the scan stores what each reflection cost', async () => {
  const db = freshDb();
  const dir = tmp();
  const s = session(db);
  s.prompt('no, use pnpm');
  s.ok();
  const reflectAt = NOW + 10_000;
  decide(db, { session_id: 's1' }, { enabled: true, now: reflectAt });
  record(db, { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'next' }, reflectAt + 5000);
  const at = (ms) => new Date(ms).toISOString();
  const reply = (id, t, out) => JSON.stringify({ type: 'assistant', timestamp: at(t), message: { id, model: 'opus', usage: { input_tokens: 10, output_tokens: out } } });
  const pdir = path.join(dir, '-w-shop');
  fs.mkdirSync(pdir);
  fs.writeFileSync(path.join(pdir, 's1.jsonl'), [reply('before', reflectAt - 1, 500), reply('r1', reflectAt + 100, 40), reply('r2', reflectAt + 200, 50), reply('after', reflectAt + 9000, 900)].join('\n'));
  await scan(db, dir, reflectAt + 20_000);
  assert.equal(db.prepare("SELECT code FROM events WHERE kind = 'reflect'").get().code, 110);
});

test('config: reflect is off until turned on', (t) => {
  process.env.CLAUDE_BRAIN_DIR = tmp();
  t.after(() => delete process.env.CLAUDE_BRAIN_DIR);
  t.mock.method(console, 'log', () => {});
  assert.equal(readConfig().reflect, false);
  assert.equal(configMain(['reflect', 'on']), 0);
  assert.equal(readConfig().reflect, true);
  assert.equal(configMain(['reflect', 'maybe']), 2);
});
