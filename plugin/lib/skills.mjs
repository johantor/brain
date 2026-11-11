// Personal skills (#6): when three or more live global lessons name the same tool, a
// clean stop asks Claude to distill them into one skill. `node skills.mjs propose` (JSON
// on stdin) checks the draft like a global lesson and stages it; after a veto window it
// becomes ~/.claude/skills/brain-<name>/SKILL.md. A skill unused for 30 days is retired.
// brain only ever writes, changes or removes `brain-` skills it made.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAY, openDb, tx } from './db.mjs';
import { recordChange } from './lessons.mjs';
import { brainDir, isMain } from './paths.mjs';
import { scrub } from './scrub.mjs';

export const MIN_LESSONS = 3;
export const MAX_SKILLS = 5;
export const VETO_DAYS = 3;
export const UNUSED_DAYS = 30;
const DESCRIPTION_MAX = 200;
const BODY_MAX = 4000;

export function skillsHome() {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(config, 'skills');
}

// Live global lessons grouped by the tools their code spans name (`rg`, `pnpm`).
export function clusters(db) {
  const groups = new Map();
  for (const l of db.prepare("SELECT id, description FROM lessons WHERE scope = 'global' AND status != 'deprecated' ORDER BY id").all()) {
    const tools = new Set([...l.description.matchAll(/`([a-z][\w-]*)/g)].map((m) => m[1]));
    for (const t of tools) groups.set(t, [...(groups.get(t) ?? []), l]);
  }
  return [...groups.entries()].filter(([, ls]) => ls.length >= MIN_LESSONS).map(([tool, lessons]) => ({ tool, lessons }));
}

// The first cluster no skill covers yet, while there is room for one more skill.
export function nextCluster(db) {
  const live = db.prepare("SELECT tool FROM skills WHERE status IN ('pending', 'active')").all().map((r) => r.tool);
  if (live.length >= MAX_SKILLS) return null;
  return clusters(db).find((c) => !live.includes(c.tool)) ?? null;
}

const NOT_ALLOWED = /<(secret|email|ip|url|path|host|project)>/;

// Checks a drafted skill. Returns { skill } or { reject }.
export function checkSkill(c, tool) {
  if (!c || typeof c !== 'object') return { reject: 'the draft must be a JSON object' };
  if (typeof c.name !== 'string' || !/^[a-z][a-z0-9-]{2,30}$/.test(c.name)) return { reject: 'name must be 3 to 31 lowercase letters, digits or hyphens' };
  if (typeof c.description !== 'string' || !c.description.trim() || c.description.length > DESCRIPTION_MAX) {
    return { reject: `description must be one line of at most ${DESCRIPTION_MAX} characters` };
  }
  if (typeof c.body !== 'string' || !c.body.trim() || c.body.length > BODY_MAX) return { reject: `body must be prose of at most ${BODY_MAX} characters` };
  const description = scrub(c.description.replace(/\s+/g, ' ').trim());
  const body = scrub(c.body.trim());
  // Frontmatter is brain's to write: a body cannot open a second block or reach outside.
  if (/^---\s*$/m.test(body) || /^\s*(allowed-tools|hooks|model)\s*:/im.test(body)) return { reject: 'the body may not hold frontmatter or tool settings' };
  if (NOT_ALLOWED.test(description) || NOT_ALLOWED.test(body)) return { reject: 'a skill names no URL, path, host, project or secret' };
  return { skill: { name: c.name, tool, description, body } };
}

export function render(s) {
  return `---\nname: brain-${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body}\n`;
}

function stagingFile(name) {
  return path.join(brainDir(), 'skills', `brain-${name}`, 'SKILL.md');
}

function installedDir(name) {
  return path.join(skillsHome(), `brain-${name}`);
}

export function propose(db, draft, now = Date.now()) {
  const cluster = nextCluster(db);
  if (!cluster) return { reject: 'no group of lessons is waiting for a skill' };
  const checked = checkSkill(draft, cluster.tool);
  if (checked.reject) return checked;
  const s = checked.skill;
  if (db.prepare('SELECT 1 FROM skills WHERE name = ?').get(s.name)) return { reject: `a skill named brain-${s.name} exists` };
  if (fs.existsSync(installedDir(s.name))) return { reject: `${installedDir(s.name)} exists and is not brain's` };
  return tx(db, () => {
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO skills (name, tool, description, body, status, created)
      VALUES (?, ?, ?, ?, 'pending', ?)`).run(s.name, s.tool, s.description, s.body, now);
    fs.mkdirSync(path.dirname(stagingFile(s.name)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(stagingFile(s.name), render(s), { mode: 0o600 });
    recordChange(db, { lesson: 0, action: 'skill drafted', now, note: `S${id} brain-${s.name}, active in ${VETO_DAYS} days unless forgotten` });
    return { id: Number(id), name: s.name };
  });
}

// Activates pending skills past the veto window, and retires active ones unused for 30
// days. Use is a Skill tool call naming the skill (capture.mjs records it).
export function lifecycle(db, now = Date.now()) {
  for (const s of db.prepare("SELECT * FROM skills WHERE status = 'pending' AND created <= ?").all(now - VETO_DAYS * DAY)) {
    tx(db, () => {
      if (fs.existsSync(installedDir(s.name))) return;
      fs.mkdirSync(installedDir(s.name), { recursive: true });
      fs.writeFileSync(path.join(installedDir(s.name), 'SKILL.md'), render(s));
      db.prepare("UPDATE skills SET status = 'active', activated = ? WHERE id = ?").run(now, s.id);
      recordChange(db, { lesson: 0, action: 'skill activated', now, note: `S${s.id} brain-${s.name}` });
    });
  }
  for (const s of db.prepare("SELECT * FROM skills WHERE status = 'active'").all()) {
    const used = db.prepare("SELECT max(ts) AS t FROM events WHERE kind = 'tool_ok' AND tool = 'Skill' AND text = ?").get(`brain-${s.name}`).t;
    if (Math.max(used ?? 0, s.activated) > now - UNUSED_DAYS * DAY) continue;
    tx(db, () => retireSkill(db, s, 'unused for 30 days', now));
  }
}

function retireSkill(db, s, reason, now) {
  // Only a folder brain wrote: its SKILL.md must still name brain's skill.
  const file = path.join(installedDir(s.name), 'SKILL.md');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(`name: brain-${s.name}\n`)) fs.rmSync(installedDir(s.name), { recursive: true });
  db.prepare("UPDATE skills SET status = 'retired' WHERE id = ?").run(s.id);
  recordChange(db, { lesson: 0, action: 'skill retired', now, note: `S${s.id} brain-${s.name}: ${reason}` });
}

export function forgetSkill(db, id, now = Date.now()) {
  const s = db.prepare("SELECT * FROM skills WHERE id = ? AND status != 'retired'").get(id);
  if (!s) return `no live skill S${id}`;
  retireSkill(db, s, 'forgotten', now);
  return `forgot S${id} brain-${s.name}`;
}

export function main(argv = process.argv.slice(2), input) {
  const [action, ref] = argv;
  const db = openDb();
  try {
    if (action === 'propose') {
      let draft;
      try {
        draft = JSON.parse(input ?? fs.readFileSync(0, 'utf8'));
      } catch {
        console.log('rejected: the input is not JSON');
        return 1;
      }
      const out = propose(db, draft);
      console.log(out.reject ? `rejected: ${out.reject}` : `staged S${out.id} brain-${out.name}: active in ${VETO_DAYS} days unless forgotten`);
      return out.reject ? 1 : 0;
    }
    const id = Number(/^S?(\d+)$/i.exec(ref ?? '')?.[1]);
    if (action === 'forget' && id) {
      console.log(`brain: ${tx(db, () => forgetSkill(db, id))}`);
      return 0;
    }
    console.error('usage: skills.mjs propose < draft.json | forget S<n>');
    return 2;
  } finally {
    db.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
