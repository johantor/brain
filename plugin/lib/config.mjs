// `node config.mjs learn [on|off] | promote [<plugin> on|off]`: brain's settings, in
// <brain dir>/config.json. `learn` is on by default: it reflects after a correction or a
// denial, and loads lessons at session start. `promote` lists the plugins, as
// `name@marketplace`, that /brain:lessons may draft issues for (#33): by default the
// maintainer's own, so a same-named plugin from another marketplace never matches.
import fs from 'node:fs';
import path from 'node:path';
import { brainDir, isMain } from './paths.mjs';

const file = () => path.join(brainDir(), 'config.json');
// `name@marketplace`, as Claude Code keys an installed plugin.
const PLUGIN = /^[a-z0-9][\w.-]*@[a-z0-9][\w.-]*$/i;
export const DEFAULT_PROMOTE = ['board@johantor', 'crew@johantor', 'personas@johantor'];

// Before 0.12.0 there were two switches, both off by default. A file with either one on
// stays on; a file with both off stays off.
export function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const promote = Array.isArray(c.promote) ? c.promote.filter((p) => typeof p === 'string' && PLUGIN.test(p)) : DEFAULT_PROMOTE;
    return { learn: c.learn === true || c.reflect === true, promote };
  } catch {
    return { learn: true, promote: DEFAULT_PROMOTE };
  }
}

function write(config) {
  fs.mkdirSync(brainDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

const USAGE = 'usage: config.mjs learn [on|off] | promote [<plugin>@<marketplace> on|off]';

export function main(argv = process.argv.slice(2)) {
  const [key, ...args] = argv;
  const config = readConfig();
  if (key === 'learn' && args.length <= 1 && (args[0] === undefined || ['on', 'off'].includes(args[0]))) {
    if (args[0]) write({ ...config, learn: args[0] === 'on' });
    console.log(`brain: learning is ${(args[0] ? args[0] === 'on' : config.learn) ? 'on' : 'off'}`);
    return 0;
  }
  if (key === 'promote' && (!args.length || (args.length === 2 && PLUGIN.test(args[0]) && ['on', 'off'].includes(args[1])))) {
    let list = config.promote;
    if (args.length) {
      list = list.filter((p) => p !== args[0]);
      if (args[1] === 'on') list.push(args[0]);
      write({ ...config, promote: list.sort() });
    }
    console.log(`brain: promote is allowed for ${list.length ? list.join(', ') : 'no plugin'}`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (isMain(process.argv[1], import.meta.url)) process.exitCode = main();
