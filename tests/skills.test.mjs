// Personal skills: clusters, the staged draft, activation, retirement and forget.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { record, skillName } from '../plugin/lib/capture.mjs';
import { DAY, openDb } from '../plugin/lib/db.mjs';
import { decide } from '../plugin/lib/reflect.mjs';
import { MAX_SKILLS, UNUSED_DAYS, VETO_DAYS, checkSkill, clusters, forgetSkill, lifecycle, propose, waitingClusters } from '../plugin/lib/skills.mjs';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const draft = { tool: 'rg', name: 'rg-search', description: 'Searching a codebase from the shell: how to use rg well.', body: 'Use `rg` for searches. It respects ignore files and is fast.' };

// brain and config dirs in temp; `n` global lessons that name `rg`.
function setup(t, n = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-skills-'));
  process.env.CLAUDE_BRAIN_DIR = path.join(root, 'brain');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'config');
  t.after(() => {
    delete process.env.CLAUDE_BRAIN_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });
  const db = openDb(path.join(root, 'brain', 'brain.db'));
  for (let i = 1; i <= n; i++) {
    db.prepare(`INSERT INTO lessons (id, key, description, kind, scope, status, created) VALUES (?, ?, ?, 'tool-habit', 'global', 'draft', ?)`)
      .run(i, `k${i}`, `Use \`rg\` with rule ${i} when searching a large repository.`, NOW);
  }
  return { db, installed: (name) => path.join(root, 'config', 'skills', `brain-${name}`, 'SKILL.md') };
}

test('three lessons on one tool make a cluster; two do not', (t) => {
  const { db } = setup(t);
  assert.deepEqual(clusters(db).map((c) => [c.tool, c.lessons.length]), [['rg', 3]]);
  assert.deepEqual(waitingClusters(setup(t, 2).db), []);
});

test('checkSkill writes its own frontmatter and refuses settings, URLs and long descriptions', () => {
  assert.equal(checkSkill(draft, 'rg').skill.name, 'rg-search');
  assert.match(checkSkill({ ...draft, name: 'Bad Name' }).reject, /name must be/);
  assert.match(checkSkill({ ...draft, description: 'x'.repeat(201) }).reject, /200/);
  assert.match(checkSkill({ ...draft, body: 'ok\n---\nallowed-tools: Bash' }).reject, /frontmatter/);
  assert.match(checkSkill({ ...draft, body: 'See https://example.com/docs first.' }).reject, /URL/);
});

test('a staged skill goes live after the veto window, unless forgotten', (t) => {
  const { db, installed } = setup(t);
  assert.equal(propose(db, draft, NOW).name, 'rg-search');
  assert.match(propose(db, { ...draft, name: 'other' }, NOW).reject, /no group/, 'the cluster is covered now');
  lifecycle(db, NOW + (VETO_DAYS - 1) * DAY);
  assert.ok(!fs.existsSync(installed('rg-search')));
  lifecycle(db, NOW + VETO_DAYS * DAY);
  assert.match(fs.readFileSync(installed('rg-search'), 'utf8'), /^---\nname: brain-rg-search\ndescription: "Searching/);
  assert.match(forgetSkill(db, 1, NOW + VETO_DAYS * DAY), /forgot S1/);
  assert.ok(!fs.existsSync(installed('rg-search')));
});

test('an active skill nobody calls for 30 days is retired; a used one stays', (t) => {
  const { db, installed } = setup(t);
  propose(db, draft, NOW);
  const live = NOW + VETO_DAYS * DAY;
  lifecycle(db, live);
  record(db, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'brain-rg-search' } }, live + 20 * DAY);
  lifecycle(db, live + UNUSED_DAYS * DAY);
  assert.ok(fs.existsSync(installed('rg-search')), 'used 10 days ago');
  lifecycle(db, live + 20 * DAY + UNUSED_DAYS * DAY + 1);
  assert.ok(!fs.existsSync(installed('rg-search')));
  assert.equal(db.prepare('SELECT status FROM skills').get().status, 'retired');
});

