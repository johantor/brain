// `node memory.mjs`: auto-memory entries that recur in two or more projects, proposed for
// ~/.claude/CLAUDE.md, where they would load everywhere (#3, "Where things land"). It
// reads and prints only: brain never writes auto memory or CLAUDE.md (#2).
import fs from 'node:fs';
import path from 'node:path';
import { isMain, projectsDir } from './paths.mjs';

export const MIN_PROJECTS = 2;

// One MEMORY.md line as a comparable entry: list markers, links and case dropped.
export function entryOf(line) {
  const text = line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
  if (text.length < 15 || text.startsWith('#')) return null;
  return { text, key: text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() };
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Entries seen in MIN_PROJECTS or more projects' MEMORY.md and not yet in the user's
// CLAUDE.md, most widespread first.
export function proposals(dir = projectsDir(), userClaude = path.join(path.dirname(dir), 'CLAUDE.md')) {
  const seen = new Map();
  let projects = [];
  try {
    projects = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const p of projects) {
    const keys = new Set();
    for (const line of read(path.join(dir, p.name, 'memory', 'MEMORY.md')).split('\n')) {
      const e = entryOf(line);
      if (!e || keys.has(e.key)) continue;
      keys.add(e.key);
      const s = seen.get(e.key) ?? { text: e.text, projects: [] };
      s.projects.push(p.name);
      seen.set(e.key, s);
    }
  }
  const already = new Set(read(userClaude).split('\n').map(entryOf).filter(Boolean).map((e) => e.key));
  return [...seen.entries()]
    .filter(([key, s]) => s.projects.length >= MIN_PROJECTS && !already.has(key))
    .map(([, s]) => s)
    .sort((a, b) => b.projects.length - a.projects.length);
}

export function main() {
  const found = proposals();
  if (!found.length) {
    console.log('brain: no auto-memory entry recurs in two or more projects.');
    return 0;
  }
  console.log(`brain: ${found.length} auto-memory entries recur across projects and could move to ~/.claude/CLAUDE.md:`);
  for (const s of found) console.log(`- (${s.projects.length} projects) ${s.text}`);
  return 0;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
