import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { blankManifest, digest, exportNovaJudgeProblem, exportNovaJudgeContest, latexToMarkdown, novaJudgeDirectory, readArchive, writeArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestDocument, type ManifestProgram } from '@problemforge/contracts';

const require = createRequire(new URL('../packages/problem-format/package.json', import.meta.url));
const { parse: parseYaml } = require('yaml'), { fromBuffer } = require('yauzl');
const support = { testlib: Buffer.from('fixture header'), license: Buffer.from('fixture license') };
function fixture() {
  const m = blankManifest('测试题'), store = new Map<string, Buffer>();
  const blob = (content: string | Buffer) => { const bytes = Buffer.from(content), key = digest(bytes); store.set(key, bytes); return { key, hash: key, bytes: bytes.length }; };
  const doc = (kind: ManifestDocument['kind'], body: string): ManifestDocument => ({ id: kind, revisionId: kind + 'r', version: 1, language: 'zh-CN', kind, enabled: true, body, metadata: { title: '文稿标题', author: 'PRIVATE AUTHOR' }, sampleRevisionIds: [], template: null });
  m.documents = [doc('STATEMENT', String.raw`题目正文 $a+b$。\InputFile 两个数。\OutputFile 和。\Examples\begin{example}\exmp{内嵌输入}{内嵌输出}\end{example}\Note 样例说明。`), doc('EDITORIAL_DOCUMENT', 'PRIVATE EDITORIAL'), doc('EDITORIAL_BEAMER', 'PRIVATE SLIDES')];
  m.tests = [3, 1].map(number => ({ id: `t${number}`, revisionId: `r${number}`, version: 1, number, enabled: true, isSample: number === 1, groupName: 'main', notes: 'PRIVATE NOTES', provenance: null, input: blob(`${number}  2\r\n`), answer: blob(`${number + 2}\r\n`) }));
  m.samples = [structuredClone(m.tests[1])]; m.documents[0].sampleRevisionIds = ['r1'];
  const read = async (key: string) => { assert(store.has(key), `missing blob ${key}`); return store.get(key)!; };
  return { m, blob, read, store };
}
const tool = (role: ManifestProgram['role']): ManifestProgram => ({ id: role, revisionId: role + 'r', version: 1, name: role, role, enabled: true, notes: '', expectedVerdicts: ['AC'], source: '#include "testlib.h"\r\n// Fixed source\r\n', sourceHash: digest('#include "testlib.h"\r\n// Fixed source\r\n'), profile: { id: 'cpp', name: 'C++17', language: 'CPP17', version: 1, hash: '0'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 } } });
const metadata = (files: Map<string, Buffer>) => JSON.parse([...files].find(([path]) => path.endsWith('/problem.json'))![1].toString());
const config = (files: Map<string, Buffer>) => parseYaml([...files].find(([path]) => path.endsWith('/data/problem.yml'))![1].toString());

