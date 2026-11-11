// `node manage.mjs forget L12 | pin L12 | undo`: the user's control over lessons (#5).
// Forget is a veto: the lesson stays in the table as `deprecated`, so its key blocks
// re-learning it. Pin marks it `stable`, confirmed by a person (OKF `verified`). Undo
// reverses the latest change that is not undone yet.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx } from './db.mjs';
import { recordChange, updateLessonFile, writeIndex } from './lessons.mjs';
import { brainDir, isMain } from './paths.mjs';
import { scrub } from './scrub.mjs';

const lessonRow = (db, id) => db.prepare('SELECT id, status, description FROM lessons WHERE id = ?').get(id);
const human = (now) => [{ by: 'human:local', at: new Date(now).toISOString() }];

function setLesson(db, id, { status, description }, now) {
  if (description !== undefined) db.prepare('UPDATE lessons SET description = ? WHERE id = ?').run(description, id);
  db.prepare('UPDATE lessons SET status = ? WHERE id = ?').run(status, id);
  updateLessonFile(id, {
    status,
    ...(description !== undefined && { description }),
    verified: status === 'stable' ? human(now) : undefined,
    retired: status === 'deprecated' ? 'vetoed' : undefined,
  });
  if (description !== undefined) writeIndex(db);
}

export function forget(db, id, now = Date.now()) {
  const l = lessonRow(db, id);
  if (!l) return `no lesson L${id}`;
  if (l.status === 'deprecated') return `L${id} is already forgotten`;
  setLesson(db, id, { status: 'deprecated' }, now);
  recordChange(db, { lesson: id, action: 'forgotten', before: { status: l.status }, now });
  return `forgot L${id}: brain will not load it or learn it again`;
}

// A pin may also replace the wording, as an edit in learned.md does. The new text is
// scrubbed like any lesson.
export function pin(db, id, now = Date.now(), text) {
  const l = lessonRow(db, id);
  if (!l) return `no lesson L${id}`;
  const description = text === undefined ? undefined : scrub(text.trim().replace(/\s+/g, ' '));
  if (l.status === 'stable' && (description === undefined || description === l.description)) return `L${id} is already pinned`;
  setLesson(db, id, { status: 'stable', description }, now);
  recordChange(db, { lesson: id, action: description === undefined ? 'pinned' : 'edited', before: { status: l.status, description: l.description }, now });
  return `pinned L${id}: brain keeps it and loads it first`;
}

export function undo(db, now = Date.now()) {
  const c = db.prepare('SELECT * FROM changes WHERE undone = 0 ORDER BY id DESC LIMIT 1').get();
  if (!c) return 'nothing to undo';
  const before = c.before ? JSON.parse(c.before) : null;
  // A proposal has no earlier state: undoing it is a veto.
  const target = before ?? { status: 'deprecated' };
  setLesson(db, c.lesson, target, now);
  db.prepare('UPDATE changes SET undone = 1 WHERE id = ?').run(c.id);
  recordChange(db, { lesson: c.lesson, action: 'undone', now, note: `reversed "${c.action}"` });
  // The undo row itself is not undoable, or a second undo would redo the change.
  db.prepare('UPDATE changes SET undone = 1 WHERE id = (SELECT max(id) FROM changes)').run();
  return `undid "${c.action}" on L${c.lesson}`;
}

// learned.md lists the global lessons as `- L12 (kind): text`. A line the user deleted
// vetoes that lesson; a line they edited pins the new wording (#3, "Lifecycle").
// `.learned.json` holds what brain last wrote, to tell an edit from a new lesson.
export function syncLearned(db, now = Date.now()) {
  const file = path.join(brainDir(), 'learned.md');
  const sidecar = path.join(brainDir(), '.learned.json');
  let written;
  let text;
  try {
    written = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const seen = new Map();
  for (const m of text.matchAll(/^- L(\d+) \([\w-]+\): (.+)$/gm)) seen.set(Number(m[1]), m[2].trim());
  const done = [];
  for (const [key, was] of Object.entries(written)) {
    const id = Number(key);
    if (!seen.has(id)) done.push(forget(db, id, now));
    else if (seen.get(id) !== was) done.push(pin(db, id, now, seen.get(id)));
  }
  return done;
}

// Rewrites learned.md and its sidecar from the table.
export function writeLearned(db) {
  const rows = db.prepare("SELECT id, kind, description FROM lessons WHERE scope = 'global' AND status != 'deprecated' ORDER BY id").all();
  const body = rows.length ? rows.map((l) => `- L${l.id} (${l.kind}): ${l.description}`).join('\n') : '(none yet)';
  const head = '# Lessons brain loads in every project\n\nDelete a line to make brain forget that lesson; edit one to pin your wording.\n';
  const file = path.join(brainDir(), 'learned.md');
  fs.writeFileSync(`${file}.tmp`, `${head}\n${body}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  const sidecar = path.join(brainDir(), '.learned.json');
  fs.writeFileSync(`${sidecar}.tmp`, JSON.stringify(Object.fromEntries(rows.map((l) => [l.id, l.description]))), { mode: 0o600 });
  fs.renameSync(`${sidecar}.tmp`, sidecar);
}

export function main(argv = process.argv.slice(2)) {
  const [action, ref] = argv;
  const id = Number(/^L?(\d+)$/i.exec(ref ?? '')?.[1]);
  if (!['forget', 'pin', 'undo'].includes(action) || (action !== 'undo' && !id)) {
    console.error('usage: manage.mjs forget L<n> | pin L<n> | undo');
    return 2;
  }
  const db = openDb();
  try {
    const out = tx(db, () => (action === 'undo' ? undo(db) : action === 'forget' ? forget(db, id) : pin(db, id)));
    writeLearned(db);
    console.log(`brain: ${out}`);
    return 0;
  } finally {
    db.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
