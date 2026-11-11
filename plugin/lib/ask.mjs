// `node ask.mjs [--all] [--cwd DIR] "<SELECT ...>"`: runs one read-only query for the
// `brain` skill and prints the rows as tab-separated text. The connection is opened
// read-only, so a query cannot change the records whatever Claude writes.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbFile } from './db.mjs';
import { isMain } from './paths.mjs';

export const MAX_ROWS = 200;
const CELL = 300;

// The project a session belongs to: the nearest folder with a `.git`, else the folder.
export function projectRoot(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return path.resolve(dir);
    d = parent;
  }
}

// `my_*` views hold the current project's rows, so answers stay in one client's
// project unless the user asks across projects (#3, "Data hygiene").
function scopeViews(db, root) {
  const inScope = "cwd = $root OR substr(cwd, 1, length($root) + 1) IN ($root || '/', $root || '\\')";
  const sids = db.prepare(`SELECT sid FROM sessions WHERE ${inScope}`).all({ root }).map((r) => r.sid);
  const list = sids.map((s) => `'${s.replace(/'/g, "''")}'`).join(',') || "''";
  for (const v of ['my_sessions', 'my_events', 'my_denials', 'my_queue', 'my_lessons']) db.exec(`DROP VIEW IF EXISTS temp.${v}`);
  db.exec(`CREATE TEMP VIEW my_lessons AS SELECT * FROM main.lessons
    WHERE scope = 'global' OR project = '${root.replace(/'/g, "''")}'`);
  db.exec(`
    CREATE TEMP VIEW my_sessions AS SELECT * FROM main.sessions WHERE sid IN (${list});
    CREATE TEMP VIEW my_events AS SELECT * FROM main.events WHERE sid IN (${list});
    CREATE TEMP VIEW my_denials AS SELECT * FROM main.denials WHERE sid IN (${list});
    CREATE TEMP VIEW my_queue AS SELECT * FROM main.queue WHERE sid IN (${list});`);
}

const cell = (v) => {
  const s = v === null ? '' : String(v).replace(/\s+/g, ' ');
  return s.length > CELL ? `${s.slice(0, CELL - 1)}…` : s;
};

export function ask(db, sql, { root, all = false } = {}) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('only one SELECT or WITH query is allowed');
  if (!all) scopeViews(db, root);
  // Iterate, so a query over every event holds at most MAX_ROWS rows in memory.
  const rows = [];
  let more = 0;
  for (const row of db.prepare(sql).iterate()) {
    if (rows.length < MAX_ROWS) rows.push(row);
    else more++;
  }
  if (!rows.length) return '(no rows)';
  const cols = Object.keys(rows[0]);
  const out = [cols.join('\t'), ...rows.map((r) => cols.map((c) => cell(r[c])).join('\t'))];
  if (more) out.push(`(${more} more rows; add a LIMIT or aggregate)`);
  return out.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const all = args.includes('--all');
  let cwd = process.cwd();
  const at = args.indexOf('--cwd');
  if (at >= 0) cwd = args.splice(at, 2)[1] ?? cwd;
  const sql = args.filter((a) => a !== '--all').join(' ');
  if (!sql) {
    console.error('usage: ask.mjs [--all] [--cwd DIR] "<SELECT ...>"');
    return 2;
  }
  if (!fs.existsSync(dbFile())) {
    console.log('brain: no records yet. Start a Claude Code session first.');
    return 0;
  }
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    console.log(ask(db, sql, { root: projectRoot(cwd), all }));
    return 0;
  } catch (err) {
    console.error(`brain: ${err.message}`);
    return 1;
  } finally {
    db.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