test('contest packages contain ordered standalone folders for all three types and isolate same-named assets', async () => {
  const fixtures = [fixture(), fixture(), fixture()], codes = ['C', 'A', 'B'];
  fixtures[1].m.judgeSettings.checkerMode = 'CUSTOM'; fixtures[1].m.programs = [tool('CHECKER')];
  fixtures[2].m.judgeSettings.interactionMode = 'INTERACTIVE'; fixtures[2].m.programs = [tool('INTERACTOR')];
  for (const [i, f] of fixtures.entries()) {
    f.m.documents[0].body += String.raw`\includegraphics{assets/pic.png}`;
    f.m.assets = [{ id: 'pic', name: 'same image name', path: 'assets/pic.png', mediaType: 'image/png', blob: f.blob(`image-${i}`) }];
    f.m.meta.tags = ['math'];
  }
  const before = fixtures.map(f => structuredClone(f.m)), store = new Map(fixtures.flatMap(f => [...f.store]));
  const result = await exportNovaJudgeContest('测试比赛', fixtures.map((f, i) => ({ code: codes[i], manifest: f.m })), async key => store.get(key)!, support, { language: 'zh-CN' });
  const zip = await writeArchive(result.files, { unicodePaths: true, explicitDirectories: true }), files = await readArchive(zip, { unicodePaths: true });
  const roots = fixtures.map((_, i) => `${String(i + 1).padStart(3, '0')}_${codes[i]}_测试题`);
  assert.deepEqual([...new Set([...files.keys()].map(path => path.split('/')[0]))], roots);
  assert([...files.keys()].every(path => !path.endsWith('.zip')));
  for (const [i, root] of roots.entries()) {
    const json = JSON.parse(files.get(`${root}/problem.json`)!.toString());
    assert.equal(json.id, i + 1); assert.equal(json.type, ['default', 'spj', 'interactive'][i]);
    assert.equal(json.title, '测试题');
    assert.match(json.hint, new RegExp(`/api/problems/${i + 1}/assets/pic.png`));
    assert.equal(files.get(`${root}/assets/pic.png`)!.toString(), `image-${i}`);
    assert.deepEqual(parseYaml(files.get(`${root}/data/problem.yml`)!.toString()), json.judgeConfig);
    assert.equal(files.get(`${root}/data/3.in`)!.toString(), '3  2\r\n');
    assert(!JSON.stringify(json).includes('PRIVATE'));
  }
  assert(files.has(`${roots[1]}/data/checker.cpp`)); assert(files.has(`${roots[2]}/data/interactor.cpp`));
  assert(!files.has(`${roots[2]}/data/1.in`)); assert(!files.has(`${roots[2]}/data/3.ans`));
  assert.deepEqual(fixtures.map(f => f.m), before);
  assert.equal(result.report.filter(r => r.fileName).length, 1);
  assert.equal(result.report.find(r => r.fileName)?.fileName, 'contest_测试比赛_NovaJudge.zip');
  assert(result.report.some(r => r.area === 'C/答案比较' && r.status === 'WARNING'));
  assert.equal(result.report.filter(r => r.area.endsWith('/图片') && r.status === 'MAPPED').length, 3);
  assert.equal(result.report.filter(r => r.area.endsWith('/标签') && r.status === 'WARNING').length, 3);
  assert.match(result.report.find(r => r.area === '导入位置')!.message, /不会自动创建比赛/);
  const directories = await new Promise<string[]>((resolve, reject) => fromBuffer(zip, { lazyEntries: true }, (error: Error, archive: any) => {
    if (error) return reject(error); const entries: string[] = [];
    archive.on('error', reject); archive.on('entry', (entry: any) => { if (entry.fileName.endsWith('/')) entries.push(entry.fileName); archive.readEntry(); });
    archive.on('end', () => resolve(entries)); archive.readEntry();
  }));
  for (const root of roots) assert(directories.includes(`${root}/`));
});

test('contest order survives the target importer sort beyond nine problems', async () => {
  const { m, read } = fixture(), codes = Array.from({ length: 12 }, (_, i) => String.fromCharCode(76 - i));
  const result = await exportNovaJudgeContest('多题比赛', codes.map(code => ({ code, manifest: m })), read, support, { comparison: 'PRESERVE' });
  const roots = [...new Set([...result.files.keys()].map(path => path.split('/')[0]))];
  const sorted = [...roots].sort((a, b) => { const x = parseInt(a), y = parseInt(b); return !isNaN(x) && !isNaN(y) ? x - y : a.localeCompare(b); });
  assert.deepEqual(sorted, roots); assert.deepEqual([...roots].sort(), roots);
  assert.deepEqual(roots.map(r => r.split('_')[1]), codes);
  assert.equal(JSON.parse(result.files.get(`${roots[11]}/problem.json`)!.toString()).id, 12);
  assert.equal(JSON.parse(result.files.get(`${roots[0]}/problem.json`)!.toString()).type, 'spj');
});

