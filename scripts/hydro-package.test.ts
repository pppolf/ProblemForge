import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { blankManifest, digest, exportHydroProblem, fencedCode, hydroDirectory, latexToMarkdown, readArchive, safeExportPath, writeArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestDocument, type ManifestProgram } from '@problemforge/contracts';

const { parse: parseYaml } = createRequire(new URL('../packages/problem-format/package.json', import.meta.url))('yaml');
const exportedAt = new Date('2026-10-04T03:04:05Z'), directory = '测试题_2026-10-04_11-04-05';
const support = { testlib: Buffer.from('fixture header'), license: Buffer.from('fixture license') };
const document = (kind: ManifestDocument['kind'], body: string, language = 'zh-CN'): ManifestDocument => ({ id: `${kind}${language}`, revisionId: `${kind}${language}r`, version: 1, language, kind, enabled: true, body, metadata: { title: '文稿标题', author: 'Author' }, sampleRevisionIds: [], template: null });
function fixture() {
  const m = blankManifest('测试题'), store = new Map<string, Buffer>();
  const blob = (text: string | Buffer) => { const bytes = Buffer.from(text); const key = digest(bytes); store.set(key, bytes); return { key, hash: key, bytes: bytes.length }; };
  m.documents = [document('STATEMENT', String.raw`\Description 求 $a+b$。\InputFile 两个数。\OutputFile 和。\Note 说明。`), document('EDITORIAL_DOCUMENT', String.raw`\section{做法}\textbf{相加}即可。`), document('EDITORIAL_BEAMER', 'PRIVATE SLIDES')];
  m.tests = [1, 3].map(number => ({ id: `t${number}`, revisionId: `r${number}`, version: 1, number, enabled: true, isSample: number === 1, groupName: 'main', notes: 'PRIVATE NOTES', provenance: null, input: blob(`${number}  2\r\n`), answer: blob(`${number + 2}\r\n`) }));
  m.samples = [structuredClone(m.tests[0])]; m.documents[0].sampleRevisionIds = ['r1'];
  const read = async (key: string) => { assert(store.has(key), `missing blob ${key}`); return store.get(key)!; };
  return { m, store, blob, read };
}
const interactor = (): ManifestProgram => ({ id: 'interactor', revisionId: 'ir', version: 1, name: '交互器', role: 'INTERACTOR', enabled: true, notes: '', expectedVerdicts: ['AC'], source: '// unchanged source\r\n', sourceHash: digest('// unchanged source\r\n'), profile: { id: 'cpp', name: 'C++17', language: 'CPP17', version: 1, hash: '0'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 } } });

