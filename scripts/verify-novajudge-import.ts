import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { blankManifest, digest, exportNovaJudgeProblem, exportNovaJudgeContest, readArchive, writeArchive } from '@problemforge/problem-format';
import { defaultInteractionSettings, type ManifestProgram } from '@problemforge/contracts';

// Read the supplied upstream sources and use its JSZip dependency. All persistence
// and authentication are replaced; no NovaJudge service, database or author code runs.
const novaRoot = process.argv.find(a => a.startsWith('--novajudge-root='))?.slice('--novajudge-root='.length);
if (!novaRoot) throw new Error('请指定 --novajudge-root=NovaJudge源码目录（只读，需已安装 jszip）');
const root = path.resolve(novaRoot), JSZip = createRequire(path.join(root, 'package.json'))('jszip');
const source = await readFile(path.join(root, 'app/api/problems/import/route.ts'), 'utf8');
const samplesSource = await readFile(path.join(root, 'lib/problem-samples.ts'), 'utf8');
const parseYaml = createRequire(new URL('../packages/problem-format/package.json', import.meta.url))('yaml').parse;
const compile = (text: string, imports: Record<string, unknown>) => {
  const js = transpileModule(text, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  const run = vm.runInNewContext(`(function(require,exports){${js}\n})`, { Response, process: { cwd: () => '/fixture' } });
  run((name: string) => { assert(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name]; }, exports);
  return exports as any;
};
const store = new Map<string, Buffer>();
const blob = (value: string | Buffer) => { const bytes = Buffer.from(value), key = digest(bytes); store.set(key, bytes); return { key, hash: key, bytes: bytes.length }; };
const read = async (key: string) => { assert(store.has(key)); return store.get(key)!; };
const support = { testlib: Buffer.from('fixture header'), license: Buffer.from('fixture license') };
const tool = (role: ManifestProgram['role']): ManifestProgram => ({ id: role, revisionId: role + 'r', version: 1, name: role, role, enabled: true, notes: '', expectedVerdicts: ['AC'],
  source: '// Fixed fixture, never executed.\r\n', sourceHash: digest('// Fixed fixture, never executed.\r\n'),
  profile: { id: 'cpp', name: 'C++17', language: 'CPP17', version: 1, hash: '0'.repeat(64), config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 } } });
