import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankManifest, digest, exportTestData, readArchive, writeArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestProgram } from '@problemforge/contracts';

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
  assert.deepEqual([...files.keys()], ['1.in', '1.ans', '2.in', '2.ans', 'checker.cpp', 'config.yaml']);
  assert.deepEqual(files.get('2.in'), await read(m.tests[0].input.key));
  assert.deepEqual(files.get('1.ans'), await read(m.tests[1].answer!.key));
  assert.deepEqual(m, before);
  const config = JSON.parse(files.get('config.yaml')!.toString());
  assert.equal(config.type, 'default'); assert.equal(config.time, '1000ms'); assert.equal(config.memory, '256m');
  assert.deepEqual(config.checker, { file: 'checker.cpp', lang: 'cc' });
  assert.deepEqual(config.cases, [{ input: '1.in', output: '1.ans' }, { input: '2.in', output: '2.ans' }]);
  assert(!result.report.some(i => i.status === 'BLOCKED'));
});

test('NovaJudge explicitly selects SPJ and preserves custom checker with dependencies', async () => {
  const { m, read } = fixture(); m.judgeSettings.checkerMode = 'CUSTOM';
  m.programs = [program('CHECKER'), program('MAIN_SOLUTION'), program('INTERACTOR')];
  const { files, report } = await exportTestData(m, 'NOVAJUDGE', read, support);
  assert.equal(files.get('checker.cpp')!.toString(), m.programs[0].source);
  assert.equal(files.get('testlib.h'), support.testlib); assert.equal(files.get('testlib.LICENSE'), support.license);
  assert(!files.has('interactor.cpp'));
  const config = JSON.parse(files.get('problem.yml')!.toString());
  assert.equal(config.type, 'spj'); assert.equal(config.checker, 'checker.cpp'); assert.equal(config.cases.length, 2);
  assert(report.some(r => r.area === '时间与内存' && r.status === 'WARNING'));
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

test('interaction packages the active interactor and reports target protocol limitations', async () => {
  const { m, read } = fixture(); m.judgeSettings.interactionMode = 'INTERACTIVE';
  m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [program('INTERACTOR')]; m.tests[0].answer = null;
  for (const target of ['HYDRO', 'NOVAJUDGE'] as const) {
    const { files, report } = await exportTestData(m, target, read, support);
    assert.equal(files.get('interactor.cpp')!.toString(), m.programs[0].source);
    assert.equal(files.get('2.ans')!.length, 0); assert(!files.has('checker.cpp'));
    const config = JSON.parse(files.get(target === 'HYDRO' ? 'config.yaml' : 'problem.yml')!.toString());
    assert.equal(config.type, 'interactive'); assert(report.some(r => r.area === '交互答案'));
    if (target === 'NOVAJUDGE') assert(report.some(r => r.area === '交互协议'));
  }
  m.judgeSettings.interaction.verdictMode = 'CHECKER';
  const result = await exportTestData(m, 'HYDRO', read, support);
  assert(result.files.has('checker.cpp')); assert(result.report.some(r => r.area === '交互判定' && r.status === 'BLOCKED'));
});

test('unsupported scoring, file I/O and NovaJudge binary text conversions are explicit', async () => {
  const { m, blob, read } = fixture(); m.judgeSettings.scoringMode = 'PARTIAL'; m.judgeSettings.ioMode = 'FILES';
  m.tests[0].input = blob(Buffer.from([255]));
  const { report } = await exportTestData(m, 'NOVAJUDGE', read, support);
  assert.deepEqual(report.filter(r => r.status === 'BLOCKED').map(r => r.area), ['数据编码', '文件输入输出', '分组评分']);
});
