import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { defaultJudgeSettings } from '@problemforge/contracts';
import { loadTemplateDirectory, render, statementSettings } from './index.ts';

test('single statements and one-problem booklets use saved limits in current and published built-in headers', async () => {
  const header = String.raw`\begin{problem}{ {{TITLE}} }{ {{INPUT_FILE}} }{ {{OUTPUT_FILE}} }{ {{TIME_LIMIT}} }{ {{MEMORY_LIMIT}} }`;
  const legacy = String.raw`\begin{problem}{ {{TITLE}} }{standard input}{standard output}{1 s}{256 MB}`;
  const body = '正文中的 1 s、256 MB 是示例，保持原文。';
  for (const folder of ['statement', 'statement-compact']) {
    const current = await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${folder}/`, import.meta.url)));
    const entry = folder === 'statement' ? 'problem.tex' : 'main.tex';
    assert.ok(current[entry].includes(header));
    for (const files of [current, { ...current, [entry]: current[entry].replace(header, legacy) }]) {
      const original = structuredClone(files);
      for (const mode of ['single', 'booklet'] as const) {
        const settings = statementSettings({ ...defaultJudgeSettings, timeLimitMs: 1250, memoryLimitMb: 512, ioMode: 'FILES', inputFile: 'data_in.txt', outputFile: 'data_out.txt' });
        const result = render(files, 'STATEMENT', body, { title: '题目 & A', author: '' }, [], mode, [], settings);
        const problem = result[mode === 'booklet' ? 'problem.tex' : entry];
        assert.match(problem, /\{ 1\.25 s \}\{ 512 MB \}/);
        assert.match(problem, /\{ data\\_in\.txt \}\{ data\\_out\.txt \}/);
        if (folder === 'statement' && mode === 'booklet') assert.match(result['0.tex'], /A & 题目 \\& A & 1\.25 s & 512 MB/);
        assert.equal(result['content.tex'], body);
      }
      assert.deepEqual(files, original);
    }
  }
});

test('statement settings use standard I/O and ignore judge fields that do not appear in the PDF', () => {
  assert.deepEqual(statementSettings(), { timeLimitMs: 1000, memoryLimitMb: 256, inputFile: 'standard input', outputFile: 'standard output' });
  assert.deepEqual(statementSettings({ ...defaultJudgeSettings, checkerMode: 'EXACT', inputFile: 'unused.txt', outputLimitBytes: 2048 }), statementSettings());
  assert.equal(statementSettings({ ...defaultJudgeSettings, timeLimitMs: 50 }).timeLimitMs, 50);
});