test('LaTeX prose becomes Markdown headings, nesting, lists, literal code and mathematics', () => {
  const result = latexToMarkdown(String.raw`\section*{算法}
\textbf{粗体与\emph{强调}}，\texttt{a\_b}，\verb|a_b|，转义 \% \& \$，<script>。

\begin{enumerate}
\item 第一项 $a_1+\frac{1}{2}$。
\begin{itemize}\item 嵌套。\item 还有内容。\end{itemize}
\item 第二项。
\end{enumerate}
\begin{description}\item[提示] 不丢失标签。\end{description}
\InputFile 输入。\OutputFile 输出。\interactor 协议。
\[\mat{A}=\begin{pmatrix}1&2\\3&4\end{pmatrix}\]
\begin{align}x&=1\\y&=2\end{align}
\begin{verbatim}
a_b  % keep literal


\textbf{not converted}
\end{verbatim}`);
  assert.deepEqual(result.warnings, []);
  assert.match(result.markdown, /^## 算法/); assert.match(result.markdown, /\*\*粗体与\*强调\*\*\*/);
  assert.match(result.markdown, /`a_b`/); assert.match(result.markdown, /\\<script\\>/);
  assert.match(result.markdown, /1\. 第一项 \$a_\{1\}\+\\frac\{1\}\{2\}\$/);
  assert.match(result.markdown, /\n   - 嵌套/); assert.match(result.markdown, /2\. 第二项/); assert.match(result.markdown, /- \*\*提示\*\* 不丢失标签/);
  assert.match(result.markdown, /## 输入格式/); assert.match(result.markdown, /## 输出格式/); assert.match(result.markdown, /## 交互格式/);
  assert.match(result.markdown, /\$\$\n\\boldsymbol\{\\mathrm\{A\}\}=\\begin\{pmatrix\}/);
  assert.match(result.markdown, /\\begin\{aligned\}x&=1\\\\y&=2\\end\{aligned\}/);
  assert.match(result.markdown, /a_b  % keep literal\n\n\n\\textbf\{not converted\}/);
  assert(!result.markdown.includes('\\begin{enumerate}'));
});

test('tables, explicit sample blocks, images and unsupported constructs retain their content', () => {
  const result = latexToMarkdown(String.raw`\begin{center}\begin{tabular}{c|c|l}
顺序 & 发送方 & 内容 \\
\hline
1 & 选手 & \texttt{? 1 2} \\
2 & 交互器 & $|x|$ \\
\end{tabular}\end{center}
\exmp{1  2
3
}{6
}
\includegraphics[width=.5\textwidth]{assets/image1.png}
\unknown{不丢弃}
\begin{unknownenvironment}保留原始内容\end{unknownenvironment}`);
  assert.match(result.markdown, /\| 顺序 \| 发送方 \| 内容 \|\n\| --- \| --- \| --- \|/);
  assert.match(result.markdown, /\| 1 \| 选手 \| `\? 1 2` \|/);
  assert.match(result.markdown, /\$\\\|x\\\|\$/); assert.match(result.markdown, /```text\n1  2\n3\n```/);
  assert.deepEqual(result.assets, ['assets/image1.png']); assert.match(result.markdown, /!\[题目插图\]\(assets\/image1.png\)/);
  assert.equal(result.warnings.length, 2); assert.match(result.markdown, /不丢弃/); assert.match(result.markdown, /```latex\n\\begin\{unknownenvironment\}保留原始内容/);
  assert.match(latexToMarkdown(String.raw`\InputFile Input.`, { language: 'en' }).markdown, /^## Input/);
  assert.throws(() => latexToMarkdown(String.raw`\includegraphics{../../outside.png}`), /图片引用/);
  assert.match(latexToMarkdown('{unclosed').markdown, /\\\{unclosed/);
});

test('code fences cannot be closed by sample contents', () => {
  assert.equal(fencedCode('```\n# literal\n````\n'), '`````text\n```\n# literal\n````\n`````');
});

test('Hydro package has the requested UTF-8 tree, current documents and pinned samples', async () => {
  const { m, blob, read } = fixture();
  m.tests[0].input = blob('NEW SAMPLE\n'); // The statement still binds r1, not this working input.
  m.tests[1].input = blob(Buffer.from([0, 255, 13, 10]));
  m.documents[0].body += String.raw`\includegraphics{assets/pic.png}`;
  m.documents[1].body += String.raw`\includegraphics{assets/pic.png}`;
  m.assets = [{ id: 'pic', name: '插图', path: 'assets/pic.png', mediaType: 'image/png', blob: blob(Buffer.from([137, 80, 78, 71])) }, { id: 'unused', name: 'private', path: 'assets/unused.jpg', mediaType: 'image/jpeg', blob: blob('PRIVATE IMAGE') }];
  const before = structuredClone(m), result = await exportHydroProblem(m, read, support, { exportedAt });
  const zip = await writeArchive(result.files, { unicodePaths: true });
  const files = await readArchive(zip, { unicodePaths: true });
  assert.deepEqual([...files.keys()], ['statement.md', '题解.md', 'assets/pic.png', 'tests/1.in', 'tests/1.ans', 'tests/3.in', 'tests/3.ans', 'tests/checker.cc', 'tests/config.yaml'].map(p => `${directory}/${p}`));
  assert.equal(result.report.find(r => r.fileName)?.fileName, `${directory}.zip`);
  const statement = files.get(`${directory}/statement.md`)!.toString();
  assert.match(statement, /^# 文稿标题/); assert.match(statement, /```text\n1  2\r\n```/);
  assert(statement.indexOf('## 样例') < statement.indexOf('## 说明'));
  assert(!statement.includes('NEW SAMPLE')); assert(!statement.includes('PRIVATE'));
  assert.match(files.get(`${directory}/题解.md`)!.toString(), /## 做法\n\n\*\*相加\*\*即可/);
  assert.deepEqual(files.get(`${directory}/tests/3.in`), Buffer.from([0, 255, 13, 10]));
  assert.equal(files.get(`${directory}/tests/1.in`)!.toString(), 'NEW SAMPLE\n');
  assert.deepEqual(parseYaml(files.get(`${directory}/tests/config.yaml`)!.toString()).cases, [{ input: '1.in', output: '1.ans' }, { input: '3.in', output: '3.ans' }]);
  assert(!result.report.some(r => /ZIP 根目录|不含.*题面/.test(r.message)));
  assert.deepEqual(m, before);
  await assert.rejects(readArchive(zip), /不安全/); // The untrusted import policy is not broadened.
});

test('interactive hidden tests stay input-only while bound sample output is in Markdown', async () => {
  const { m, read } = fixture(); m.judgeSettings.interactionMode = 'INTERACTIVE'; m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [interactor()];
  const unreadableAnswer = m.tests[1].answer!.key;
  const result = await exportHydroProblem(m, key => { assert.notEqual(key, unreadableAnswer); return read(key); }, support, { exportedAt });
  const paths = [...result.files.keys()];
  assert(!paths.some(p => p.endsWith('.ans') || p.endsWith('tests/1.in') || p.endsWith('checker.cc')));
  assert.equal(result.files.get(`${directory}/tests/interactor.cc`)!.toString(), m.programs[0].source);
  assert.deepEqual(result.files.get(`${directory}/tests/testlib.h`), support.testlib);
  assert.match(result.files.get(`${directory}/statement.md`)!.toString(), /样例输出 1\n\n```text\n3\r\n```/);
  const config = parseYaml(result.files.get(`${directory}/tests/config.yaml`)!.toString());
  assert.deepEqual(config.interactor, { file: 'interactor.cc', lang: 'auto' });
  assert.deepEqual(config.subtasks, [{ score: 100, id: 1, type: 'sum', cases: [{ input: '3.in', output: '/dev/null' }] }]);
});

test('language, disabled documents and missing editorial are explicit', async () => {
  const { m, read } = fixture();
  m.documents.push(document('STATEMENT', String.raw`\InputFile English input.`, 'en'));
  const en = await exportHydroProblem(m, read, support, { exportedAt, language: 'en' });
  assert.match(en.files.get(`${directory}/statement.md`)!.toString(), /## Input/);
  assert.match(en.files.get(`${directory}/题解.md`)!.toString(), /No enabled document editorial/);
  assert(en.report.some(r => r.area === '题解.md' && r.status === 'WARNING'));
  m.documents[1].enabled = false; m.documents[1].body = 'SECRET DISABLED EDITORIAL';
  const zh = await exportHydroProblem(m, read, support, { exportedAt });
  assert(!zh.files.get(`${directory}/题解.md`)!.includes('SECRET'));
  await assert.rejects(exportHydroProblem(m, read, support, { language: 'fr' }), /缺少已启用/);
  m.documents[0].enabled = false;
  await assert.rejects(exportHydroProblem(m, read, support, { language: 'zh-CN' }), /缺少已启用/);
});

test('missing or damaged images and bound samples fail instead of silently losing content', async () => {
  const { m, read, blob } = fixture();
  m.documents[0].body += String.raw`\includegraphics{assets/pic.png}`;
  await assert.rejects(exportHydroProblem(m, read, support), /图片不存在/);
  m.assets = [{ id: 'pic', name: 'pic', path: 'assets/pic.png', mediaType: 'image/png', blob: { ...blob('image'), hash: '0'.repeat(64) } }];
  await assert.rejects(exportHydroProblem(m, read, support), /图片字节或 SHA-256/);
  m.documents[0].body = 'body'; m.samples[0].input = blob(Buffer.from([255]));
  await assert.rejects(exportHydroProblem(m, read, support), /UTF-8/);
  m.samples = [];
  await assert.rejects(exportHydroProblem(m, read, support), /样例版本/);
});

test('Chinese export filenames are bounded and cannot escape the destination', async () => {
  assert.equal(hydroDirectory('测试题', exportedAt), directory);
  assert.equal(hydroDirectory('题/名:称?*\r\n', exportedAt), '题_名_称_____2026-10-04_11-04-05');
  assert(hydroDirectory('题'.repeat(160), exportedAt).length < 110);
  assert(hydroDirectory('😀'.repeat(160), exportedAt).length < 110);
  for (const path of ['../题解.md', '/题解.md', 'dir/../题解.md', 'dir\\题解.md', 'CON/file', 'a/题\u202e解.md', 'a/题解.md.']) assert.throws(() => safeExportPath(path), /不安全/);
  await assert.rejects(writeArchive(new Map([['题/a.md', Buffer.from('a')], ['题/A.md', Buffer.from('b')]]), { unicodePaths: true }), /重复/);
});
