import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody, render, printableSample, ContentPolicyError, loadTemplateDirectory } from './index.ts';
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

test('interactive statement headings stay in template-owned macros without allowing author definitions', async () => {
  const body = '\\Description\n描述。\n\\interactor\n协议。\n\\InteractionStart\n初始信息。\n\\InteractionQuery\n询问。\n\\InteractionAnswer\n回答。\n\\InteractionNotes\n注意事项。\n\\InteractionExample\n示例。';
  assert.doesNotThrow(() => validateBody(body, 'STATEMENT'));
  assert.throws(() => validateBody(body, 'EDITORIAL_DOCUMENT'), ContentPolicyError);
  assert.throws(() => validateBody('\\renewcommand{\\interactor}{\\input{secret}}', 'STATEMENT'), ContentPolicyError);
  for (const folder of ['statement', 'statement-compact']) {
    const files = await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${folder}/`, import.meta.url)));
    const single = render(files, 'STATEMENT', body, { title: '多项式机器', author: '' });
    assert.equal(single['content.tex'], body);
    assert.match(single['headings.tex'], /\\createsection\{\\interactor\}/);
    assert.match(single['main.tex'], /\\def\\ShortProblemTitle\{\}/);
    const booklet = render(files, 'STATEMENT', body, { title: '多项式机器', author: '' }, [], 'booklet');
    assert.match(booklet['problem.tex'], /Problem A\. 多项式机器/);
  }
});
test('sample slots use platform file paths while authors cannot read files', async () => {
  const files = await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/statement/', import.meta.url)));
  const result = render(files, 'STATEMENT', '计算 $a+b$。', { title: '样例', author: '作者' }, [], 'single', [{ inputPath: 'samples/sample-1.in', answerPath: 'samples/sample-1.ans' }]);
  assert.match(result['samples.tex'], /\\exmpfile\{samples\/sample-1\.in\}\{samples\/sample-1\.ans\}/);
  assert.equal(result['content.tex'], '计算 $a+b$。\n\\input{samples.tex}\n');
  assert.throws(() => validateBody('\\exmpfile{secret}{secret}', 'STATEMENT'), ContentPolicyError);
  assert.throws(() => render(files, 'STATEMENT', '', { title: '', author: '' }, [], 'single', [{ inputPath: '../secret', answerPath: 'samples/sample-1.ans' }]));
  assert.throws(() => printableSample(Buffer.from([0, 255])));
});

test('bound samples precede the closing Note section in single and booklet statements', async () => {
  const samples = [{ inputPath: 'samples/sample-1.in', answerPath: 'samples/sample-1.ans' }];
  for (const folder of ['statement', 'statement-compact']) {
    const files = await loadTemplateDirectory(fileURLToPath(new URL(`../../../templates/builtin/${folder}/`, import.meta.url)));
    for (const heading of ['Note', 'Notes']) {
      const beforeNote = '题目描述。\r\n\\InputFile\r\n输入格式。\r\n\\OutputFile\r\n输出格式。\r\n\r\n';
      const note = `\\${heading}\r\n第一组样例的解释。\r\n\r\n第二组样例的解释。`;
      const body = beforeNote + note;
      for (const mode of ['single', 'booklet'] as const) {
        const result = render(files, 'STATEMENT', body, { title: '样例顺序', author: '' }, [], mode, samples);
        assert.equal(result['content.tex'], beforeNote + '\n\\input{samples.tex}\n' + note);
        assert.equal(render(files, 'STATEMENT', body, { title: '', author: '' }, [], mode)['content.tex'], body);
      }
    }
  }
});

test('sample insertion ignores Note text in comments, literal code and nested arguments', async () => {
  const files = await loadTemplateDirectory(fileURLToPath(new URL('../../../templates/builtin/statement/', import.meta.url)));
  const literals = '% \\Note is a comment\n\\begin{verbatim}\n\\Notes\n\\end{verbatim}\n\\begin{centerverbatim}\n\\Note\n\\end{centerverbatim}\n\\texttt{\\Note}\n\\\\Note is escaped text\n';
  const samples = [{ inputPath: 'samples/sample-1.in', answerPath: 'samples/sample-1.ans' }];
  for (const note of ['', '\\Note\n真正的提示。']) {
    const result = render(files, 'STATEMENT', literals + note, { title: '', author: '' }, [], 'single', samples);
    assert.equal(result['content.tex'], literals + '\n\\input{samples.tex}\n' + note);
  }
});