test('invalid contest contents fail the whole export with the affected problem code', async () => {
  const { m, read } = fixture();
  await assert.rejects(exportNovaJudgeContest('x', [], read, support), /1～100/);
  await assert.rejects(exportNovaJudgeContest('x', [{ code: 'A', manifest: m }, { code: 'A', manifest: m }], read, support), /题号不能重复/);
  await assert.rejects(exportNovaJudgeContest('x', [{ code: '../A', manifest: m }], read, support), /比赛题号无效/);
  const missing = structuredClone(m); missing.tests[0].answer = null;
  await assert.rejects(exportNovaJudgeContest('x', [{ code: 'A', manifest: m }, { code: 'B', manifest: missing }], read, support), /题号 B：.*缺少答案/);
  await assert.rejects(exportNovaJudgeContest('x', [{ code: 'A', manifest: m }], read, support, { language: 'fr' }), /题号 A：.*缺少已启用/);
});

test('traditional package matches the supplied JSON/YAML layout, samples, assets and explicit ZIP directories', async () => {
  const { m, blob, read } = fixture();
  m.judgeSettings.timeLimitMs = 2500; m.judgeSettings.memoryLimitMb = 512;
  m.tests[1].input = blob('UPDATED INPUT\n');
  m.documents[0].body += String.raw`\includegraphics{assets/pic.png}`;
  m.assets = [{ id: 'pic', name: '插图', path: 'assets/pic.png', mediaType: 'image/png', blob: blob('image bytes') }, { id: 'unused', name: 'private', path: 'assets/unused.png', mediaType: 'image/png', blob: blob('PRIVATE IMAGE') }];
  const before = structuredClone(m), result = await exportNovaJudgeProblem(m, read, support);
  const zip = await writeArchive(result.files, { unicodePaths: true, explicitDirectories: true });
  const files = await readArchive(zip, { unicodePaths: true }), json = metadata(files);
  assert.deepEqual(Object.keys(json), ['id', 'title', 'type', 'defaultTimeLimit', 'defaultMemoryLimit', 'sections', 'samples', 'hint', 'judgeConfig']);
  assert.equal(json.id, 1); assert.equal(json.title, '测试题'); assert.equal(json.type, 'default');
  assert.equal(json.defaultTimeLimit, 2500); assert.equal(json.defaultMemoryLimit, 512);
  assert.deepEqual(json.sections, [{ title: 'Problem Description', content: '题目正文 $a+b$。' }, { title: 'Input', content: '两个数。' }, { title: 'Output', content: '和。' }]);
  assert.deepEqual(json.samples, [{ input: '内嵌输入', output: '内嵌输出' }, { input: '1  2\r\n', output: '3\r\n' }]);
  assert.match(json.hint, /样例说明/); assert.match(json.hint, /\/api\/problems\/1\/assets\/pic.png/);
  assert.deepEqual(json.judgeConfig, { cases: [{ input: '1.in', output: '1.ans' }, { input: '3.in', output: '3.ans' }] });
  assert.deepEqual(config(files), json.judgeConfig);
  assert.deepEqual([...files.keys()].sort(), ['assets/pic.png', 'problem.json', 'data/1.in', 'data/1.ans', 'data/3.in', 'data/3.ans', 'data/problem.yml'].map(p => 'problem_1_测试题/' + p).sort());
  assert.equal(files.get('problem_1_测试题/data/1.in')!.toString(), 'UPDATED INPUT\n');
  assert(!JSON.stringify(json).includes('PRIVATE')); assert.deepEqual(m, before);
  assert.equal(result.report.find(r => r.fileName)?.fileName, 'problem_1_测试题.zip');
  assert(result.report.some(r => r.area === '答案比较' && r.status === 'WARNING'));
  assert(!result.report.some(r => /上传测试数据不会|ZIP 根目录|不含.*题面/.test(r.message)));
  const entries = await new Promise<string[]>((resolve, reject) => fromBuffer(zip, { lazyEntries: true }, (error: Error, archive: any) => {
    if (error) return reject(error); const paths: string[] = [];
    archive.on('error', reject); archive.on('entry', (entry: any) => { paths.push(entry.fileName); archive.readEntry(); });
    archive.on('end', () => resolve(paths)); archive.readEntry();
  }));
  // NovaJudge's importer only discovers roots with an explicit directory member.
  const roots = entries.filter(p => p.endsWith('/') && entries.includes(p + 'problem.json'));
  assert.deepEqual(roots, ['problem_1_测试题/']);
  assert(entries.includes('problem_1_测试题/assets/')); assert(entries.includes('problem_1_测试题/data/'));
  await assert.rejects(writeArchive(new Map([['root', Buffer.from('a')], ['root/file', Buffer.from('b')]]), { explicitDirectories: true }), /目录路径冲突/);
  await assert.rejects(writeArchive(new Map([['root/a', Buffer.from('a')], ['Root/b', Buffer.from('b')]]), { explicitDirectories: true }), /目录路径冲突/);
});

