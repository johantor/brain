// Auto-memory proposals: entries that recur across projects, not yet in CLAUDE.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { entryOf, proposals } from '../plugin/lib/memory.mjs';

function config(projects, userClaude = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-memory-'));
  for (const [name, lines] of Object.entries(projects)) {
    fs.mkdirSync(path.join(root, 'projects', name, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', name, 'memory', 'MEMORY.md'), lines.join('\n'));
  }
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), userClaude);
  return path.join(root, 'projects');
}

test('entryOf drops list markers and links, and skips headings and short lines', () => {
  assert.equal(entryOf('- [Prefers pnpm over npm](feedback_pm.md) in every repo').text, 'Prefers pnpm over npm in every repo');
  assert.equal(entryOf('# Memory'), null);
  assert.equal(entryOf('- short'), null);
});

test('an entry in two projects is proposed once; one project, or one already in CLAUDE.md, is not', () => {
  const dir = config({
    a: ['- Prefers pnpm over npm in every repo', '- Replies under 150 words, result first', '- Only in project a, this one'],
    b: ['* prefers PNPM over npm in every repo.', '- Replies under 150 words, result first'],
    c: ['- Prefers pnpm over npm in every repo', '- Prefers pnpm over npm in every repo'],
  }, '- Replies under 150 words, result first\n');
  assert.deepEqual(proposals(dir).map((p) => [p.projects.length, p.text]), [[3, 'Prefers pnpm over npm in every repo']]);
});

test('no projects folder is no proposals', () => {
  assert.deepEqual(proposals('/nonexistent/projects'), []);
});

test('distinct non-Latin entries keep distinct keys', () => {
  const dir = config({
    a: ['- 回答は必ず日本語で簡潔にまとめてください'],
    b: ['- 変更前には必ず関連するテストを実行してください'],
  }, '- Читайте журнал ошибок перед тем, как гадать о причине\n');
  assert.deepEqual(proposals(dir), []);
  assert.notEqual(entryOf('- 回答は必ず日本語で簡潔にまとめてください').key, '');
});
