// Reads Claude Code's transcripts (<config>/projects/<project>/<sid>.jsonl, plus
// <sid>/subagents/*.jsonl) for what no hook reports: token use, interrupts, and
// sessions that never sent SessionEnd. The format is undocumented, so every field is
// optional and a line that does not parse is skipped. Only text markers are read,
// never tool output.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DAY, KEEP_DAYS, QUEUE_DAYS, prune, tx } from './db.mjs';
import { projectsDir } from './paths.mjs';

// A session silent this long without a SessionEnd is taken as ended (Esc and close, a crash).
export const IDLE_MS = 12 * 3_600_000;
const INTERRUPT = '[Request interrupted by user';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ');
}

async function readFile(file, acc, main) {
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of lines) {
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!line || typeof line !== 'object') continue;
    const t = Date.parse(line.timestamp);
    if (t) {
      acc.first = Math.min(acc.first ?? t, t);
      acc.last = Math.max(acc.last ?? t, t);
    }
    const msg = line.message;
    // One reply is written as several lines that repeat its id and usage: count it once.
    if (line.type === 'assistant' && typeof msg?.id === 'string' && msg.usage) acc.usage.set(msg.id, msg.usage);
    if (!main) continue;
    if (line.type === 'assistant' && typeof msg?.model === 'string' && !msg.model.startsWith('<')) acc.model = msg.model;
    if (typeof line.cwd === 'string' && line.cwd) acc.cwd ??= line.cwd;
    if (typeof line.version === 'string') acc.version = line.version;
    if (line.type === 'user' && textOf(msg?.content).trimStart().startsWith(INTERRUPT)) acc.interrupts++;
  }
}

export async function readSession(files) {
  const acc = { usage: new Map(), interrupts: 0 };
  for (const [i, file] of files.entries()) await readFile(file, acc, i === 0);
  const sum = (...keys) => [...acc.usage.values()].reduce((n, u) => n + keys.reduce((m, k) => m + (Number(u[k]) || 0), 0), 0);
  return {
    cwd: acc.cwd ?? null,
    first: acc.first ?? null,
    last: acc.last ?? null,
    model: acc.model ?? null,
    version: acc.version ?? null,
    tokensIn: sum('input_tokens', 'cache_creation_input_tokens'),
    tokensCached: sum('cache_read_input_tokens'),
    tokensOut: sum('output_tokens'),
    interrupts: acc.interrupts,
  };
}

// Hooks own cwd and start; the transcript owns what only it knows.
const UPSERT = `
  INSERT INTO sessions (sid, cwd, started, last, model, version, tokens_in, tokens_cached, tokens_out, interrupts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET
    cwd = coalesce(sessions.cwd, excluded.cwd),
    started = coalesce(sessions.started, excluded.started),
    last = max(coalesce(sessions.last, 0), coalesce(excluded.last, 0)),
    model = coalesce(excluded.model, sessions.model),
    version = coalesce(excluded.version, sessions.version),
    tokens_in = excluded.tokens_in, tokens_cached = excluded.tokens_cached,
    tokens_out = excluded.tokens_out, interrupts = excluded.interrupts`;

function list(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Each session's files: the main transcript first, then its subagents'.
function* sessions(dir) {
  for (const p of list(dir)) {
    if (!p.isDirectory()) continue;
    const pdir = path.join(dir, p.name);
    for (const f of list(pdir)) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const sid = f.name.slice(0, -'.jsonl'.length);
      const subs = list(path.join(pdir, sid, 'subagents'))
        .filter((s) => s.isFile() && s.name.endsWith('.jsonl'))
        .map((s) => path.join(pdir, sid, 'subagents', s.name));
      yield { sid, files: [path.join(pdir, f.name), ...subs] };
    }
  }
}

// Reads every transcript that changed since the last scan, inside the retention
// window, so the first run after install is the backfill. Then queues sessions that
// went quiet without a SessionEnd, and prunes.
export async function scan(db, dir = projectsDir(), now = Date.now()) {
  const since = now - KEEP_DAYS * DAY;
  const known = db.prepare('SELECT sig FROM transcripts WHERE sid = ?');
  for (const { sid, files } of sessions(dir)) {
    try {
      const stats = files.map((f) => fs.statSync(f));
      if (stats[0].mtimeMs < since) continue;
      const sig = stats.map((s) => `${s.mtimeMs}:${s.size}`).join(',');
      if (known.get(sid)?.sig === sig) continue;
      const s = await readSession(files);
      tx(db, () => {
        db.prepare(UPSERT).run(sid, s.cwd, s.first, s.last, s.model, s.version, s.tokensIn, s.tokensCached, s.tokensOut, s.interrupts);
        db.prepare('INSERT INTO transcripts (sid, sig) VALUES (?, ?) ON CONFLICT(sid) DO UPDATE SET sig = excluded.sig').run(sid, sig);
      });
    } catch {
      // One unreadable transcript must not hide the rest.
    }
  }
  db.prepare(`INSERT OR IGNORE INTO queue (sid, reason, ts)
    SELECT sid, 'no-end', last FROM sessions WHERE ended IS NULL AND last < ? AND last >= ?`)
    .run(now - IDLE_MS, now - QUEUE_DAYS * DAY);
  prune(db, now);
}
