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
import { held } from './score.mjs';
import { brainDir, isMain } from './paths.mjs';

// About 1,000 tokens. Claude Code caps SessionStart context at 10,000 characters.
export const BUDGET = 4000;

const HEADER = [
  'brain lessons: learned from your past sessions. They are background: CLAUDE.md and the',
  "user's messages win. When one changes what you do, cite its ID, such as (L12).",
].join(' ');

const line = (l) => `- L${l.id} (${l.kind}): ${l.description}`;

// The lessons to load: pinned ones first, then this project's, then global ones, newest
// first in each, until the budget is spent. A lesson held out for this session is left
// out, so holdout scoring can compare (score.mjs).
export function select(db, root, sid = '', model = '') {
  // The foreground loader may run before the async capture has migrated an old database.
  const modelCol = db.prepare('PRAGMA table_info(lessons)').all().some((c) => c.name === 'model') ? 'model' : 'NULL AS model';
  const rows = db.prepare(`SELECT id, kind, scope, status, ${modelCol}, description FROM lessons
    WHERE status != 'deprecated' AND (scope = 'global' OR project = ?)
    ORDER BY status = 'stable' DESC, scope = 'project' DESC, created DESC, id DESC`).all(root)
    .filter((r) => !sid || !held(sid, r, model));
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
  for (const r of rows) (by[r.action] ??= []).push(`L${r.lesson}`);
  const parts = Object.entries(by).map(([action, ids]) => `${action} ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}`);
  return `brain: since the last session, ${parts.join('; ')}. /brain:undo reverses the latest.`;
}

export function main(input = fs.readFileSync(0, 'utf8')) {
  try {
    if (!readConfig().learn || !fs.existsSync(dbFile())) return;
    const payload = JSON.parse(input);
    if (typeof payload?.cwd !== 'string') return;
    process.umask(0o077);
    // Read-only: a session start never waits on, or blocks, another session's writes.
    const db = new DatabaseSync(dbFile(), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 2000');
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'lessons'").get()) return;
      const str = (v) => (typeof v === 'string' ? v : '');
      const { chosen, left } = select(db, projectRoot(payload.cwd), str(payload.session_id), str(payload.model));
      const text = context(chosen, left);
      const mark = path.join(brainDir(), '.noticed');
      const since = fs.existsSync(mark) ? fs.statSync(mark).mtimeMs : 0;
      const note = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'changes'").get() ? notice(db, since) : null;
      if (note) fs.writeFileSync(mark, '', { mode: 0o600 });
      const out = {
        ...(note && { systemMessage: note }),
        ...(text && { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }),
      };
      if (note || text) process.stdout.write(JSON.stringify(out));
    } finally {
      db.close();
    }
  } catch (err) {
    // Nothing to load is better than a session that does not start.
    logError(err);
  }
}

if (isMain(process.argv[1], import.meta.url)) main();
