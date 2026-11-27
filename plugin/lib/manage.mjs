// `node manage.mjs list | forget L12 [L13 ...] | pin L12 [L13 ...] | repeat L12 <sid> | undo
// | draft L12 [--body] | promoted L12 <issue url>`: the user's control over lessons (#5). Forget
// is a veto: the lesson stays in the table as `deprecated`, so its key blocks re-learning it.
// Pin marks it `stable`, confirmed by a person (OKF `verified`). Undo reverses the latest
// change that is not undone yet. List shows the evidence for that choice; the reflect skill
// records a repeat. Draft and promoted carry a lesson to its plugin's repository (#33).
import path from 'node:path';
import { DAY, openDb, tx } from './db.mjs';
import { recordChange, updateLessonFile } from './lessons.mjs';
import { brainDir, isMain, writeAtomic } from './paths.mjs';
import { MIN_PROJECTS, issue, pluginCites, repository } from './promote.mjs';

const lessonRow = (db, id) => db.prepare('SELECT id, status FROM lessons WHERE id = ?').get(id);
const human = (now) => [{ by: 'human:local', at: new Date(now).toISOString() }];

function setLesson(db, id, { status }, now) {
  db.prepare('UPDATE lessons SET status = ? WHERE id = ?').run(status, id);
  updateLessonFile(id, {
    status,
    verified: status === 'stable' ? human(now) : undefined,
    retired: status === 'deprecated' ? 'vetoed' : undefined,
  });
}

export function forget(db, id, now = Date.now()) {
  const l = lessonRow(db, id);
  if (!l) return `no lesson L${id}`;
  if (l.status === 'deprecated') return `L${id} is already forgotten`;
  setLesson(db, id, { status: 'deprecated' }, now);
  recordChange(db, { lesson: id, action: 'forgotten', before: { status: l.status }, now });
  return `forgot L${id}: brain will not load it or learn it again`;
}

export function pin(db, id, now = Date.now()) {
  const l = lessonRow(db, id);
  if (!l) return `no lesson L${id}`;
  if (l.status === 'stable') return `L${id} is already pinned`;
  setLesson(db, id, { status: 'stable' }, now);
  recordChange(db, { lesson: id, action: 'pinned', before: { status: l.status }, now });
  return `pinned L${id}: brain keeps it and loads it first`;
}

// A lesson's mistake happened again: the reflect skill judged that friction in `sid` is one a
// loaded lesson covers. One `repeat` event, with the lesson id in `code`.
export function repeat(db, id, sid, now = Date.now()) {
  const l = db.prepare('SELECT created FROM lessons WHERE id = ?').get(id);
  if (!l) return `no lesson L${id}`;
  const s = db.prepare('SELECT started FROM sessions WHERE sid = ?').get(sid);
  if (!s) return `no session ${sid}`;
  // Only a lesson that existed at the session's start was loaded there: a queued, older session
  // cannot have repeated a newer lesson.
  if (!(s.started >= l.created)) return `L${id} was not loaded in session ${sid}: no repeat recorded`;
  db.prepare("INSERT INTO events (sid, ts, kind, code) VALUES (?, ?, 'repeat', ?)").run(sid, now, id);
  return `recorded that the mistake of L${id} happened again`;
}

// Per live lesson: citations from the transcripts (scan.mjs) and repeats, within retention.
const EVIDENCE = `
  SELECT l.id, l.status, l.scope, l.project, l.kind, l.created, l.description,
    coalesce(c.cited, 0) AS cited, coalesce(c.sub, 0) AS sub, coalesce(r.repeated, 0) AS repeated,
    EXISTS (SELECT 1 FROM changes WHERE lesson = l.id AND action = 'promoted' AND undone = 0) AS promoted
  FROM lessons l
  LEFT JOIN (SELECT code, count(*) AS cited, sum(text != 'main') AS sub FROM events WHERE kind = 'cite' GROUP BY code) c ON c.code = l.id
  LEFT JOIN (SELECT code, count(*) AS repeated FROM events WHERE kind = 'repeat' GROUP BY code) r ON r.code = l.id
  WHERE l.status != 'deprecated' AND ($id IS NULL OR l.id = $id) ORDER BY l.id`;

// Live lessons with their evidence, one when `id` is given; `plugin` is pluginCites().
// The plugin's `repo` is set only when `promote` in config.json allows it.
const withRepo = (pc) => pc && { ...pc, repo: repository(pc.plugin) };
const evidence = (db, id = null) => db.prepare(EVIDENCE).all({ id }).map((l) => ({ ...l, plugin: l.cited ? withRepo(pluginCites(db, l.id)) : null }));

// Code, not the command's prose, picks the suggestion, so every review applies one rule.
// A lesson whose mistake recurs as often as it is cited is not working; one cited twice
// and never repeated is. A pinned one that mostly one plugin's agents cite, in several
// projects, belongs in that plugin, if the user allows it.
export function suggest(l) {
  if (l.repeated && l.repeated >= l.cited) return 'forget';
  const p = l.plugin;
  if (l.status === 'stable' && l.scope === 'global' && !l.promoted && p?.repo && p.projects >= MIN_PROJECTS && p.cited * 2 > l.cited) return 'promote';
  if (l.status !== 'stable' && l.cited >= 2 && !l.repeated) return 'pin';
  return 'keep';
}

const times = (n) => `${n} time${n === 1 ? '' : 's'}`;

