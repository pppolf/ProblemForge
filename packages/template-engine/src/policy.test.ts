import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody, render, ContentPolicyError, loadTemplateDirectory } from './index.ts';
import { fileURLToPath } from 'node:url';

test('three representative manuscripts render into administrator-controlled shells', async () => {
  const fixtures = [['statement', 'STATEMENT'], ['editorial-document', 'EDITORIAL_DOCUMENT'], ['editorial-beamer', 'EDITORIAL_BEAMER']] as const;
  for (const [folder, kind] of fixtures) {
    const path = new URL(`../../../templates/builtin/${folder}/`, import.meta.url);
    const files = await loadTemplateDirectory(fileURLToPath(path));
    const result = render(files, kind, files['preview.tex'], { title: 'A & B_1', author: '作者' });
    assert.match(Object.values(result).join('\n'), /A \\& B\\_1/);
    assert.match(Object.values(result).join('\n'), /\\input\{content\.tex\}/);
    assert.equal(result['content.tex'], files['preview.tex']);
    if (kind === 'STATEMENT') {
      assert.match(result['preamble.tex'], /11pt,a4paper,chinese,fontset=overleaf/);
      assert.equal(result['style.tex'], files['style.tex']);
      const booklet = render(files, kind, files['preview.tex'], { title: 'A & B_1', author: '作者' }, [], 'booklet');
      assert.match(booklet['main.tex'], /\\input 0\.tex[\s\S]*\\input 1\.tex[\s\S]*\\input\{problem\.tex\}/);
      assert.match(booklet['0.tex'], /A & A \\& B\\_1 & 1 s & 256 MB/);
    }
  }
});
test('content AST rejects a document shell and expansion/file access; verbatim stays literal', () => {
  assert.throws(() => validateBody('\\documentclass{article}\\begin{document}text\\end{document}', 'EDITORIAL_DOCUMENT'), ContentPolicyError);
  assert.throws(() => validateBody('\\csname input\\endcsname{/etc/passwd}', 'STATEMENT'), ContentPolicyError);
  assert.throws(() => validateBody('^^5cinput{/etc/passwd}', 'STATEMENT'), ContentPolicyError);
  assert.throws(() => validateBody('\\begin{example}\\exmp{\\input{/etc/passwd}}{3}\\end{example}', 'STATEMENT'), ContentPolicyError);
  assert.doesNotThrow(() => validateBody('\\begin{verbatim}\n\\input{/etc/passwd}\n\\end{verbatim}', 'STATEMENT'));
});
test('images resolve only approved immutable assets and bounded local dimensions', () => {
  const path = 'assets/cimage123.png';
  assert.deepEqual(validateBody(`\\includegraphics[width=0.8\\linewidth]{${path}}`, 'STATEMENT', [path]), [path]);
  assert.throws(() => validateBody('\\includegraphics{/etc/passwd}', 'STATEMENT', [path]), ContentPolicyError);
  assert.throws(() => validateBody(`\\includegraphics[width=0.8\\linewidth,command=\\input{secret}]{${path}}`, 'STATEMENT', [path]), ContentPolicyError);
});
