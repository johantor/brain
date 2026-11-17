// SessionStart, in the foreground: loads the lessons for this project into the session
// as background context, when learning is on (#5). Prints nothing when it is off, when
// there are no lessons, or on any error: a session must start whatever brain does.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectRoot } from './ask.mjs';
import { readConfig } from './config.mjs';
import { dbFile } from './db.mjs';
import { logError } from './capture.mjs';
import { brainDir, isMain } from './paths.mjs';

// About 1,000 tokens. Claude Code caps SessionStart context at 10,000 characters.
export const BUDGET = 4000;

const HEADER = [
  'brain lessons: learned from your past sessions. They are background: CLAUDE.md and the',
  "user's messages win. When one changes what you do, cite its ID, such as (L12).",
].join(' ');

const line = (l) => `- L${l.id} (${l.kind}): ${l.description}`;

// The lessons to load: pinned ones first, then this project's, then global ones, newest
// first in each, until the budget is spent.
export function select(db, root) {
  const rows = db.prepare(`SELECT id, kind, scope, status, description FROM lessons
    WHERE status != 'deprecated' AND (scope = 'global' OR project = ?)
    ORDER BY status = 'stable' DESC, scope = 'project' DESC, created DESC, id DESC`).all(root);
  const chosen = [];
  // Room for the "more did not fit" line, so the whole context stays within BUDGET.
  let used = HEADER.length + more(999999).length;
  for (const r of rows) {
    const cost = line(r).length + 1;
    if (used + cost > BUDGET) break;
    chosen.push(r);
    used += cost;
  }
  return { chosen, left: rows.length - chosen.length };
}

const more = (left) => (left ? `\n(${left} more lessons did not fit the budget.)` : '');

export function context(chosen, left) {
  if (!chosen.length) return null;
  return `${HEADER}\n${chosen.map(line).join('\n')}${more(left)}`;
}

// One line for the user, not for Claude: what changed since the last notice.
export function notice(db, since) {
  const rows = db.prepare('SELECT lesson, action FROM changes WHERE ts > ? ORDER BY id').all(since);
  if (!rows.length) return null;
  const by = {};
  for (const r of rows) (by[r.action] ??= []).push(r.lesson ? `L${r.lesson}` : null);
  const list = (ids) => ids.filter(Boolean);
  const parts = Object.entries(by).map(([action, all]) => {
    const ids = list(all);
    if (!ids.length) return `${action} (${all.length})`;
    return `${action} ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}`;
  });
  return `brain: since the last session, ${parts.join('; ')}. /brain:undo reverses the latest lesson change; /brain:forget S<n> removes a skill.`;
}

// Once, so a user who never turned brain on learns that it is on and how to stop it.
const WELCOME = 'brain is on: it learns from your corrections and loads the lessons at session start. /brain:learn off stops it.';

function welcome() {
  const mark = path.join(brainDir(), '.welcomed');
  if (fs.existsSync(mark)) return null;
  fs.mkdirSync(brainDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(mark, '', { mode: 0o600 });
  return WELCOME;
}

// The lessons and the change line, from the database; nothing when it does not exist yet.
function fromDb(cwd) {
  if (!fs.existsSync(dbFile())) return {};
  // Read-only: a session start never waits on, or blocks, another session's writes.
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 2000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'lessons'").get()) return {};
    const { chosen, left } = select(db, projectRoot(cwd));
    const mark = path.join(brainDir(), '.noticed');
    const since = fs.existsSync(mark) ? fs.statSync(mark).mtimeMs : 0;
    const changed = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'changes'").get() ? notice(db, since) : null;
    if (changed) fs.writeFileSync(mark, '', { mode: 0o600 });
    return { text: context(chosen, left), changed };
  } finally {
    db.close();
  }
}

export function main(input = fs.readFileSync(0, 'utf8')) {
  try {
    if (!readConfig().learn) return;
    const payload = JSON.parse(input);
    if (typeof payload?.cwd !== 'string') return;
    process.umask(0o077);
    const hello = welcome();
    const { text, changed } = fromDb(payload.cwd);
    const note = [hello, changed].filter(Boolean).join(' ');
    const out = {
      ...(note && { systemMessage: note }),
      ...(text && { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }),
    };
    if (note || text) process.stdout.write(JSON.stringify(out));
  } catch (err) {
    // Nothing to load is better than a session that does not start.
    logError(err);
  }
}

if (isMain(process.argv[1], import.meta.url)) main();
