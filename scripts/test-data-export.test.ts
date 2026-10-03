import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { blankManifest, digest, exportTestData, nativeExporter, polygonExporter, selectManifest, readArchive, writeArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestProgram } from '@problemforge/contracts';

const { parse: parseYaml } = createRequire(new URL('../packages/problem-format/package.json', import.meta.url))('yaml');
const support = { testlib: Buffer.from('test header'), license: Buffer.from('test license') };
function fixture() {
  const m = blankManifest('Private title'), store = new Map<string, Buffer>();
  const blob = (bytes: Buffer) => { const key = digest(bytes); store.set(key, bytes); return { key, hash: key, bytes: bytes.length }; };
  m.tests = [2, 1, 3].map(number => ({ id: `t${number}`, revisionId: `r${number}`, version: 1, number, enabled: number !== 3, isSample: number === 1, groupName: 'main', notes: 'private note', provenance: null, input: blob(Buffer.from(`input ${number}\r\n`)), answer: blob(Buffer.from(`answer ${number} \n`)) }));
  const read = async (key: string) => { assert(store.has(key)); return store.get(key)!; };
  return { m, store, blob, read };
}
const program = (role: ManifestProgram['role']): ManifestProgram => ({ id: role, revisionId: role + 'r', version: 1, name: role, role, enabled: true, notes: 'secret', expectedVerdicts: ['AC'], source: '// source\r\n', sourceHash: digest('// source\r\n'), profile: { id: 'cpp', name: 'C++17', language: 'CPP17', version: 1, hash: '0'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 } } });

test('flat ZIP preserves large/binary bytes, sample, numbers and omits private material', async () => {
  const { m, blob, read } = fixture();
  m.tests[0].input = blob(Buffer.concat([Buffer.from([0, 255, 13, 10]), Buffer.alloc(2_100_000, 65)]));
  m.programs = [program('MAIN_SOLUTION'), program('GENERATOR'), program('VALIDATOR')];
  const before = structuredClone(m), result = await exportTestData(m, 'HYDRO', read, support);
  const files = await readArchive(await writeArchive(result.files));
  assert.deepEqual([...files.keys()], ['1.in', '1.ans', '2.in', '2.ans', 'checker.cc', 'config.yaml']);
  assert.deepEqual(files.get('2.in'), await read(m.tests[0].input.key));
  assert.deepEqual(files.get('1.ans'), await read(m.tests[1].answer!.key));
  assert.deepEqual(m, before);
  const config = parseYaml(files.get('config.yaml')!.toString());
  assert.equal(config.type, 'default'); assert.equal(config.time, '1000ms'); assert.equal(config.memory, '256m');
  assert.deepEqual(config.checker, { file: 'checker.cc', lang: 'cc' });
  assert.deepEqual(config.cases, [{ input: '1.in', output: '1.ans' }, { input: '2.in', output: '2.ans' }]);
  assert(!result.report.some(i => i.status === 'BLOCKED'));
});

test('target-specific checker names preserve custom sources and dependencies', async () => {
  const { m, read } = fixture(); m.judgeSettings.checkerMode = 'CUSTOM';
  m.programs = [program('CHECKER'), program('MAIN_SOLUTION'), program('INTERACTOR')];
  for (const target of ['HYDRO', 'NOVAJUDGE'] as const) {
    const { files, report } = await exportTestData(m, target, read, support);
    const name = target === 'HYDRO' ? 'checker.cc' : 'checker.cpp';
    assert.equal(files.get(name)!.toString(), m.programs[0].source);
    assert.equal(files.get('testlib.h'), support.testlib); assert.equal(files.get('testlib.LICENSE'), support.license);
    assert(!files.has('interactor.cpp')); assert(!files.has('interactor.cc'));
    assert(!files.has(target === 'HYDRO' ? 'checker.cpp' : 'checker.cc'));
    const config = parseYaml(files.get(target === 'HYDRO' ? 'config.yaml' : 'problem.yml')!.toString());
    assert.deepEqual(config.checker, target === 'HYDRO' ? { file: name, lang: 'cc' } : name);
    assert.equal(config.cases.length, 2);
    if (target === 'NOVAJUDGE') { assert.equal(config.type, 'spj'); assert(report.some(r => r.area === '时间与内存' && r.status === 'WARNING')); }
  }
});

test('empty, missing answer, duplicate number, corrupt blobs/tools reject before archive', async () => {
  const { m, read } = fixture(), exportNow = () => exportTestData(m, 'HYDRO', read, support);
  m.tests[0].answer = null; await assert.rejects(exportNow, /缺少答案/);
  m.tests[0].answer = m.tests[1].answer; m.tests[0].number = 1; await assert.rejects(exportNow, /编号重复/);
  m.tests[0].number = 2; m.tests[0].input.hash = '0'.repeat(64); await assert.rejects(exportNow, /SHA-256/);
  m.tests[0].enabled = false; m.judgeSettings.checkerMode = 'CUSTOM'; await assert.rejects(exportNow, /一个 Checker/);
  m.programs = [program('CHECKER'), program('CHECKER')]; await assert.rejects(exportNow, /一个 Checker/);
  m.programs = [program('CHECKER')]; m.programs[0].source += '!'; await assert.rejects(exportNow, /源码哈希/);
  m.tests = []; await assert.rejects(exportNow, /没有可导出/);
});