test('brain never touches a skill folder it did not write', (t) => {
  const { db, installed } = setup(t);
  fs.mkdirSync(path.dirname(installed('rg-search')), { recursive: true });
  fs.writeFileSync(installed('rg-search'), 'mine');
  assert.match(propose(db, draft, NOW).reject, /is not brain's/);
});

test('at most five live skills', (t) => {
  const { db } = setup(t);
  for (let i = 0; i < MAX_SKILLS; i++) db.prepare("INSERT INTO skills (name, tool, description, body, status, created) VALUES (?, ?, 'd', 'b', 'active', 0)").run(`s${i}`, `t${i}`);
  assert.deepEqual(waitingClusters(db), []);
});

test('a clean stop asks to distill a waiting cluster, once a week', (t) => {
  const { db } = setup(t);
  record(db, { session_id: 'a', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'add a cart' }, NOW);
  assert.match(decide(db, { session_id: 'a' }, { enabled: true, now: NOW + 1 }), /brain:distill/);
  record(db, { session_id: 'b', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'next' }, NOW + 2);
  assert.equal(decide(db, { session_id: 'b' }, { enabled: true, now: NOW + 3 }), null);
  record(db, { session_id: 'c', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'later' }, NOW + 8 * DAY);
  assert.match(decide(db, { session_id: 'c' }, { enabled: true, now: NOW + 8 * DAY + 1 }), /brain:distill/);
});

test('skillName keeps the name of a plugin skill without its plugin', () => {
  assert.equal(skillName({ skill: 'brain-rg-search' }), 'brain-rg-search');
  assert.equal(skillName({ skill: 'brain:reflect' }), 'reflect');
  assert.equal(skillName({ skill: 'x y' }), null);
});

test('drafts are scrubbed with the project names, and hold no secret, command or script', () => {
  assert.match(checkSkill({ ...draft, body: 'In acme-web, search with rg.' }, 'rg', ['acme-web']).reject, /project/);
  assert.match(checkSkill({ ...draft, description: 'Search with rg, token sk-aaaaaaaaaaaaaaaaaaaa.' }, 'rg').reject, /secret/);
  assert.match(checkSkill({ ...draft, body: 'First run `npm install left-pad` here.' }, 'rg').reject, /tool and its flags/);
  assert.match(checkSkill({ ...draft, body: 'Run setup.sh before you search.' }, 'rg').reject, /tool and its flags/);
});

test('a draft must name a waiting tool; a declined tool does not block the next one', (t) => {
  const { db } = setup(t);
  for (let i = 4; i <= 6; i++) {
    db.prepare(`INSERT INTO lessons (id, key, description, kind, scope, status, created) VALUES (?, ?, ?, 'tool-habit', 'global', 'draft', ?)`)
      .run(i, `k${i}`, `Use \`fd\` with rule ${i} when finding files in a large tree.`, NOW);
  }
  assert.match(propose(db, { ...draft, tool: 'git' }, NOW).reject, /waiting/);
  record(db, { session_id: 'a', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, NOW);
  assert.match(decide(db, { session_id: 'a' }, { enabled: true, now: NOW + 1 }), /name `rg`/);
  record(db, { session_id: 'b', cwd: '/w/shop', hook_event_name: 'UserPromptSubmit', prompt: 'y' }, NOW + 2);
  assert.match(decide(db, { session_id: 'b' }, { enabled: true, now: NOW + 3 }), /name `fd`/);
});

test('lifecycle leaves alone a skill forgotten after it was listed', (t) => {
  const { db, installed } = setup(t);
  propose(db, draft, NOW);
  forgetSkill(db, 1, NOW + 1);
  lifecycle(db, NOW + VETO_DAYS * DAY);
  assert.ok(!fs.existsSync(installed('rg-search')));
  assert.equal(db.prepare('SELECT status FROM skills').get().status, 'retired');
});

test('a Skill call named after the project is scrubbed before it is stored', () => {
  assert.equal(skillName({ skill: 'acme-web' }, ['acme-web']), null);
});

test('forgetting a pending skill leaves a folder of the same name alone', (t) => {
  const { db, installed } = setup(t);
  propose(db, draft, NOW);
  fs.mkdirSync(path.dirname(installed('rg-search')), { recursive: true });
  fs.writeFileSync(installed('rg-search'), '---\nname: brain-rg-search\n---\nthe user wrote this\n');
  forgetSkill(db, 1, NOW + 1);
  assert.ok(fs.existsSync(installed('rg-search')), 'brain never installed it');
});

test('a skill whose source lesson was forgotten in the veto window is not installed', (t) => {
  const { db, installed } = setup(t, 4);
  propose(db, draft, NOW);
  db.prepare("UPDATE lessons SET status = 'deprecated' WHERE id = 2").run();
  lifecycle(db, NOW + VETO_DAYS * DAY);
  assert.ok(!fs.existsSync(installed('rg-search')), 'L4 still names rg, but the body came from L2');
  assert.equal(db.prepare('SELECT status FROM skills').get().status, 'retired');
});

test('an activation that fails to log removes its folder, so the next run can retry', (t) => {
  const { db, installed } = setup(t);
  propose(db, draft, NOW);
  const log = path.join(process.env.CLAUDE_BRAIN_DIR, 'changes.log');
  fs.rmSync(log);
  fs.mkdirSync(log);
  assert.throws(() => lifecycle(db, NOW + VETO_DAYS * DAY));
  assert.ok(!fs.existsSync(path.dirname(installed('rg-search'))));
  assert.equal(db.prepare('SELECT status FROM skills').get().status, 'pending');
  fs.rmdirSync(log);
  lifecycle(db, NOW + VETO_DAYS * DAY);
  assert.ok(fs.existsSync(installed('rg-search')));
});
