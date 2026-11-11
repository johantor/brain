// Where brain keeps its data, and where Claude Code keeps its transcripts. A fixed
// directory, not CLAUDE_PLUGIN_DATA: a report run from a terminal must find the
// same database the hooks write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node resolves import.meta.url through symlinks, but argv[1] keeps the path as
// typed: a symlinked ~/.claude or --plugin-dir must still match.
export function isMain(argv1, metaUrl) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export function brainDir() {
  return process.env.CLAUDE_BRAIN_DIR || path.join(os.homedir(), '.claude', 'brain');
}

export function projectsDir() {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(config, 'projects');
}
