import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as contracts from '@problemforge/contracts';
import * as format from '@problemforge/problem-format';
import * as templateEngine from '@problemforge/template-engine';

// Exercise the actual package routes, exporters and ZIP bytes without a database,
// listening socket or sandbox. Source snapshots and private storage are fixtures.
async function fixture() {
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const app = require('fastify')({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const memory = new Map<string, Buffer>(), rows: any[] = [], reads: string[] = [];
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=', 'base64');
  const blob = { key: 'contest-assets/private/old-image', hash: format.digest(bytes), bytes: bytes.length };
  const unused = { key: 'contest-assets/private/unused-image', hash: format.digest(bytes), bytes: bytes.length };
  memory.set(blob.key, bytes); memory.set(unused.key, bytes);
  const manifest = format.blankManifest('题目 A');
  manifest.documents = [
    { id: 'statement', revisionId: 'sr', version: 1, kind: 'STATEMENT', language: 'zh-CN', enabled: true, body: '公开题面。', metadata: { title: '', author: '' }, sampleRevisionIds: [], template: null },
    { id: 'beamer', revisionId: 'br', version: 1, kind: 'EDITORIAL_BEAMER', language: 'zh-CN', enabled: true, body: String.raw`\begin{frame}{题解}题目题解。\end{frame}`, metadata: { title: '', author: '' }, sampleRevisionIds: [], template: null },
  ];
  const frozen: any = {
    selection: { title: '比赛', language: 'zh-CN', beamerIntroduction: String.raw`\begin{frame}{私有开场总结}\includegraphics{assets/oldimage.png}\end{frame}`, items: [{ code: 'A', problemId: 'p1', revisionId: 'pr1' }] },
    introductionAssets: [{ path: 'assets/oldimage.png', blob }, { path: 'assets/unusedimage.png', blob: unused }],
    problems: [{ problemId: 'p1', manifest, acceptanceRunId: null }],
  };
  const current = structuredClone(frozen);
  current.selection.beamerIntroduction = String.raw`\begin{frame}{新开场总结}\includegraphics{assets/newimage.png}\end{frame}`;
  current.introductionAssets = [{ path: 'assets/newimage.png', blob: { ...blob, key: 'contest-assets/private/new-image' } }];
  memory.set(current.introductionAssets[0].blob.key, bytes);
  class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
  const stubs: Record<string, any> = {
    '@sinclair/typebox': require('@sinclair/typebox'), '@problemforge/contracts': contracts, '@problemforge/problem-format': format,
    '@problemforge/template-engine': templateEngine, '@problemforge/judge-core': {},
    '@problemforge/database': { db: { exportArtifact: {
      create: async ({ data }: any) => { const row = { ...data, id: `e${rows.length + 1}`, createdAt: new Date() }; rows.push(row); return row; },
      findUnique: async ({ where }: any) => rows.find(row => row.id === where.id),
    }, runCase: { findMany: async () => [] } } },
    '@problemforge/domain': { problemAccess: async () => {}, contestAccess: async () => {}, hashObject: () => 'snapshot-hash', sha256: format.digest, HttpError, audit: async () => {} },
    '../app.ts': { authenticate: async (req: any) => { req.user = { id: 'owner' }; }, storage: {
      get: async (key: string) => { reads.push(key); assert(memory.has(key), `Missing fixture blob: ${key}`); return memory.get(key)!; },
      put: async (key: string, value: Buffer) => { memory.set(key, value); },
    } },
    './contests.ts': { contestRevision: async () => ({ revision: { id: 'cr-old', number: 1, hash: 'old-hash' }, snapshot: structuredClone(frozen) }) },
    './contest-snapshot.ts': { currentContestRevision: async (_user: any, _id: string, version: number) => { assert.equal(version, 2); return { revision: { id: 'cr-current', number: 2, hash: 'current-hash' }, snapshot: structuredClone(current) }; } },
    './revisions.ts': {}, './restore-manifest.ts': {}, './revision-snapshot.ts': {},
  };
  const source = await readFile(new URL('../apps/api/src/modules/packages.ts', import.meta.url), 'utf8');
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', js)((name: string) => name.startsWith('node:') ? require(name) : stubs[name] ?? assert.fail(`Unexpected import: ${name}`), module, module.exports);
  app.setErrorHandler((error: any, _req: any, reply: any) => reply.code(error.statusCode ?? (error instanceof format.PackageError || error instanceof templateEngine.ContentPolicyError ? 422 : 500)).send({ message: error.message }));
  await module.exports.packageRoutes(app); await app.ready();
  const generate = async (purpose: string, target = 'NATIVE', status = 200, latest = false) => {
    const res = await app.inject({ method: 'POST', url: '/api/contests/c1/exports', payload: { purpose, format: target, ...(latest ? { expectedVersion: 2 } : { revisionId: 'cr-old' }) } });
    assert.equal(res.statusCode, status, res.body); return res.json();
  };
  const download = async (row: any) => {
    const res = await app.inject({ url: `/api/exports/${row.id}/file` }); assert.equal(res.statusCode, 200); assert.equal(format.digest(res.rawPayload), row.hash);
    const files = await format.readArchive(res.rawPayload), index = JSON.parse(files.get('contest.json')!.toString('utf8'));
    return { files, index };
  };
  return { app, memory, rows, reads, frozen, current, blob, bytes, generate, download };
}

test('native full and Beamer contest packages include referenced frozen images with portable public paths', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.frozen);
    for (const purpose of ['FULL', 'EDITORIAL_BEAMER']) {
      const { files, index } = await f.download(await f.generate(purpose));
      assert.equal(index.selection.beamerIntroduction, before.selection.beamerIntroduction);
      assert.deepEqual(index.introductionAssets, [{ path: 'assets/oldimage.png', hash: f.blob.hash, bytes: f.blob.bytes }]);
      assert.deepEqual(files.get('assets/oldimage.png'), f.bytes); assert(files.has('problems/A.zip'));
      assert(!files.has('assets/unusedimage.png')); assert(!JSON.stringify(index).includes('contest-assets/private'));
      assert.deepEqual(f.frozen, before);
    }
    const { files: currentFiles, index: currentIndex } = await f.download(await f.generate('FULL', 'NATIVE', 200, true));
    assert(currentFiles.has('assets/newimage.png')); assert(!currentFiles.has('assets/oldimage.png'));
    assert.equal(currentIndex.selection.beamerIntroduction, f.current.selection.beamerIntroduction);
    const { files: historicFiles } = await f.download(await f.generate('FULL'));
    assert.deepEqual(historicFiles.get('assets/oldimage.png'), f.bytes); assert(!historicFiles.has('assets/newimage.png'));
    assert(!f.reads.includes('contest-assets/private/unused-image'));
  } finally { await f.app.close(); }
});

