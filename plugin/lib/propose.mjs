// `node propose.mjs` with one JSON candidate on stdin: the code that decides whether a
// lesson the agent drafted is stored. The agent proposes; this file decides (#3,
// "Propose"). Phase 2 stores every accepted lesson as `draft`: nothing loads.
import fs from 'node:fs';
import { tx, openDb } from './db.mjs';
import { KINDS, maxFileId, recordChange, writeLesson } from './lessons.mjs';
import { isMain } from './paths.mjs';
import { projectRoot } from './ask.mjs';
import { projectNames, scrub } from './scrub.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;

// Placeholders scrub() leaves. A global lesson keeps none; a project lesson keeps
// none of the dangerous ones.
const NEVER = /<(secret|email|ip)>/;
const NOT_GLOBAL = /<(secret|email|ip|url|path|host|project)>/;
const VERSION_RE = /\b\d+\.\d+(?:\.\d+)?\b/;
// A script by name, with or without backticks: `setup.sh`, deploy.ps1.
const SCRIPT_RE = /\b[\w-]+\.(?:sh|bash|zsh|ps1|psm1|bat|cmd|exe|py|rb|pl|js|mjs|cjs|ts)\b/i;

// A code span names a tool and its flags, never a script or arguments: `rg`, `grep -r`.
// That blocks an injected `setup.sh --trust` from becoming a global habit.
export function codeSpansOk(text) {
  for (const [, code] of text.matchAll(/`([^`]*)`/g)) {
    const [tool, ...rest] = code.trim().split(/\s+/);
    if (!/^[a-z][\w-]*$/.test(tool) || rest.some((w) => !/^--?[\w-]+$/.test(w))) return false;
  }
  return true;
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Checks one candidate. Returns { lesson } or { reject: reason }.
export function check(c, { names = [], cwd } = {}) {
  if (!c || typeof c !== 'object') return { reject: 'the candidate must be a JSON object' };
  if (!KINDS.includes(c.kind)) return { reject: `kind must be one of ${KINDS.join(', ')}` };
  if (typeof c.description !== 'string') return { reject: 'description must be a string' };
  const raw = c.description.trim().replace(/\s+/g, ' ');
  if (raw.length < 20 || raw.length > 300) return { reject: 'description must be one statement of 20 to 300 characters' };
  if (!Array.isArray(c.sessions) || !c.sessions.length || !c.sessions.every((s) => typeof s === 'string')) {
    return { reject: 'sessions must list the session ids the lesson comes from' };
  }
  const text = scrub(raw, names);
  if (NEVER.test(text)) return { reject: 'it holds a secret, an e-mail address or an IP address' };
  let scope = c.kind === 'project-fact' ? 'project' : 'global';
  // A global lesson states the learning, not the incident (#3, "What it learns").
  if (scope === 'global' && (NOT_GLOBAL.test(text) || VERSION_RE.test(text))) {
    if (/<(url|path|host)>/.test(text) || VERSION_RE.test(text)) {
      return { reject: 'a global lesson names no version, URL, path or host: state the learning, not the incident' };
    }
    scope = 'project';
  }
  if (scope === 'global' && (!codeSpansOk(text) || SCRIPT_RE.test(text))) {
    return { reject: 'a global lesson may name a tool and its flags, not a script or a command with arguments' };
  }
  if (!cwd) return { reject: 'the project directory is required' };
  return { lesson: { description: text, kind: c.kind, scope, root: projectRoot(cwd), sessions: [...new Set(c.sessions)] } };
}

// Stores a checked lesson as a draft. Every session must be in the records and in the
// proposing project, so ids stay ids and one client's session never feeds another's
// lesson. A repeat in the same scope and project is refused.
export function store(db, lesson, now = Date.now()) {
  const where = db.prepare('SELECT cwd, model, version, last FROM sessions WHERE sid = ?');
  const rows = lesson.sessions.map((s) => where.get(s));
  if (rows.some((r) => !r)) return { reject: 'a session is not in the records' };
  if (rows.some((r) => !r.cwd || projectRoot(r.cwd) !== lesson.root)) return { reject: 'a session belongs to another project' };
  const project = lesson.scope === 'project' ? lesson.root : null;
  const key = `${lesson.scope}:${project ?? ''}:${normalize(lesson.description)}`;
  const latest = rows.filter((r) => r.model).sort((a, b) => b.last - a.last)[0];
  return tx(db, () => {
    // Inside the write lock, so two proposals cannot both pass the check.
    const dup = db.prepare('SELECT id FROM lessons WHERE key = ?').get(key);
    if (dup) return { reject: `it repeats L${dup.id}` };
    // The files are the source of truth: never reuse a number a file already holds.
    const id = Math.max(db.prepare('SELECT coalesce(max(id), 0) AS m FROM lessons').get().m, maxFileId()) + 1;
    db.prepare(`INSERT INTO lessons (id, key, description, kind, scope, project, status, created)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`).run(id, key, lesson.description, lesson.kind, lesson.scope, project, now);
    recordChange(db, { lesson: id, action: 'proposed', now, note: `draft ${lesson.scope} ${lesson.kind}: ${lesson.description}` });
    // Last, so a failure before it leaves no file behind.
    writeLesson({
      id,
      description: lesson.description,
      kind: lesson.kind,
      scope: lesson.scope,
      project,
      status: 'draft',
      by: `brain/${VERSION}`,
      at: new Date(now).toISOString(),
      sources: lesson.sessions.map((s, i) => ({ id: `s${i + 1}`, resource: `session:${s}` })),
      observedWith: { claude_code: latest?.version ?? null, model: latest?.model ?? null },
    }, db.prepare('SELECT id, description FROM lessons ORDER BY id').all());
    return { id };
  });
}

export function main(input = fs.readFileSync(0, 'utf8'), cwd = process.cwd()) {
  let candidate;
  try {
    candidate = JSON.parse(input);
  } catch {
    console.log('rejected: the input is not JSON');
    return 1;
  }
  const checked = check(candidate, { names: projectNames(cwd), cwd });
  if (checked.reject) {
    console.log(`rejected: ${checked.reject}`);
    return 1;
  }
  const db = openDb();
  try {
    const stored = store(db, checked.lesson);
    if (stored.reject) {
      console.log(`rejected: ${stored.reject}`);
      return 1;
    }
    console.log(`stored L${stored.id} (draft, ${checked.lesson.scope} ${checked.lesson.kind}): ${checked.lesson.description}`);
    return 0;
  } finally {
    db.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