test('interaction packages only inputs and the target-named interactor, never reads saved answers', async () => {
  const { m, read } = fixture(); m.judgeSettings.interactionMode = 'INTERACTIVE';
  m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [program('INTERACTOR')]; m.tests[0].answer = null;
  m.tests[2].enabled = true;
  m.tests[2].answer = { key: 'unread-answer', hash: '0'.repeat(64), bytes: 1 };
  const before = structuredClone(m);
  for (const target of ['HYDRO', 'NOVAJUDGE'] as const) {
    const { files, report } = await exportTestData(m, target, read, support);
    const name = target === 'HYDRO' ? 'interactor.cc' : 'interactor.cpp';
    assert.equal(files.get(name)!.toString(), m.programs[0].source);
    assert(![...files.keys()].some(p => p.endsWith('.ans')));
    assert(!files.has('checker.cpp')); assert(!files.has('checker.cc')); assert(!files.has('1.in'));
    assert(!files.has(target === 'HYDRO' ? 'interactor.cpp' : 'interactor.cc'));
    const config = parseYaml(files.get(target === 'HYDRO' ? 'config.yaml' : 'problem.yml')!.toString());
    assert.equal(config.type, 'interactive'); assert(!report.some(r => r.area === '交互答案'));
    assert.deepEqual(config.interactor, target === 'HYDRO' ? { file: name, lang: 'auto' } : name);
    if (target === 'HYDRO') {
      assert.deepEqual(config.subtasks, [{ score: 100, id: 1, type: 'sum', cases: [{ input: '2.in', output: '/dev/null' }, { input: '3.in', output: '/dev/null' }] }]);
      assert(!('cases' in config));
    } else assert.deepEqual(config.cases, [{ input: '2.in' }, { input: '3.in' }]);
    if (target === 'NOVAJUDGE') assert(report.some(r => r.area === '交互协议'));
    assert.deepEqual(m, before);
  }
  m.judgeSettings.interaction.verdictMode = 'CHECKER';
  const result = await exportTestData(m, 'HYDRO', read, support);
  assert(result.files.has('checker.cc')); assert(![...result.files.keys()].some(p => p.endsWith('.ans')));
  assert(result.report.some(r => r.area === '交互判定' && r.status === 'BLOCKED'));
});

test('Hydro interactive YAML follows the supplied subtask layout with actual case numbers and limits', async () => {
  const { m, read } = fixture();
  m.judgeSettings.interactionMode = 'INTERACTIVE'; m.programs = [program('INTERACTOR')];
  const hidden = m.tests[0];
  m.tests = Array.from({ length: 53 }, (_, i) => ({ ...hidden, id: `t${i + 2}`, revisionId: `r${i + 2}`, number: i + 2 }));
  const { files } = await exportTestData(m, 'HYDRO', read, support);
  const yaml = files.get('config.yaml')!.toString();
  const expected = `type: interactive\ntime: 1000ms\nmemory: 256m\ninteractor:\n  file: interactor.cc\n  lang: auto\nsubtasks:\n  - score: 100\n    id: 1\n    type: sum\n    cases:\n${Array.from({ length: 53 }, (_, i) => `      - input: ${i + 2}.in\n        output: /dev/null\n`).join('')}`;
  assert.equal(yaml, expected);
  const config = parseYaml(yaml);
  for (const c of config.subtasks[0].cases) { assert(files.has(c.input)); assert.equal(c.output, '/dev/null'); }
  assert(!files.has('/dev/null')); assert(![...files.keys()].some(name => name.endsWith('.ans')));
  // The pasted example is a format, not a hard-coded set of case numbers or limits.
  m.tests = [m.tests[8], m.tests[1]]; m.judgeSettings.timeLimitMs = 2500; m.judgeSettings.memoryLimitMb = 512;
  const changed = parseYaml((await exportTestData(m, 'HYDRO', read, support)).files.get('config.yaml')!.toString());
  assert.equal(changed.time, '2500ms'); assert.equal(changed.memory, '512m');
  assert.deepEqual(changed.subtasks[0].cases.map((c: any) => c.input), ['3.in', '10.in']);
});

test('interactive examples stay in statements and native backups, never in judging archives', async () => {
  const { m, read } = fixture(); m.judgeSettings.interactionMode = 'INTERACTIVE';
  m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [program('INTERACTOR')];
  m.samples = [structuredClone(m.tests.find(t => t.isSample)!)];
  m.documents = [{ id: 'doc', revisionId: 'dr', version: 1, language: 'zh-CN', kind: 'STATEMENT', enabled: true, body: 'example', metadata: { title: 't', author: '' }, sampleRevisionIds: [m.samples[0].revisionId], template: null }];
  assert.equal(selectManifest(m, 'STATEMENT').samples.length, 1);
  assert.equal(selectManifest(m, 'FULL').tests.length, 3);
  assert.deepEqual(selectManifest(m, 'DATA').tests.map(t => t.number), [2]);
  const native = await nativeExporter.export(m, 'DATA', read);
  assert.deepEqual(JSON.parse(native.files.get('problemforge.json')!.toString()).manifest.tests.map((t: any) => t.number), [2]);
  const polygon = await polygonExporter.export(m, 'FULL', read);
  assert.match(polygon.files.get('problem.xml')!.toString(), /<test-count>1<\/test-count>/);
  assert.deepEqual(polygon.files.get('tests/001'), await read(m.tests[0].input.key));
  m.tests = m.tests.filter(t => t.isSample);
  for (const target of ['HYDRO', 'NOVAJUDGE'] as const) await assert.rejects(exportTestData(m, target, read, support), /非样例测试数据/);
});

test('unsupported scoring, file I/O and NovaJudge binary text conversions are explicit', async () => {
  const { m, blob, read } = fixture(); m.judgeSettings.scoringMode = 'PARTIAL'; m.judgeSettings.ioMode = 'FILES';
  m.tests[0].input = blob(Buffer.from([255]));
  const { report } = await exportTestData(m, 'NOVAJUDGE', read, support);
  assert.deepEqual(report.filter(r => r.status === 'BLOCKED').map(r => r.area), ['数据编码', '文件输入输出', '分组评分']);
});
