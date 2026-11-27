// Promote (#33): a pinned lesson that one plugin's agents keep citing across projects points
// at that plugin's prompt or skill, not at the project. brain drafts an issue for the
// plugin's repository; it sends nothing. The /brain:lessons command shows the draft in full
// and runs `gh` only when the user chooses to send it.
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './ask.mjs';
import { configDir } from './paths.mjs';
import { projectNames, scrub } from './scrub.mjs';

export const MIN_PROJECTS = 2;
// A plugin agent's type is `<plugin>:<agent>`; the namespace becomes part of a `gh` command
// line, so only a plain name counts.
const NAMESPACE = /^([a-z0-9][\w.-]*):/i;

// The plugin whose agents cite lesson `id` most: its name, its citations by agent, and the
// projects (by `projectRoot`) they came from; `cwds` holds every citing session's folder, for
// the scrub. Null when no plugin agent cited it.
export function pluginCites(db, id) {
  const rows = db.prepare("SELECT e.text, s.cwd FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.kind = 'cite' AND e.code = ?").all(id);
  const byPlugin = new Map();
  const cwds = new Set(rows.map((r) => r.cwd).filter(Boolean));
  for (const r of rows) {
    const plugin = NAMESPACE.exec(r.text ?? '')?.[1];
    if (!plugin) continue;
    const p = byPlugin.get(plugin) ?? { plugin, cited: 0, agents: new Map(), cwds: new Set() };
    p.cited++;
    p.agents.set(r.text, (p.agents.get(r.text) ?? 0) + 1);
    if (r.cwd) p.cwds.add(r.cwd);
    byPlugin.set(plugin, p);
  }
  const top = [...byPlugin.values()].sort((a, b) => b.cited - a.cited || a.plugin.localeCompare(b.plugin))[0];
  if (!top) return null;
  const projects = new Set([...top.cwds].map(projectRoot)).size;
  const agents = [...top.agents].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { plugin: top.plugin, cited: top.cited, projects, agents, cwds: [...cwds] };
}

// `owner/repo` from the `repository` of an installed plugin's own manifest, never from the
// lesson. Null when the plugin is not installed or names no GitHub repository.
export function repository(plugin) {
  const file = path.join(configDir(), 'plugins', 'installed_plugins.json');
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(file, 'utf8')).plugins ?? {};
  } catch {
    return null; // No plugins installed: nothing to read.
  }
  for (const [key, entries] of Object.entries(installed)) {
    if (key.split('@')[0] !== plugin) continue;
    for (const e of [].concat(entries)) {
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(e.installPath, '.claude-plugin', 'plugin.json'), 'utf8'));
      } catch {
        continue; // An install without a readable manifest names no repository.
      }
      const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
      const m = /^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
      if (m) return `${m[1]}/${m[2]}`;
    }
  }
  return null;
}

// The issue for lesson `l` (with `repeated`) and its plugin citations `pc`. The lesson and
// agent names are scrubbed with the names of each citing project; a draft that names one is
// refused. The fixed words are not scrubbed: a project named `brain` would refuse every draft.
export function issue(l, pc) {
  const names = pc.cwds.flatMap(projectNames);
  const parts = [l.description, ...pc.agents.map(([agent]) => agent)];
  if (parts.some((t) => scrub(t, names) !== t)) return { reject: 'the draft names a project, a path, a URL or a host' };
  const title = `${pc.plugin}: agents keep needing a lesson brain learned`;
  const body = [
    `brain, a Claude Code plugin that learns lessons from sessions, keeps loading this lesson for ${pc.plugin}'s agents:`,
    '',
    `> ${l.description}`,
    '',
    `- Cited by: ${pc.agents.map(([agent, n]) => `${agent} ${n}`).join(', ')}`,
    `- Cited in ${pc.projects} projects; its mistake happened again ${l.repeated} times.`,
    `- Kind: ${l.kind}. The user pinned it.`,
    '',
    'The fix may belong in the agent\'s prompt or a skill. Drafted by brain: no project name, path or session text.',
  ].join('\n');
  return { title, body };
}
