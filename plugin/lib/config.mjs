// `node config.mjs reflect on|off`: brain's settings, in <brain dir>/config.json.
// Shadow reflection spends the session's tokens, so it starts off (#4).
import fs from 'node:fs';
import path from 'node:path';
import { brainDir, isMain } from './paths.mjs';

const DEFAULTS = { reflect: false };

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
  if (key !== 'reflect' || (value !== undefined && !['on', 'off'].includes(value))) {
    console.error('usage: config.mjs reflect [on|off]');
    return 2;
  }
  const config = readConfig();
  if (value) {
    config.reflect = value === 'on';
    fs.mkdirSync(brainDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(`brain: shadow reflection is ${config.reflect ? 'on' : 'off'}`);
  return 0;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
