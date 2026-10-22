import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as contracts from '@problemforge/contracts';
import * as templateEngine from '@problemforge/template-engine';
import { blankManifest } from '@problemforge/problem-format';

// Execute the actual routes, schemas, snapshot logic and content policy. Persistence,
// access decisions, source snapshots and queue scheduling are isolated substitutes:
// this test does not open sockets, access a database or execute author TeX/code.
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
function canonical(value: any): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const hashObject = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=', 'base64');
const imageFrame = (path: string) => String.raw`\begin{frame}{比赛总结}
\centering
\includegraphics[width=1\linewidth,height=0.7\textheight,keepaspectratio]{${path}}
\end{frame}`;
class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) { super(message); }
}
const introduction = String.raw`\begin{frame}{比赛总结}
本场比赛考察基础算法与建模。
\end{frame}`;
const selection = (): contracts.ContestDataValue => ({
  title: '比赛题解验证', author: '管理员', stage: '', dateHeader: '', dateCover: '', language: 'zh-CN',
  templates: { STATEMENT: 'template-statement', EDITORIAL_DOCUMENT: null, EDITORIAL_BEAMER: 'template-beamer' },
  items: [{ problemId: 'p1', code: 'A', lectureOrder: 2 }, { problemId: 'p2', code: 'B', lectureOrder: 1 }],
});
async function loadModule(name: string, stubs: Record<string, any>) {
  const source = await readFile(new URL(`../apps/api/src/modules/${name}.ts`, import.meta.url), 'utf8');
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', js)((key: string) => key.startsWith('node:') ? require(key) : stubs[key] ?? assert.fail(`Unexpected import: ${key}`), module, module.exports);
  return module.exports;
}
async function fixture() {
  const app = require('fastify')({ bodyLimit: 2_500_000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const state = { contest: { id: 'c1', title: selection().title, version: 1, archived: false, data: selection() }, revisions: [] as any[], builds: [] as any[], assets: [] as any[], blobs: new Map<string, Buffer>(), scheduled: [] as string[], writes: 0 };
  const manifests = new Map(['p1', 'p2'].map((id, index) => {
    const manifest = blankManifest(`题目 ${index + 1}`); manifest.problemId = id; manifest.meta.tags = index ? [] : ['动态规划', '图论'];
    manifest.documents = ['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER'].map(kind => ({
      id: `${id}-${kind}`, revisionId: `${id}-${kind}-r1`, version: 1, language: 'zh-CN', kind: kind as contracts.DocumentKind,
      enabled: true, body: kind === 'EDITORIAL_BEAMER' ? String.raw`\begin{frame}{思路}讲解正文。\end{frame}` : '题目正文。',
      metadata: { title: manifest.meta.title, author: '出题人' }, sampleRevisionIds: [], template: null,
    }));
    return [id, manifest] as const;
  }));
  const templates = new Map(['STATEMENT', 'EDITORIAL_DOCUMENT', 'EDITORIAL_BEAMER'].map(kind => {
    const id = kind === 'STATEMENT' ? 'template-statement' : kind === 'EDITORIAL_DOCUMENT' ? 'template-document' : 'template-beamer';
    return [id, { id, number: 1, state: 'PUBLISHED', hash: `hash-${id}`, template: { kind }, files: { 'manifest.yaml': 'languages: [zh-CN]\n', 'booklet.tex': '{{CONTENTS}}' } }];
  }));
  const source = (id: string) => ({ manifest: structuredClone(manifests.get(id)), hash: hashObject(manifests.get(id)), judgeHash: 'fixture-judge-hash', acceptanceRunId: 'fixture-acceptance' });
  const access = async (user: any, _id: string, write = false) => {
    if (user.id === 'outsider') throw new HttpError(404, '没有访问权限');
    if (write && _id === state.contest.id && state.contest.archived) throw new HttpError(409, '比赛已归档');
    if (write && user.id === 'viewer') throw new HttpError(403, '没有编辑权限');
    return user.id === 'editor' ? 'EDITOR' : user.id === 'viewer' ? 'VIEWER' : 'OWNER';
  };
  const db: any = {
    $queryRaw: async () => [],
    problem: { findMany: async () => [...manifests.keys()].map(id => ({ id })), findUnique: async ({ where }: any) => manifests.has(where.id) ? { id: where.id } : null },
    templateVersion: { findUnique: async ({ where }: any) => structuredClone(templates.get(where.id) ?? null) },
    contest: {
      findUniqueOrThrow: async () => structuredClone(state.contest),
      create: async ({ data }: any) => { state.writes++; state.contest = { ...state.contest, title: data.title, data: structuredClone(data.data), version: 1 }; return structuredClone(state.contest); },
      updateMany: async ({ where, data }: any) => {
        if (where.version !== state.contest.version) return { count: 0 };
        state.writes++; state.contest = { ...state.contest, title: data.title, data: structuredClone(data.data), version: state.contest.version + 1 }; return { count: 1 };
      },
    },
    contestRevision: {
      findUnique: async ({ where }: any) => structuredClone(state.revisions.find(r => r.id === where.id) ?? null),
      findMany: async () => structuredClone(state.revisions),
      findFirst: async ({ where }: any) => structuredClone(state.revisions.filter(r => r.contestId === where.contestId && (!where.hash || r.hash === where.hash)).at(-1) ?? null),
      create: async ({ data }: any) => { const revision = { id: `cr${state.revisions.length + 1}`, ...structuredClone(data) }; state.revisions.push(revision); return structuredClone(revision); },
    },
    contestAsset: {
      findMany: async ({ where }: any) => structuredClone(state.assets.filter(a => a.contestId === where.contestId)),
      findFirst: async ({ where }: any) => structuredClone(state.assets.find(a => a.id === where.id && a.contestId === where.contestId) ?? null),
      aggregate: async ({ where }: any) => { const assets = state.assets.filter(a => a.contestId === where.contestId); return { _count: assets.length, _sum: { bytes: assets.reduce((n, a) => n + a.bytes, 0) } }; },
      create: async ({ data }: any) => { const row = { id: `ca${state.assets.length + 1}`, ...structuredClone(data) }; state.assets.push(row); return structuredClone(row); },
    },
    build: {
      findMany: async ({ where }: any) => structuredClone(state.builds.filter(b => b.bundleId === where.bundleId)),
      create: async ({ data }: any) => { const row = { id: `build${state.builds.length + 1}`, state: 'QUEUED', ...structuredClone(data) }; state.builds.push(row); return structuredClone(row); },
    },
    auditLog: { create: async () => ({}) },
  };
  db.$transaction = async (operation: any) => operation(db);
  const stubs: Record<string, any> = {
    '@sinclair/typebox': require('@sinclair/typebox'), '@problemforge/contracts': contracts,
    '@problemforge/database': { db }, '@problemforge/domain': { hashObject, sha256, HttpError, contestAccess: access, problemAccess: access, audit: async () => {}, taskQuota: async () => {} },
    '@problemforge/template-engine': templateEngine, '@problemforge/judge-adapter': { GO_JUDGE_VERSION: 'fixture' },
    '../app.ts': { authenticate: async (req: any) => { req.user = { id: req.headers['x-user'] ?? 'owner', role: 'USER' }; }, storage: {
      put: async (key: string, bytes: Buffer) => { state.blobs.set(key, Buffer.from(bytes)); },
      get: async (key: string) => { assert(state.blobs.has(key), 'Requested stored blob must exist'); return Buffer.from(state.blobs.get(key)!); },
    } },
    './members.ts': { owner: async (user: any, id: string) => { if (await access(user, id) !== 'OWNER') throw new HttpError(403, '只有负责人可以冻结'); } },
    './revision-snapshot.ts': { problemSnapshot: async (_tx: any, id: string) => source(id) },
    './builds.ts': { scheduleBuild: async (id: string) => { state.scheduled.push(id); } },
  };
  stubs['./asset-image.ts'] = await loadModule('asset-image', stubs);
  const assets = await loadModule('contest-assets', stubs); stubs['./contest-assets.ts'] = assets;
  const snapshots = await loadModule('contest-snapshot', stubs); stubs['./contest-snapshot.ts'] = snapshots;
  const contests = await loadModule('contests', stubs); stubs['./contests.ts'] = contests;
  const builds = await loadModule('contest-builds', stubs);
  app.setErrorHandler((error: any, _req: any, reply: any) => reply.code(error instanceof templateEngine.ContentPolicyError ? 422 : error.statusCode ?? 500).send({ message: error.message, details: error.issues, code: error.code }));
  await contests.contestRoutes(app); await builds.contestBuildRoutes(app); await assets.contestAssetRoutes(app); await app.ready();
  const call = async (method: string, url: string, payload?: any, status = 200, user = 'owner') => {
    const response = await app.inject({ method, url: `/api/contests${url}`, ...(payload === undefined ? {} : { payload }), headers: { 'x-user': user } });
    assert.equal(response.statusCode, status, response.body); return response.json();
  };
  const upload = (bytes = png, user = 'editor') => call('POST', '/c1/assets', { name: '总结图片.png', base64: bytes.toString('base64') }, 200, user);
  return { app, state, manifests, source, snapshots, db, call, upload };
}

test('contest Beamer save retains metadata, normalizes optional blanks and rejects invalid content through real schemas/routes', async () => {
  const f = await fixture();
  try {
    const data = { ...selection(), beamerIntroduction: introduction, items: selection().items.map((item, i) => ({ ...item, expectedDifficulty: i ? ' ' : '  中等  ' })) };
    const created = await f.call('POST', '', { expectedVersion: 0, data });
    assert.equal(created.data.beamerIntroduction, introduction); assert.equal(created.data.items[0].expectedDifficulty, '中等');
    assert(!('expectedDifficulty' in created.data.items[1]));
    const updated = await f.call('PUT', '/c1', { expectedVersion: 1, data: { ...data, beamerIntroduction: '  \n' } }, 200, 'editor');
    assert(!('beamerIntroduction' in updated.data)); assert.equal(updated.version, 2);
    const writes = f.state.writes;
    await f.call('PUT', '/c1', { expectedVersion: 1, data }, 409);
    await f.call('PUT', '/c1', { expectedVersion: 2, data }, 403, 'viewer');
    await f.call('PUT', '/c1', { expectedVersion: 2, data }, 404, 'outsider');
    for (const beamerIntroduction of [String.raw`\input{secret}`, String.raw`\includegraphics{assets/owned.png}`, String.raw`\documentclass{beamer}`]) {
      const rejected = await f.call('PUT', '/c1', { expectedVersion: 2, data: { ...data, beamerIntroduction } }, 422);
      assert(rejected.details.length); assert.equal(rejected.details[0].line, 1);
    }
    await f.call('POST', '', { expectedVersion: 0, data: { ...data, beamerIntroduction: 'a'.repeat(40001) } }, 400);
    await f.call('PUT', '/c1', { expectedVersion: 2, data: { ...data, items: [{ ...data.items[0], expectedDifficulty: 'a'.repeat(41) }] } }, 400);
    assert.equal(f.state.writes, writes, 'Rejected changes must not write contest data');
  } finally { await f.app.close(); }
});

test('historical contest compatibility keeps blank fields current without changing frozen JSON', async () => {
  const f = await fixture();
  try {
    const original = selection(); original.items[0].revisionId = 'old-revision';
    const frozen = { schemaVersion: 1, selection: original, templates: {}, problems: original.items.map(item => ({ problemId: item.problemId, ...f.source(item.problemId) })) };
    const revision = { data: frozen, hash: hashObject(frozen) }, before = structuredClone(frozen);
    const current = { ...selection(), beamerIntroduction: ' \n', items: selection().items.map(item => ({ ...item, expectedDifficulty: ' ' })) };
    const sources = new Map(current.items.map(item => [item.problemId, f.source(item.problemId)]));
    assert.equal(f.snapshots.contestRevisionCurrent(revision, current, sources), true);
    assert.equal(f.snapshots.contestRevisionCurrent(revision, { ...current, beamerIntroduction: introduction }, sources), false);
    const difficultyChanged = structuredClone(current); difficultyChanged.items[0].expectedDifficulty = '困难';
    assert.equal(f.snapshots.contestRevisionCurrent(revision, difficultyChanged, sources), false);
    assert.deepEqual(frozen, before); assert.equal(hashObject(frozen), revision.hash);
  } finally { await f.app.close(); }
});

test('freezing and Beamer builds capture manager introduction, lecture order, difficulty and original problem tags immutably', async () => {
  const f = await fixture();
  try {
    const data = { ...selection(), beamerIntroduction: introduction, items: selection().items.map((item, i) => ({ ...item, expectedDifficulty: i ? '入门' : '中等' })) };
    await f.call('PUT', '/c1', { expectedVersion: 1, data });
    const first = await f.call('POST', '/c1/freeze', { expectedVersion: 2 });
    const frozenBefore = structuredClone(f.state.revisions[0]);
    await f.call('POST', '/c1/builds', { revisionId: first.id, kinds: ['EDITORIAL_BEAMER'] });
    const builtBefore = structuredClone(f.state.builds[0].input);
    assert.equal(builtBefore.contest.beamerIntroduction, introduction);
    assert.deepEqual(builtBefore.contest.entries.map((entry: any) => [entry.code, entry.expectedDifficulty, entry.tags]), [['B', '入门', []], ['A', '中等', ['动态规划', '图论']]]);
    f.manifests.get('p1')!.meta.tags = ['新标签'];
    const changed = structuredClone(data); changed.beamerIntroduction = String.raw`\begin{frame}{新总结}修改后。\end{frame}`; changed.items[0].expectedDifficulty = '困难';
    await f.call('PUT', '/c1', { expectedVersion: 2, data: changed });
    await f.call('POST', '/c1/builds', { expectedVersion: 3, kinds: ['EDITORIAL_BEAMER'], subset: ['p1'] });
    const newBuild = f.state.builds.at(-1).input;
    assert.equal(newBuild.contest.beamerIntroduction, changed.beamerIntroduction);
    assert.deepEqual(newBuild.contest.entries.map((entry: any) => [entry.code, entry.expectedDifficulty, entry.tags]), [['A', '困难', ['新标签']]]);
    await f.call('POST', '/c1/builds', { revisionId: first.id, kinds: ['EDITORIAL_BEAMER'], requestKey: 'historical-build-again' });
    assert.deepEqual(f.state.builds.at(-1).input, builtBefore);
    assert.deepEqual(f.state.revisions[0], frozenBefore);
    await f.call('POST', '/c1/builds', { revisionId: first.id, kinds: ['STATEMENT'] });
    const statement = f.state.builds.at(-1).input.contest;
    assert(!('beamerIntroduction' in statement)); assert(statement.entries.every((entry: any) => !('tags' in entry) && !('expectedDifficulty' in entry)));
    assert.equal(f.state.scheduled.length, 4);
  } finally { await f.app.close(); }
});

test('snapshot and historical build boundaries independently reject unsafe introductions before writes or scheduling', async () => {
  const f = await fixture();
  try {
    const unsafe = String.raw`\begin{frame}{总结}\input{secret}\end{frame}`;
    f.state.contest.data.beamerIntroduction = unsafe;
    await assert.rejects(() => f.snapshots.freezeCurrentContest(f.db, 'c1', 'owner', 1), templateEngine.ContentPolicyError);
    assert.equal(f.state.revisions.length, 0);
    // A separately supplied old snapshot still passes hash checks, but must pass the
    // current content policy before new work is persisted or queued.
    f.state.contest.data = selection();
    const { revision } = await f.snapshots.freezeCurrentContest(f.db, 'c1', 'owner', 1);
    const row = f.state.revisions[0]; row.data.selection.beamerIntroduction = unsafe; row.hash = hashObject(row.data);
    const error = await f.call('POST', '/c1/builds', { revisionId: revision.id, kinds: ['EDITORIAL_BEAMER'] }, 422);
    assert(error.details.length); assert.equal(f.state.builds.length, 0); assert.equal(f.state.scheduled.length, 0);
  } finally { await f.app.close(); }
});

test('contest images preserve original bytes and preview only within the requested contest and its read permissions', async () => {
  const f = await fixture();
  try {
    const saved = await f.upload();
    assert.equal(saved.mediaType, 'image/png'); assert.equal(saved.hash, sha256(png)); assert.equal(saved.bytes, png.length);
    assert.equal(saved.path, `assets/${saved.id}.png`); assert(!('key' in saved));
    for (const user of ['owner', 'editor', 'viewer']) {
      const listed = await f.call('GET', '/c1/assets', undefined, 200, user);
      assert.deepEqual(listed, [saved]); assert(!('key' in listed[0]));
      const preview = await f.app.inject({ method: 'GET', url: `/api/contests/c1/assets/${saved.id}/file`, headers: { 'x-user': user } });
      assert.equal(preview.statusCode, 200); assert.match(preview.headers['content-type'], /^image\/png/); assert.deepEqual(preview.rawPayload, png);
    }
    await f.call('GET', '/c1/assets', undefined, 404, 'outsider');
    await f.call('GET', `/c1/assets/${saved.id}/file`, undefined, 404, 'outsider');
    await f.call('GET', `/c2/assets/${saved.id}/file`, undefined, 404);
    await f.call('GET', '/c1/assets/missing/file', undefined, 404);
    assert.deepEqual(await f.call('GET', '/c2/assets'), []);
    const row = f.state.assets[0];
    const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1;
    f.state.blobs.set(row.key, corrupt);
    await f.call('GET', `/c1/assets/${saved.id}/file`, undefined, 409);
    f.state.blobs.set(row.key, png.subarray(0, png.length - 1));
    await f.call('GET', `/c1/assets/${saved.id}/file`, undefined, 409);
  } finally { await f.app.close(); }
});

test('image uploads reject unreadable payloads, overlarge dimensions, excess quotas and unauthorized writes before storage', async () => {
  const f = await fixture();
  try {
    const payload = { name: '总结图片.png', base64: png.toString('base64') };
    await f.call('POST', '/c1/assets', payload, 403, 'viewer');
    await f.call('POST', '/c1/assets', payload, 404, 'outsider');
    f.state.contest.archived = true;
    await f.call('POST', '/c1/assets', payload, 409);
    f.state.contest.archived = false;
    await f.call('POST', '/c1/assets', { ...payload, base64: 'invalid?' }, 400);
    await f.call('POST', '/c1/assets', { ...payload, base64: 'AB==' }, 422);
    await f.call('POST', '/c1/assets', { ...payload, base64: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') }, 422);
    await f.call('POST', '/c1/assets', { ...payload, base64: Buffer.alloc(1_000_001).toString('base64') }, 422);
    for (const width of [0, 16_000_001]) {
      const invalid = Buffer.from(png); invalid.writeUInt32BE(width, 16);
      await f.call('POST', '/c1/assets', { ...payload, base64: invalid.toString('base64') }, 422);
    }
    assert.equal(f.state.assets.length, 0); assert.equal(f.state.blobs.size, 0);
    f.state.assets.push(...Array.from({ length: 100 }, (_, i) => ({ id: `old${i}`, contestId: 'c1', bytes: png.length })));
    await f.call('POST', '/c1/assets', payload, 422);
    assert.equal(f.state.assets.length, 100); assert.equal(f.state.blobs.size, 0);
    f.state.assets = [{ id: 'previous', contestId: 'c1', bytes: 20_000_000 - png.length + 1 }];
    await f.call('POST', '/c1/assets', payload, 422);
    assert.equal(f.state.assets.length, 1); assert.equal(f.state.blobs.size, 0);
    // The aggregate limit is inclusive and scoped to this contest.
    f.state.assets[0].bytes--;
    f.state.assets.push({ id: 'unrelated', contestId: 'c2', bytes: 20_000_000 });
    const saved = await f.upload(png, 'owner');
    assert.equal(saved.bytes, png.length); assert.equal(f.state.blobs.size, 1);
    assert.equal(f.state.contest.version, 1); assert.equal(f.state.writes, 0);
  } finally { await f.app.close(); }
});

test('JPEG media type follows bytes and image upload does not invalidate a current legacy freeze', async () => {
  const f = await fixture();
  try {
    const first = await f.call('POST', '/c1/freeze', { expectedVersion: 1 });
    const frozen = structuredClone(f.state.revisions[0]);
    const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
    const saved = await f.upload(jpeg);
    assert.equal(saved.mediaType, 'image/jpeg'); assert.equal(saved.path, `assets/${saved.id}.jpg`);
    assert.equal(f.state.contest.version, 1); assert.equal(f.state.writes, 0);
    const second = await f.call('POST', '/c1/freeze', { expectedVersion: 1 });
    assert.equal(first.id, second.id); assert.deepEqual(f.state.revisions[0], frozen);
    assert(!('introductionAssets' in frozen.data));
    const current = await f.call('GET', '/c1');
    assert.equal(current.revisions[0].current, true);
  } finally { await f.app.close(); }
});

test('save and freeze permit only owned uploaded image paths and reject missing, cross-contest and unsafe references', async () => {
  const f = await fixture();
  try {
    const owned = await f.upload();
    const other = await f.upload(); f.state.assets.find(a => a.id === other.id)!.contestId = 'c2';
    for (const body of [imageFrame('assets/missing.png'), imageFrame(other.path), imageFrame('../private.png'), imageFrame('https://example.com/image.png'), String.raw`\input{assets/secret.png}`]) {
      const data = { ...selection(), beamerIntroduction: body };
      await f.call('PUT', '/c1', { expectedVersion: 1, data }, 422);
      f.state.contest.data = data;
      await f.call('POST', '/c1/freeze', { expectedVersion: 1 }, 422);
      assert.equal(f.state.writes, 0); assert.equal(f.state.revisions.length, 0);
    }
    f.state.contest.data = selection();
    // A newly created contest cannot borrow an image from an existing contest.
    await f.call('POST', '', { expectedVersion: 0, data: { ...selection(), beamerIntroduction: imageFrame(owned.path) } }, 422);
    const saved = await f.call('PUT', '/c1', { expectedVersion: 1, data: { ...selection(), beamerIntroduction: imageFrame(owned.path) } });
    assert.equal(saved.version, 2);
    await f.call('POST', '/c1/freeze', { expectedVersion: 2 });
    assert.deepEqual(f.state.revisions[0].data.introductionAssets.map((a: any) => a.path), [owned.path]);
  } finally { await f.app.close(); }
});

test('frozen introductions capture only used immutable blobs and historical Beamer builds retain them after later edits', async () => {
  const f = await fixture();
  try {
    const first = await f.upload(), unused = await f.upload();
    const data = { ...selection(), templates: { ...selection().templates, EDITORIAL_DOCUMENT: 'template-document' }, beamerIntroduction: `${imageFrame(first.path)}\n${imageFrame(first.path)}\n% \\includegraphics{${unused.path}}` };
    await f.call('PUT', '/c1', { expectedVersion: 1, data });
    const revision = await f.call('POST', '/c1/freeze', { expectedVersion: 2 });
    const frozen = structuredClone(f.state.revisions[0]);
    const original = f.state.assets.find(a => a.id === first.id)!;
    const blob = { key: original.key, hash: original.hash, bytes: original.bytes };
    assert.deepEqual(frozen.data.introductionAssets, [{ path: first.path, blob }]);
    await f.call('POST', '/c1/builds', { revisionId: revision.id, kinds: ['EDITORIAL_BEAMER'] });
    const oldInput = structuredClone(f.state.builds.at(-1).input);
    assert.deepEqual(oldInput.assets, [{ path: `introduction/${first.path}`, ...blob }]);
    assert.deepEqual(oldInput.contest.beamerIntroductionAssetPaths, [first.path]);
    await f.call('POST', '/c1/builds', { revisionId: revision.id, kinds: ['STATEMENT', 'EDITORIAL_DOCUMENT'] });
    for (const build of f.state.builds.slice(-2)) {
      assert.deepEqual(build.input.assets, []);
      assert(!('beamerIntroduction' in build.input.contest)); assert(!('beamerIntroductionAssetPaths' in build.input.contest));
    }
    const later = await f.upload();
    await f.call('PUT', '/c1', { expectedVersion: 2, data: { ...data, beamerIntroduction: imageFrame(later.path) } });
    await f.call('POST', '/c1/builds', { expectedVersion: 3, kinds: ['EDITORIAL_BEAMER'] });
    assert.deepEqual(f.state.builds.at(-1).input.contest.beamerIntroductionAssetPaths, [later.path]);
    assert.notEqual(f.state.builds.at(-1).input.assets[0].key, blob.key);
    // Historic builds must use their frozen blob references without consulting the
    // mutable asset listing. The persisted snapshot itself remains untouched.
    f.state.assets = [];
    await f.call('POST', '/c1/builds', { revisionId: revision.id, kinds: ['EDITORIAL_BEAMER'], requestKey: 'old-images-again' });
    assert.deepEqual(f.state.builds.at(-1).input, oldInput); assert.deepEqual(f.state.revisions[0], frozen);
  } finally { await f.app.close(); }
});

test('historical image builds reject an incomplete frozen asset allowlist even when the image exists in the live contest', async () => {
  const f = await fixture();
  try {
    const asset = await f.upload();
    await f.call('PUT', '/c1', { expectedVersion: 1, data: { ...selection(), beamerIntroduction: imageFrame(asset.path) } });
    const revision = await f.call('POST', '/c1/freeze', { expectedVersion: 2 });
    const row = f.state.revisions[0];
    delete row.data.introductionAssets; row.hash = hashObject(row.data);
    await f.call('POST', '/c1/builds', { revisionId: revision.id, kinds: ['EDITORIAL_BEAMER'] }, 422);
    assert.equal(f.state.builds.length, 0); assert.equal(f.state.scheduled.length, 0);
  } finally { await f.app.close(); }
});