test('other package purposes and Polygon omit private opening text and image bytes', async () => {
  const f = await fixture();
  try {
    for (const purpose of ['STATEMENT', 'EDITORIAL_DOCUMENT', 'DATA', 'REFERENCE']) for (const target of ['NATIVE', 'POLYGON']) {
      const { files, index } = await f.download(await f.generate(purpose, target));
      assert(!('beamerIntroduction' in index.selection)); assert(!('introductionAssets' in index));
      assert(![...files.keys()].some(path => path.startsWith('assets/')));
      assert(!JSON.stringify(index).includes('私有开场总结'));
    }
    for (const purpose of ['FULL', 'EDITORIAL_BEAMER']) {
      const row = await f.generate(purpose, 'POLYGON'), { files, index } = await f.download(row);
      assert(row.report.some((issue: any) => issue.area === '比赛开场总结' && issue.status === 'WARNING'));
      assert(!('beamerIntroduction' in index.selection)); assert(!('introductionAssets' in index));
      assert(![...files.keys()].some(path => path.startsWith('assets/')));
    }
    assert(!f.reads.some(key => key.startsWith('contest-assets/')));
  } finally { await f.app.close(); }
});

test('contest image exports reject corrupted bytes and missing allowlists before persisting an export', async () => {
  const f = await fixture();
  try {
    const corrupt = Buffer.from(f.bytes); corrupt[corrupt.length - 1] ^= 1;
    f.memory.set(f.blob.key, corrupt); await f.generate('FULL', 'NATIVE', 422);
    f.memory.set(f.blob.key, f.bytes.subarray(0, f.bytes.length - 1)); await f.generate('EDITORIAL_BEAMER', 'NATIVE', 422);
    f.memory.set(f.blob.key, f.bytes); f.frozen.introductionAssets = [];
    await f.generate('FULL', 'NATIVE', 422);
    assert.equal(f.rows.length, 0); assert(![...f.memory.keys()].some(key => key.startsWith('exports/')));
  } finally { await f.app.close(); }
});

test('native legacy introductions without images retain their original bundle shape', async () => {
  const f = await fixture();
  try {
    f.frozen.selection.beamerIntroduction = String.raw`\begin{frame}{比赛总结}文字总结。\end{frame}`;
    delete f.frozen.introductionAssets;
    const { files, index } = await f.download(await f.generate('FULL'));
    assert.equal(index.selection.beamerIntroduction, f.frozen.selection.beamerIntroduction);
    assert(!('introductionAssets' in index)); assert.deepEqual([...files.keys()].sort(), ['contest.json', 'problems/A.zip']);
  } finally { await f.app.close(); }
});