const manifests = Array.from({ length: 12 }, (_, index) => {
  const m = blankManifest('同名题目'); m.meta.tags = ['fixture']; m.meta.notes = 'PRIVATE NOTES'; m.meta.responsibleId = 'PRIVATE OWNER';
  m.judgeSettings.timeLimitMs = 1000 + index; m.judgeSettings.memoryLimitMb = 256 + index;
  m.tests = [1, 2].map(number => ({ id: `t${number}`, revisionId: `tr${number}`, version: 1, number, groupName: 'main', isSample: number === 1, enabled: true, notes: '', provenance: null,
    input: blob(`${index} ${number}  \r\n`), answer: blob(`${index + number}\r\n\r\n`) }));
  m.samples = [structuredClone(m.tests[0])];
  m.documents = [{ id: 'statement', revisionId: 'sr', version: 1, kind: 'STATEMENT', language: 'zh-CN', enabled: true, metadata: { title: '', author: '' }, sampleRevisionIds: ['tr1'], template: null,
    body: String.raw`\Description 求和。\includegraphics{assets/pic.png}\InputFile 输入。\OutputFile 输出。\Note 解释。\includegraphics{assets/pic.png}` },
  { id: 'editorial', revisionId: 'er', version: 1, kind: 'EDITORIAL_DOCUMENT', language: 'zh-CN', enabled: true, metadata: { title: '', author: '' }, sampleRevisionIds: [], template: null, body: 'PRIVATE EDITORIAL' }];
  m.assets = [{ id: 'pic', name: 'pic.png', path: 'assets/pic.png', mediaType: 'image/png', blob: blob(`distinct-image-${index}`) },
    { id: 'unused', name: 'unused.png', path: 'assets/unused.png', mediaType: 'image/png', blob: blob('PRIVATE IMAGE') }];
  if (index % 3 === 1) { m.judgeSettings.checkerMode = 'CUSTOM'; m.programs = [tool('CHECKER')]; }
  if (index % 3 === 2) { m.judgeSettings.interactionMode = 'INTERACTIVE'; m.judgeSettings.interaction = { ...defaultInteractionSettings }; m.programs = [tool('INTERACTOR')]; }
  return m;
});
const before = structuredClone(manifests);
const imported: any[] = [], disk = new Map<string, Buffer>();
const handler = compile(source, {
  'next/server': { NextResponse: { json: (value: unknown, options: any = {}) => new Response(JSON.stringify(value), { status: options.status ?? 200 }) } },
  '@/lib/prisma': { prisma: { problem: {
    create: async ({ data }: any) => { const row = { ...data, id: 9001 + imported.length }; imported.push(row); return row; },
    update: async ({ where, data }: any) => { const row = imported.find(p => p.id === where.id); assert(row); Object.assign(row, data); return row; },
  } } },
  '@/lib/auth': { verifyAuth: async () => ({ isGlobalAdmin: true }) },
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture' }) }) },
  fs: { promises: { mkdir: async () => {}, writeFile: async (name: string, bytes: Buffer) => { assert(!disk.has(name), `Overwritten file: ${name}`); disk.set(name, Buffer.from(bytes)); } } },
  path: path.posix, jszip: JSZip, '@/lib/problem-samples': compile(samplesSource, {}),
});
const checks: object[] = [];
for (const comparison of ['NATIVE', 'PRESERVE'] as const) {
  for (const single of [true, false]) {
    const sourceManifests = single ? [manifests[0]] : manifests;
    const result = single ? await exportNovaJudgeProblem(manifests[0], read, support, { comparison })
      : await exportNovaJudgeContest('导入验证', manifests.map((manifest, i) => ({ code: String.fromCharCode(76 - i), manifest })), read, support, { comparison });
    const zip = await writeArchive(result.files, { unicodePaths: true, explicitDirectories: true }), files = await readArchive(zip, { unicodePaths: true });
    const roots = [...new Set([...files.keys()].map(name => name.split('/')[0]))];
    assert.equal(roots.length, sourceManifests.length); assert(![...files.keys()].some(name => name.endsWith('.zip')));
    imported.length = 0; disk.clear();
    const response = await handler.POST({ formData: async () => new Map([['file', { name: 'problems.zip', arrayBuffer: async () => zip }]]) });
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.success, true); assert.deepEqual(body.errors, []);
    assert.equal(imported.length, sourceManifests.length);
    for (const [index, folder] of roots.entries()) {
      const json = JSON.parse(files.get(`${folder}/problem.json`)!.toString()), row = imported[index], manifest = sourceManifests[index];
      assert.equal(json.id, index + 1); assert.equal(row.title, manifest.meta.title);
      assert.equal(row.type, manifest.judgeSettings.interactionMode === 'INTERACTIVE' ? 'interactive' : manifest.judgeSettings.checkerMode === 'CUSTOM' || comparison === 'PRESERVE' ? 'spj' : 'default');
      assert.equal(row.defaultTimeLimit, manifest.judgeSettings.timeLimitMs); assert.equal(row.defaultMemoryLimit, manifest.judgeSettings.memoryLimitMb);
      for (const key of ['samples', 'judgeConfig']) assert.deepEqual(JSON.parse(JSON.stringify(row[key])), json[key]);
      assert.deepEqual(parseYaml(files.get(`${folder}/data/problem.yml`)!.toString()), json.judgeConfig);
      assert.deepEqual(json.samples, [{ input: store.get(manifest.samples[0].input.key)!.toString(), output: store.get(manifest.samples[0].answer!.key)!.toString() }]);
      for (const key of ['sections', 'hint']) assert.equal(JSON.stringify(row[key]), JSON.stringify(json[key]).replaceAll(`/api/problems/${json.id}/`, `/api/problems/${row.id}/`));
      assert.match(JSON.stringify(row.sections), new RegExp(`/api/problems/${row.id}/assets/pic.png`));
      assert.match(row.hint, new RegExp(`/api/problems/${row.id}/assets/pic.png`));
      for (const [name, bytes] of files) if (name.startsWith(folder + '/') && !name.endsWith('/problem.json')) {
        const target = `/fixture/uploads/problems/${row.id}/${name.slice(folder.length + 1)}`;
        assert(disk.has(target), target); assert.deepEqual(disk.get(target), bytes);
      }
      assert.deepEqual(disk.get(`/fixture/uploads/problems/${row.id}/assets/pic.png`), store.get(manifest.assets[0].blob.key));
      for (const testcase of json.judgeConfig.cases) {
        const expected = manifest.tests.find(t => `${t.number}.in` === testcase.input)!; assert(expected);
        assert.deepEqual(files.get(`${folder}/data/${testcase.input}`), store.get(expected.input.key));
        if (row.type === 'interactive') assert.equal(testcase.output, '/dev/null');
        else assert.deepEqual(files.get(`${folder}/data/${testcase.output}`), store.get(expected.answer!.key));
      }
      if (row.type === 'interactive') assert(![...files.keys()].some(name => name.startsWith(folder + '/') && name.endsWith('.ans')));
      for (const key of ['checker', 'interactor']) if (row.judgeConfig[key]) assert(disk.has(`/fixture/uploads/problems/${row.id}/data/${row.judgeConfig[key]}`));
      assert(!JSON.stringify(row).includes('PRIVATE')); assert(!Object.hasOwn(json, 'tags')); assert(!Object.hasOwn(json, 'owner'));
    }
    assert([...files.values()].every(bytes => !bytes.includes('PRIVATE')));
    assert.equal(disk.size, files.size - roots.length);
    checks.push({ comparison, problems: imported.length, files: files.size, zipHash: digest(zip) });
  }
}
assert.deepEqual(manifests, before);
console.log(JSON.stringify({ passed: true, importHandlerHash: digest(source), samplesModuleHash: digest(samplesSource), checks,
  originalImportHandlerAndJSZip: true, persistenceAndAuthenticationMocked: true, listeners: 0, authorExecution: false }, null, 2));
