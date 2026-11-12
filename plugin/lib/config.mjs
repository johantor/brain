// `node config.mjs reflect|learn [on|off]`: brain's settings, in <brain dir>/config.json.
// Both start off: reflection spends the session's tokens (#4), and learning loads
// lessons into every session (#5).
import fs from 'node:fs';
import path from 'node:path';
import { brainDir, isMain } from './paths.mjs';

const DEFAULTS = { reflect: false, learn: false };
const LABELS = { reflect: 'shadow reflection', learn: 'loading lessons' };

const file = () => path.join(brainDir(), 'config.json');

export function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function main(argv = process.argv.slice(2)) {
  const [key, value] = argv;
  if (!(key in DEFAULTS) || (value !== undefined && !['on', 'off'].includes(value))) {
    console.error('usage: config.mjs reflect|learn [on|off]');
    return 2;
  }
  const config = readConfig();
  if (value) {
    config[key] = value === 'on';
    fs.mkdirSync(brainDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(`brain: ${LABELS[key]} is ${config[key] ? 'on' : 'off'}`);
  return 0;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
