// brain.db: one SQLite file, written by every session's hooks at once. WAL and a
// busy timeout let concurrent writers wait instead of failing. Schema: CLAUDE.md, Map.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { brainDir } from './paths.mjs';

export const DAY = 86_400_000;
export const KEEP_DAYS = 90;
export const QUEUE_DAYS = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, cwd TEXT, started INTEGER, last INTEGER, ended INTEGER, end_reason TEXT,
  model TEXT, version TEXT, tokens_in INTEGER, tokens_cached INTEGER, tokens_out INTEGER,
  interrupts INTEGER);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, sid TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  tool TEXT, call TEXT, code INTEGER, text TEXT);
CREATE INDEX IF NOT EXISTS events_sid ON events (sid, kind);
CREATE TABLE IF NOT EXISTS queue (sid TEXT PRIMARY KEY, reason TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transcripts (sid TEXT PRIMARY KEY, sig TEXT NOT NULL);
-- An index of the lesson files, which are the source of truth; \`key\` catches repeats.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  kind TEXT NOT NULL, scope TEXT NOT NULL, project TEXT, status TEXT NOT NULL, created INTEGER NOT NULL);
-- A denied dialog has no hook of its own: it is a permission request whose call never ran.
CREATE VIEW IF NOT EXISTS denials AS
  SELECT p.* FROM events p WHERE p.kind = 'permission' AND NOT EXISTS (
    SELECT 1 FROM events t WHERE t.sid = p.sid AND t.call = p.call
      AND t.kind IN ('tool_ok', 'tool_fail') AND t.ts >= p.ts);
`;

export function dbFile() {
  return path.join(brainDir(), 'brain.db');
}

// The records hold prompts: private to the user, also when the directory or the file
// already existed with wider modes. The umask covers the -wal and -shm files SQLite adds.
export function openDb(file = dbFile()) {
  process.umask(0o077);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn in one write transaction, so a reader never sees half a session.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Drops records past the retention window, and queue entries no one reflected on.
export function prune(db, now = Date.now()) {
  const cutoff = now - KEEP_DAYS * DAY;
  tx(db, () => {
    db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM sessions WHERE coalesce(last, started, 0) < ?').run(cutoff);
    db.prepare('DELETE FROM transcripts WHERE sid NOT IN (SELECT sid FROM sessions)').run();
    db.prepare('DELETE FROM queue WHERE ts < ?').run(now - QUEUE_DAYS * DAY);
  });
}
