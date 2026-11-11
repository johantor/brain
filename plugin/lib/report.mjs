// `node report.mjs [--days N]`: what brain recorded, per project, so phase 1's gate
// ("the records look right") can be checked without a SQLite client.
import fs from 'node:fs';
import path from 'node:path';
import { DAY, dbFile, openDb } from './db.mjs';
import { isMain } from './paths.mjs';

const human = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const PER_PROJECT = `
  SELECT s.cwd, count(*) AS sessions,
    sum((SELECT count(*) FROM events e WHERE e.sid = s.sid AND e.kind = 'prompt' AND e.ts >= $since)) AS prompts,
    sum((SELECT count(*) FROM events e WHERE e.sid = s.sid AND e.kind = 'tool_fail' AND e.ts >= $since)) AS failures,
    sum((SELECT count(*) FROM denials d WHERE d.sid = s.sid AND d.ts >= $since)) AS denials,
    sum(coalesce(s.interrupts, 0)) AS interrupts,
    sum(coalesce(s.tokens_out, 0)) AS tokens_out
  FROM sessions s WHERE s.last >= $since GROUP BY s.cwd ORDER BY sessions DESC`;

// The same call failing again in one session: the "command that keeps failing" signal.
const REPEATED = `
  SELECT s.cwd, e.tool, e.text AS program, e.code, count(*) AS n
  FROM events e JOIN sessions s ON s.sid = e.sid
  WHERE e.kind = 'tool_fail' AND e.ts >= ?
  GROUP BY e.sid, e.call HAVING n >= 2 ORDER BY n DESC LIMIT 10`;

export function report(db, days, now = Date.now()) {
  const since = now - days * DAY;
  const name = (cwd) => (cwd ? path.basename(cwd) : '(unknown)');
  const rows = db.prepare(PER_PROJECT).all({ since });
  const out = [`brain: last ${days} days, ${rows.reduce((n, r) => n + r.sessions, 0)} sessions in ${rows.length} projects`, ''];
  if (rows.length) {
    const table = [['project', 'sessions', 'prompts', 'failures', 'denials', 'interrupts', 'tokens out']];
    for (const r of rows) {
      table.push([name(r.cwd), r.sessions, r.prompts, r.failures, r.denials, r.interrupts, human(r.tokens_out)].map(String));
    }
    const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
    for (const r of table) out.push(r.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  '));
  }
  const repeated = db.prepare(REPEATED).all(since);
  if (repeated.length) {
    out.push('', 'Repeated failures (one call, 2+ times in a session):');
    for (const r of repeated) {
      const what = [r.tool, r.program, r.code === null ? '' : `exit ${r.code}`].filter(Boolean).join(' ');
      out.push(`  ${name(r.cwd)}: ${what} x${r.n}`);
    }
  }
  const queue = db.prepare('SELECT reason, count(*) AS n FROM queue GROUP BY reason ORDER BY reason').all();
  out.push('', `Queue: ${queue.length ? queue.map((q) => `${q.n} ${q.reason}`).join(', ') : 'empty'}`);
  out.push('', 'Interrupts and tokens are whole-session totals, from the transcripts.');
  return out.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--days');
  const days = i >= 0 ? Number(argv[i + 1]) : 14;
  if (!Number.isInteger(days) || days < 1) {
    console.error('usage: report.mjs [--days N]   N is a whole number of days, 1 or more');
    return 2;
  }
  if (!fs.existsSync(dbFile())) {
    console.log(`brain: no records yet (${dbFile()} does not exist). Start a Claude Code session first.`);
    return 0;
  }
  const db = openDb();
  try {
    console.log(report(db, days));
  } finally {
    db.close();
  }
  return 0;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