// Subagent citations per agent: `crew:frontend 2, subagent 1`, `subagent` when no hook named it.
const BY_AGENT = "SELECT text, count(*) AS n FROM events WHERE kind = 'cite' AND code = ? AND text != 'main' GROUP BY text ORDER BY n DESC, text";

export function list(db, now = Date.now()) {
  const rows = evidence(db);
  if (!rows.length) return 'brain: no live lessons';
  return rows.map((l) => {
    const where = l.scope === 'global' ? 'global' : `project ${path.basename(l.project ?? '')}`;
    const age = Math.floor((now - l.created) / DAY);
    const sub = l.sub ? ` (${l.sub} in subagents: ${db.prepare(BY_AGENT).all(l.id).map((a) => `${a.text} ${a.n}`).join(', ')})` : '';
    const projects = l.plugin?.projects >= MIN_PROJECTS ? `, in ${l.plugin.projects} projects by ${l.plugin.plugin} agents` : '';
    const promoted = l.promoted ? ', promoted' : '';
    return `L${l.id} ${l.status === 'stable' ? 'pinned' : l.status}${promoted}, ${where} ${l.kind}, ${age} days old: cited ${times(l.cited)}${sub}${projects}, repeated ${times(l.repeated)}. Suggest: ${suggest(l)}\n  ${l.description}`;
  }).join('\n');
}

// The issue to promote lesson `id`, for its plugin's repository. Only a lesson suggest()
// would promote gets one.
export function draft(db, id) {
  const [l] = evidence(db, id);
  if (!l) return { reject: `no live lesson L${id}` };
  if (suggest(l) !== 'promote') return { reject: `L${id} is not one to promote: it must be pinned, global, and cited mostly by the agents of one plugin /brain:promote allows, in ${MIN_PROJECTS}+ projects` };
  const drafted = issue(l, l.plugin);
  return drafted.reject ? drafted : { repo: l.plugin.repo, ...drafted };
}

// The user sent the draft: the issue is logged, and the lesson is not suggested again.
export function promoted(db, id, url, now = Date.now()) {
  const l = lessonRow(db, id);
  if (!l) return `no lesson L${id}`;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(url)) return `not a GitHub issue URL: ${url}`;
  recordChange(db, { lesson: id, action: 'promoted', before: { status: l.status }, now, note: url });
  return `L${id} promoted to ${url}: forget it once the plugin ships the fix`;
}

function printDraft(d, bodyOnly) {
  if (bodyOnly) return console.log(d.body);
  console.log(`repository: ${d.repo}\ntitle: ${d.title}\n\n${d.body}`);
}

export function undo(db, now = Date.now()) {
  // Skill changes are logged with lesson 0; /brain:forget S<n> reverses those instead.
  const c = db.prepare('SELECT * FROM changes WHERE undone = 0 AND lesson > 0 ORDER BY id DESC LIMIT 1').get();
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

// learned.md lists what loads everywhere, for the user to read. It is a view: changes go
// through forget and pin, which check and log them (#14).
export function writeLearned(db) {
  const rows = db.prepare("SELECT id, kind, description FROM lessons WHERE scope = 'global' AND status != 'deprecated' ORDER BY id").all();
  const body = rows.length ? rows.map((l) => `- L${l.id} (${l.kind}): ${l.description}`).join('\n') : '(none yet)';
  const head = '# Lessons brain loads in every project\n\nGenerated by brain; edits here are overwritten. Use /brain:lessons or /brain:forget L<n>.\n';
  const file = path.join(brainDir(), 'learned.md');
  writeAtomic(file, `${head}\n${body}\n`);
}

const lessonId = (ref) => Number(/^L?(\d+)$/i.exec(ref ?? '')?.[1]);

export function main(argv = process.argv.slice(2)) {
  const [action, ...refs] = argv;
  const ids = ['repeat', 'draft', 'promoted'].includes(action) ? [lessonId(refs[0])] : refs.map(lessonId);
  const ok = {
    list: !refs.length, undo: !refs.length, forget: refs.length, pin: refs.length, repeat: refs.length === 2,
    draft: refs.length === 1 || (refs.length === 2 && refs[1] === '--body'), promoted: refs.length === 2,
  }[action];
  if (!ok || !ids.every(Boolean)) {
    console.error('usage: manage.mjs list | forget L<n> [L<n> ...] | pin L<n> [L<n> ...] | repeat L<n> <session id> | undo | draft L<n> [--body] | promoted L<n> <issue url>');
    return 2;
  }
  const db = openDb();
  try {
    if (action === 'list') {
      console.log(list(db));
      return 0;
    }
    if (action === 'draft') {
      const d = draft(db, ids[0]);
      if (d.reject) {
        console.log(`brain: no draft: ${d.reject}`);
        return 1;
      }
      printDraft(d, refs[1] === '--body');
      return 0;
    }
    const run = {
      undo: () => [undo(db)], repeat: () => [repeat(db, ids[0], refs[1])], promoted: () => [promoted(db, ids[0], refs[1])],
      forget: () => ids.map((id) => forget(db, id)), pin: () => ids.map((id) => pin(db, id)),
    }[action];
    const out = tx(db, run);
    if (!['repeat', 'promoted'].includes(action)) writeLearned(db);
    for (const line of out) console.log(`brain: ${line}`);
    return 0;
  } finally {
    db.close();
  }
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
