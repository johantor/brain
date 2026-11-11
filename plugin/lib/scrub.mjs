// Removes what must never reach brain.db: secrets, URLs, e-mail addresses, absolute
// paths, IP addresses, host names and the project's own names. Runs at capture, so
// nothing raw is stored (#5, "Data hygiene"). Pattern lists have gaps: README, Known gaps.
import fs from 'node:fs';
import path from 'node:path';

// Order matters: secrets before URLs (a token can sit in one), URLs before paths and
// hosts (a URL holds both), e-mail before hosts.
const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '<secret>'],
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, '<secret>'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '<secret>'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '<secret>'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<secret>'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<secret>'],
  [/\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2<secret>'],
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>'],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'],
  [/~(?:\/[\w.@-]+)+\/?|(?<![\w.~])(?:\/[\w.@-]+){2,}\/?/g, '<path>'],
  [/\b[A-Za-z]:\\[^\s"'`]+/g, '<path>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
  [/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|ai|co|cloud|se|uk|de|internal|local|corp|lan)\b/gi, '<host>'],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrub(text, names = []) {
  if (typeof text !== 'string') return null;
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  // Short names ("app", "ui") would scrub ordinary words.
  for (const n of names) {
    if (n && n.length >= 3) out = out.replace(new RegExp(`(?<![\\w-])${escape(n)}(?![\\w-])`, 'gi'), '<project>');
  }
  return out;
}

const UID = typeof process.getuid === 'function' ? process.getuid() : -1;

// The start of a small regular file the user owns. A FIFO or a device planted as
// `.git/config` would otherwise block the read (board's readSmall, larger cap).
function readSmall(file, cap = 8192) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || (UID >= 0 && st.uid !== UID)) throw new Error('not a plain file of ours');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(cap);
    return buf.subarray(0, fs.readSync(fd, buf, 0, cap, 0)).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// The names that identify a project: its folder, its repo root, and the owner and
// repo of each remote. Read as files, with no git process per event.
export function projectNames(cwd) {
  if (typeof cwd !== 'string' || !cwd) return [];
  const names = new Set([path.basename(cwd)]);
  let dir = path.resolve(cwd);
  for (;;) {
    const dotgit = path.join(dir, '.git');
    if (fs.existsSync(dotgit)) {
      names.add(path.basename(dir));
      try {
        const config = readSmall(path.join(dotgit, 'config'));
        for (const m of config.matchAll(/^\s*url\s*=\s*(.+)$/gm)) {
          const r = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(m[1].trim());
          if (r) names.add(r[1]).add(r[2]);
        }
      } catch {
        // A worktree's `.git` is a file, and a foreign one is skipped: folder names only.
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...names];
}
