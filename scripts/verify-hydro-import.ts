import assert from 'node:assert/strict';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import { transpileModule, ScriptTarget } from 'typescript';
import { blankManifest, digest, exportHydroProblem, exportHydroContest, writeArchive, readArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestProgram } from '@problemforge/contracts';

// Run the supplied Hydro importer against temporary package files. Only its persistence
// boundary is replaced; no Hydro service, author program, database or listener is used.
const hydroRoot = process.argv.find(a => a.startsWith('--hydro-root='))?.slice('--hydro-root='.length);
if (!hydroRoot) throw new Error('请指定 --hydro-root=Hydro源码目录（只读）');
const sourcePath = path.join(hydroRoot, 'packages/hydrooj/src/model/problem.ts');
const source = await fs.readFile(sourcePath, 'utf8');
const findContent = source.slice(source.indexOf('function findOverrideContent('), source.indexOf('\ninterface ProblemImportOptions'));
const importMethod = source.slice(source.indexOf('    static async import('), source.indexOf('    static async export('));
assert(findContent.includes('function findOverrideContent') && importMethod.includes('testdata/config.yaml'));
const { parse: load } = createRequire(new URL('../packages/problem-format/package.json', import.meta.url))('yaml');
const javascript = transpileModule(`${findContent}\nclass Importer {\n${importMethod}\n}\nreturn Importer;`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const records: any[] = [], messages: string[] = [];
const model = {
  get: async () => null,
  add: async (_domain: string, pid: unknown, title: string, content: string, owner: unknown, tags: string[]) => {
    records.push({ pid, title, content, owner, tags, tests: new Map(), files: new Map(), solutions: [] }); return records.length;
  },
  addTestdata: async (_d: string, id: number, name: string, file: string) => records[id - 1].tests.set(name, await fs.readFile(file)),
  addAdditionalFile: async (_d: string, id: number, name: string, file: string) => records[id - 1].files.set(name, await fs.readFile(file)),
};
const Importer = new Function('fs', 'path', 'os', 'yaml', 'DomainModel', 'SystemModel', 'ProblemModel', 'SolutionModel', 'logger', javascript)(
  { ...fsSync, ...fs, exists: async (file: string) => fsSync.existsSync(file), remove: (file: string) => fs.rm(file, { recursive: true, force: true }) },
  path, os, { load }, { get: async () => ({}) }, { get: () => Number.MAX_SAFE_INTEGER }, model,
  { add: async (_d: string, id: number, owner: number, content: string) => records[id - 1].solutions.push({ owner, content }) }, { warn: () => {}, info: () => {} },
);
const bytes = new Map<string, Buffer>();
const blob = (value: string | Buffer) => { const content = Buffer.from(value), key = digest(content); bytes.set(key, content); return { key, hash: key, bytes: content.length }; };
const read = async (key: string) => { assert(bytes.has(key)); return bytes.get(key)!; };
const support = { testlib: Buffer.from('fixture testlib'), license: Buffer.from('fixture license') };
const manifest = blankManifest('Hydro 兼容题');
manifest.meta.tags = ['中文标签', 'math'];
manifest.meta.notes = 'PRIVATE NOTES';
manifest.documents = [
  { id: 'statement', revisionId: 'sr', version: 1, kind: 'STATEMENT', enabled: true, language: 'zh-CN', body: String.raw`\Description 求和。\includegraphics{assets/pic.png}\InputFile 两个数。\OutputFile 和。`, metadata: { title: '', author: '' }, sampleRevisionIds: ['tr'], template: null },
  { id: 'editorial', revisionId: 'er', version: 1, kind: 'EDITORIAL_DOCUMENT', enabled: true, language: 'zh-CN', body: String.raw`\section{算法}相加。\includegraphics{assets/pic.png}`, metadata: { title: '', author: '' }, sampleRevisionIds: [], template: null },
];
manifest.tests = [{ id: 'test', revisionId: 'tr', version: 1, number: 1, groupName: 'main', isSample: false, enabled: true, notes: '', provenance: null, input: blob(Buffer.from([0, 255, 13, 10])), answer: blob('3\r\n') }];
manifest.samples = [{ ...manifest.tests[0], input: blob('1 2\r\n'), isSample: true }];
manifest.assets = [{ id: 'pic', path: 'assets/pic.png', name: 'pic.png', mediaType: 'image/png', blob: blob(Buffer.from([137, 80, 78, 71])) }];
const custom = structuredClone(manifest), interactive = structuredClone(manifest);
const tool = (role: ManifestProgram['role']): ManifestProgram => ({ id: role, revisionId: `${role}r`, version: 1, name: role, role, enabled: true, source: '// pinned source\r\n', sourceHash: digest('// pinned source\r\n'), notes: '', expectedVerdicts: ['AC'], profile: { id: 'cpp', name: 'C++17', language: 'CPP17', version: 1, hash: '0'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 } } });
custom.judgeSettings.checkerMode = 'CUSTOM'; custom.programs = [tool('CHECKER')];
interactive.judgeSettings.interactionMode = 'INTERACTIVE'; interactive.judgeSettings.interaction = { ...defaultInteractionSettings }; interactive.programs = [tool('INTERACTOR')];
const before = structuredClone([manifest, custom, interactive]);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'problemforge-hydro-import-'));
try {
  const single = await exportHydroProblem(manifest, read, support);
  const multiple = await exportHydroContest('兼容比赛', [{ code: 'A', manifest }, { code: 'B', manifest: custom }, { code: 'C', manifest: interactive }], read, support, { language: 'zh-CN' });
  for (const [label, result, expected] of [['single', single, 1], ['multiple', multiple, 3]] as const) {
    const files = await readArchive(await writeArchive(result.files, { unicodePaths: true }), { unicodePaths: true });
    const directory = path.join(temp, label); await fs.mkdir(directory);
    for (const [name, content] of files) { const target = path.join(directory, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
    records.length = 0; messages.length = 0;
    await Importer.import('fixture-domain', directory, { operator: 42, delSource: false, progress: (message: string) => messages.push(message) });
    assert.equal(records.length, expected); assert.equal(messages.length, expected); assert(messages.every(m => m.startsWith('Imported problem ')), messages.join('\n'));
    for (const record of records) {
      assert.equal(record.title, manifest.meta.title); assert.deepEqual(record.tags, manifest.meta.tags); assert.equal(record.owner, 42); assert.equal(record.pid, undefined);
      assert.match(record.content, /```input1\n1 2\r\n```/); assert(!record.content.includes('PRIVATE NOTES'));
      const asset = [...record.content.matchAll(/file:\/\/([a-z0-9.-]+)/g)][0][1];
      assert.deepEqual(record.files.get(asset), await read(manifest.assets[0].blob.key));
      assert.equal(record.solutions.length, 1); assert(record.solutions[0].content.includes(`file://${asset}`));
      assert.deepEqual(record.tests.get('1.in'), await read(manifest.tests[0].input.key));
      const config = load(record.tests.get('config.yaml').toString());
      assert.equal(config.time, '1000ms'); assert.equal(config.memory, '256m');
      if (config.type === 'interactive') {
        assert(!record.tests.has('1.ans')); assert(record.tests.has(config.interactor.file));
        assert.equal(config.subtasks[0].cases[0].output, '/dev/null');
      } else {
        assert.deepEqual(record.tests.get('1.ans'), Buffer.from('3\r\n')); assert(record.tests.has(config.checker.file));
      }
    }
    console.log(`${label}: ${expected} problem(s) imported through original Hydro method; title/tags/statement/images/editorial/data/config verified`);
  }
  assert.deepEqual([manifest, custom, interactive], before);
  console.log(`Hydro importer SHA-256: ${digest(source)}; persistence mocked; no service or database accessed`);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
