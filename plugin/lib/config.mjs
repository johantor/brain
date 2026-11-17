// `node config.mjs learn [on|off]`: brain's one switch, in <brain dir>/config.json. On by
// default: it reflects after a correction or a denial, and loads lessons at session start.
import fs from 'node:fs';
import path from 'node:path';
import { brainDir, isMain } from './paths.mjs';

const file = () => path.join(brainDir(), 'config.json');

// Before 0.12.0 there were two switches, both off by default. A file with either one on
// stays on; a file with both off stays off.
export function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { learn: c.learn === true || c.reflect === true };
  } catch {
    return { learn: true };
  }
}

export function main(argv = process.argv.slice(2)) {
  const [key, value] = argv;
  if (key !== 'learn' || (value !== undefined && !['on', 'off'].includes(value))) {
    console.error('usage: config.mjs learn [on|off]');
    return 2;
  }
  const config = readConfig();
  if (value) {
    config.learn = value === 'on';
    fs.mkdirSync(brainDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(`brain: learning is ${config.learn ? 'on' : 'off'}`);
  return 0;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
