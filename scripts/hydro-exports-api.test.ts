import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as contracts from '@problemforge/contracts';
import * as format from '@problemforge/problem-format';

// Actual route handlers and Fastify schemas; only persistence, snapshots and access
// services are substituted. No database, Redis, sandbox or listening socket is used.
test('Hydro single/current/frozen contest routes produce downloadable library packages', async () => {
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const app = require('fastify')({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const memory = new Map<string, Buffer>(), rows: any[] = [], accessed: string[] = [], snapshots: string[] = [];
  const m = format.blankManifest('同名题'), input = Buffer.from('1\r\n'), answer = Buffer.from('2\r\n');
  const blob = (bytes: Buffer) => { const key = format.digest(bytes); memory.set(key, bytes); return { key, hash: key, bytes: bytes.length }; };
  m.tests = [{ id: 'test', revisionId: 'tr', version: 1, number: 1, groupName: 'main', isSample: false, enabled: true, notes: '', provenance: null, input: blob(input), answer: blob(answer) }];
  m.documents = [{ id: 'statement', revisionId: 'sr', version: 1, kind: 'STATEMENT', language: 'zh-CN', body: '当前题面。', enabled: true, metadata: { title: '', author: '' }, sampleRevisionIds: [], template: null }];
  const selection = { title: '比赛多题', language: 'zh-CN', items: [{ code: 'B', problemId: 'p1' }, { code: 'A', problemId: 'p2' }] };
  const frozen = { selection, problems: selection.items.map(i => ({ problemId: i.problemId, manifest: structuredClone(m), acceptanceRunId: null })) };
  frozen.problems.forEach(p => p.manifest.documents[0].body = '历史题面。');
  class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
  const access = async (user: any, id: string) => { if (user.id !== 'allowed') throw new HttpError(404, '没有权限'); accessed.push(id); };
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubs: Record<string, any> = {
    '@sinclair/typebox': require('@sinclair/typebox'), '@problemforge/contracts': contracts, '@problemforge/problem-format': format,
    '@problemforge/database': { db: { exportArtifact: { create: async ({ data }: any) => { const row = { ...data, id: randomUUID(), createdAt: new Date() }; rows.push(row); return row; }, findUnique: async ({ where }: any) => rows.find(r => r.id === where.id), findMany: async () => rows }, runCase: { findMany: async () => [] } } },
    '@problemforge/domain': { problemAccess: access, contestAccess: access, hashObject: () => 'snapshot-hash', sha256: format.digest, HttpError, audit: async () => {}, root },
    '@problemforge/template-engine': {}, '@problemforge/judge-core': { TESTLIB_HASH: format.digest(await readFile(new URL('../vendor/testlib/testlib.h', import.meta.url))) },
    '../app.ts': { authenticate: async (req: any) => { req.user = { id: req.headers['x-user'] || 'allowed' }; }, storage: { put: async (key: string, bytes: Buffer) => memory.set(key, bytes), get: async (key: string) => memory.get(key)! } },
    './revisions.ts': { revisionAccess: async (user: any) => { await access(user, 'p1'); return { id: 'pr', number: 1, problemId: 'p1', manifest: m, hash: 'snapshot-hash', acceptanceRunId: null }; } },
    './contests.ts': { contestRevision: async (user: any, id: string, revisionId: string) => { await access(user, id); snapshots.push(revisionId); return { revision: { id: revisionId }, snapshot: structuredClone(frozen) }; } },
    './contest-snapshot.ts': { currentContestRevision: async (user: any, id: string, version: number) => { await access(user, id); assert.equal(version, 7); snapshots.push('LATEST'); const snapshot = structuredClone(frozen); snapshot.problems.forEach(p => p.manifest.documents[0].body = m.documents[0].body); return { revision: { id: 'cr-current' }, snapshot }; } },
    './restore-manifest.ts': {}, './revision-snapshot.ts': { readProblemSnapshot: async () => ({ manifest: structuredClone(m), hash: 'snapshot-hash', acceptanceRunId: null }) },
  };
  const source = await readFile(new URL('../apps/api/src/modules/packages.ts', import.meta.url), 'utf8');
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', js)((name: string) => name.startsWith('node:') ? require(name) : stubs[name] ?? assert.fail(`Unexpected import: ${name}`), module, module.exports);
  app.setErrorHandler((error: any, _req: any, reply: any) => reply.code(error.statusCode || (error instanceof format.PackageError ? 422 : 500)).send({ message: error.message }));
  try {
    await module.exports.packageRoutes(app); await app.ready();
    const generate = async (url: string, payload: object, status = 200) => { const res = await app.inject({ method: 'POST', url, payload }); assert.equal(res.statusCode, status, res.body); return res.json(); };
    const download = async (row: any) => { const res = await app.inject({ url: `/api/exports/${row.id}/file` }); assert.equal(res.statusCode, 200); assert.equal(format.digest(res.rawPayload), row.hash); assert.equal(decodeURIComponent(res.headers['content-disposition'].split("filename*=UTF-8''")[1]), row.fileName); return format.readArchive(res.rawPayload, { unicodePaths: true }); };
    const single = await generate('/api/problems/p1/test-data-exports', { target: 'HYDRO', language: 'zh-CN' });
    assert.equal(single.format, 'HYDRO_PROBLEM'); const singleFiles = await download(single);
    assert.equal([...singleFiles.keys()].filter(p => p.endsWith('/problem.yaml')).length, 1);
    const current = await generate('/api/contests/c1/exports', { expectedVersion: 7, purpose: 'FULL', format: 'HYDRO' });
    assert.equal(current.format, 'HYDRO_CONTEST'); assert.equal(current.revisionId, 'cr-current');
    const currentFiles = await download(current);
    assert.equal([...currentFiles.keys()].filter(p => p.endsWith('/problem.yaml')).length, 2);
    assert([...currentFiles.keys()].filter(p => p.endsWith('/problem.md')).every(p => currentFiles.get(p)!.includes('当前题面')));
    assert(![...currentFiles.keys()].some(p => p.endsWith('.zip') || p === 'contest.json'));
    const historical = await generate('/api/contests/c1/exports', { revisionId: 'cr-old', purpose: 'FULL', format: 'HYDRO' });
    const historicalFiles = await download(historical);
    assert([...historicalFiles.keys()].filter(p => p.endsWith('/problem.md')).every(p => historicalFiles.get(p)!.includes('历史题面')));
    assert.deepEqual(snapshots, ['LATEST', 'cr-old']);
    await generate('/api/contests/c1/exports', { expectedVersion: 7, purpose: 'STATEMENT', format: 'HYDRO' }, 400);
    await generate('/api/problems/p1/exports', { revisionId: 'pr', purpose: 'FULL', format: 'HYDRO' }, 400);
    const denied = await app.inject({ url: `/api/exports/${current.id}/file`, headers: { 'x-user': 'revoked' } }); assert.equal(denied.statusCode, 404);
    const deniedExport = await app.inject({ method: 'POST', url: '/api/contests/c1/exports', payload: { revisionId: 'cr-old', purpose: 'FULL', format: 'HYDRO' }, headers: { 'x-user': 'revoked' } }); assert.equal(deniedExport.statusCode, 404);
    assert(accessed.includes('c1')); assert.equal(rows.length, 3);
    // The original native/Polygon contest branch still generates its existing bundle.
    const native = await generate('/api/contests/c1/exports', { revisionId: 'cr-old', purpose: 'STATEMENT', format: 'NATIVE' });
    const nativeFiles = await download(native); assert(nativeFiles.has('contest.json')); assert(nativeFiles.has('problems/B.zip'));
  } finally { await app.close(); }
});