test('custom SPJ and float/preserved comparison include the matching fixed checker', async () => {
  const { m, read } = fixture(); m.judgeSettings.checkerMode = 'CUSTOM'; m.programs = [tool('CHECKER'), tool('MAIN_SOLUTION')];
  const { files, report } = await exportNovaJudgeProblem(m, read, support);
  assert.equal(metadata(files).type, 'spj'); assert.equal(metadata(files).judgeConfig.checker, 'checker.cpp');
  assert.deepEqual(config(files), metadata(files).judgeConfig);
  assert.equal(files.get('problem_1_测试题/data/checker.cpp')!.toString(), m.programs[0].source);
  assert.deepEqual(files.get('problem_1_测试题/data/testlib.h'), support.testlib);
  assert.deepEqual(files.get('problem_1_测试题/data/testlib.LICENSE'), support.license);
  assert(!report.some(r => r.status === 'BLOCKED'));
  m.programs = []; await assert.rejects(exportNovaJudgeProblem(m, read, support), /一个 Checker/);
  m.programs = [tool('CHECKER')]; m.programs[0].source += '!'; await assert.rejects(exportNovaJudgeProblem(m, read, support), /源码哈希/);
  for (const checkerMode of ['EXACT', 'TOKENS', 'FLOAT'] as const) {
    m.judgeSettings.checkerMode = checkerMode;
    const result = await exportNovaJudgeProblem(m, read, support, checkerMode === 'FLOAT' ? {} : { comparison: 'PRESERVE' });
    assert.equal(metadata(result.files).type, 'spj');
    assert.match(result.files.get('problem_1_测试题/data/checker.cpp')!.toString(), new RegExp(`Generated by ProblemForge: ${checkerMode}`));
  }
});

