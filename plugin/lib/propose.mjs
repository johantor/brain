// `node propose.mjs` with one JSON candidate on stdin: the code that decides whether a
// lesson the agent drafted is stored. The agent proposes; this file decides (#3,
// "Propose"). Phase 2 stores every accepted lesson as `draft`: nothing loads.
import fs from 'node:fs';
import { tx, openDb } from './db.mjs';
import { KINDS, logChange, writeLesson } from './lessons.mjs';
import { isMain } from './paths.mjs';
import { projectRoot } from './ask.mjs';
import { projectNames, scrub } from './scrub.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;

// Placeholders scrub() leaves. A global lesson keeps none; a project lesson keeps
// none of the dangerous ones.
const NEVER = /<(secret|email|ip)>/;
const NOT_GLOBAL = /<(secret|email|ip|url|path|host|project)>/;
const VERSION_RE = /\b\d+\.\d+(?:\.\d+)?\b/;

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
    return { reject: 'sessions must list the session ids the evidence comes from' };
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
  if (scope === 'global' && !codeSpansOk(text)) {
    return { reject: 'a global lesson may name a tool and its flags, not a script or a command with arguments' };
  }
  if (scope === 'project' && !cwd) return { reject: 'a project lesson needs the project directory' };
  const evidence = typeof c.evidence === 'string' ? scrub(c.evidence, names).slice(0, 2000) : '';
  return { lesson: { description: text, kind: c.kind, scope, project: scope === 'project' ? projectRoot(cwd) : null, evidence, sessions: c.sessions } };
}

// Stores a checked lesson as a draft. A known session is required, and a lesson that
// says the same as one already stored is refused.
export function store(db, lesson, now = Date.now()) {
  const known = db.prepare('SELECT count(*) AS n FROM sessions WHERE sid = ?');
  if (!lesson.sessions.some((s) => known.get(s).n)) return { reject: 'none of the sessions is in the records' };
  const key = normalize(lesson.description);
  const dup = db.prepare('SELECT id FROM lessons WHERE key = ?').get(key);
  if (dup) return { reject: `it repeats L${dup.id}` };
  const model = db.prepare(`SELECT model, version FROM sessions WHERE sid IN (${lesson.sessions.map(() => '?').join(',')})
    AND model IS NOT NULL ORDER BY last DESC LIMIT 1`).get(...lesson.sessions);
  return tx(db, () => {
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO lessons (key, description, kind, scope, project, status, created)
      VALUES (?, ?, ?, ?, ?, 'draft', ?)`).run(key, lesson.description, lesson.kind, lesson.scope, lesson.project, now);
    writeLesson({
      ...lesson,
      id,
      status: 'draft',
      by: `brain/${VERSION}`,
      at: new Date(now).toISOString(),
      sources: lesson.sessions.map((s, i) => ({ id: `s${i + 1}`, resource: `session:${s}` })),
      observedWith: { claude_code: model?.version ?? null, model: model?.model ?? null },
    });
    logChange(`L${id} proposed draft ${lesson.scope} ${lesson.kind}: ${lesson.description}`, now);
    return { id: Number(id) };
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