test('interactive package preserves displayed samples but exports only hidden inputs with /dev/null', async () => {
  const { m, read } = fixture(); m.judgeSettings.interactionMode = 'INTERACTIVE'; m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [tool('INTERACTOR')];
  m.documents[0].body = String.raw`\Description 交互题。\Interaction 刷新输出。\InteractionQuery 询问。\Note 解释。`;
  m.tests[0].answer = { key: 'must-not-read', hash: '0'.repeat(64), bytes: 1 };
  const before = structuredClone(m), { files } = await exportNovaJudgeProblem(m, read, support), json = metadata(files);
  assert.equal(json.type, 'interactive');
  assert.deepEqual(json.judgeConfig, { interactor: 'interactor.cpp', cases: [{ input: '3.in', output: '/dev/null' }] });
  assert.deepEqual(config(files), json.judgeConfig);
  assert.deepEqual(json.samples, [{ input: '1  2\r\n', output: '3\r\n' }]);
  assert.equal(json.sections[1].title, 'Interaction'); assert.match(json.sections[1].content, /### 询问/);
  assert.equal(files.get('problem_1_测试题/data/interactor.cpp')!.toString(), m.programs[0].source);
  assert(![...files.keys()].some(p => p.endsWith('.ans') || p.endsWith('/1.in') || p.endsWith('checker.cpp') || p.includes('dev/null')));
  assert.deepEqual(m, before);
  m.judgeSettings.interaction.verdictMode = 'CHECKER';
  assert((await exportNovaJudgeProblem(m, read, support)).report.some(r => r.area === '交互判定' && r.status === 'BLOCKED'));
  m.tests = m.tests.filter(t => t.isSample); await assert.rejects(exportNovaJudgeProblem(m, read, support), /非样例测试数据/);
});

test('AST sections keep literal headings in code and samples, empty outputs and language selection', async () => {
  const result = latexToMarkdown(String.raw`\section{题目描述}描述。\begin{verbatim}
## Input
literal
\end{verbatim}\InputFile 输入。\exmp{## Note
}{}` + String.raw`\Note 解释。\section{额外约束}条件。`, { statement: true, structuredStatement: true, samples: [{ input: '\n\n', output: '' }] });
  assert.deepEqual(result.sections.map(s => s.title), ['Problem Description', 'Input', '额外约束']);
  assert.match(result.sections[0].content, /```text\n## Input\nliteral/);
  assert.deepEqual(result.samples, [{ input: '## Note\n', output: '' }, { input: '\n\n', output: '' }]);
  assert.equal(result.hint, '解释。');
  const { m, read } = fixture(); m.documents.push({ ...m.documents[0], id: 'en', language: 'en', body: String.raw`\Description English.\InputFile Input.`, sampleRevisionIds: [] });
  const en = metadata((await exportNovaJudgeProblem(m, read, support, { language: 'en' })).files);
  assert.equal(en.sections[0].content, 'English.'); assert.deepEqual(en.samples, []);
  await assert.rejects(exportNovaJudgeProblem(m, read, support, { language: 'fr' }), /缺少已启用/);
});

test('missing or corrupt data/assets/samples fail, unsupported judging settings are reported', async () => {
  const { m, read, blob } = fixture();
  m.tests[0].answer = null; await assert.rejects(exportNovaJudgeProblem(m, read, support), /缺少答案/);
  m.tests[0].answer = blob('3'); m.documents[0].body = String.raw`\includegraphics{assets/pic.png}`;
  await assert.rejects(exportNovaJudgeProblem(m, read, support), /图片不存在/);
  m.assets = [{ id: 'pic', name: 'pic', path: 'assets/pic.png', mediaType: 'image/png', blob: { ...blob('image'), hash: '0'.repeat(64) } }];
  await assert.rejects(exportNovaJudgeProblem(m, read, support), /图片字节或 SHA-256/);
  m.documents[0].body = 'body'; m.samples[0].input = blob(Buffer.from([255]));
  await assert.rejects(exportNovaJudgeProblem(m, read, support), /UTF-8/);
  m.documents[0].sampleRevisionIds = []; m.tests[0].input = blob(Buffer.from([255]));
  m.judgeSettings.scoringMode = 'PARTIAL'; m.judgeSettings.ioMode = 'FILES';
  const { report } = await exportNovaJudgeProblem(m, read, support);
  assert.deepEqual(report.filter(r => r.status === 'BLOCKED').map(r => r.area), ['数据编码', '文件输入输出', '分组评分']);
  m.documents[0].enabled = false; await assert.rejects(exportNovaJudgeProblem(m, read, support), /缺少已启用/);
  assert.equal(novaJudgeDirectory('../题/目:名?'), 'problem_1_.._题_目_名_');
  assert(novaJudgeDirectory('😀'.repeat(160)).length < 100);
});
