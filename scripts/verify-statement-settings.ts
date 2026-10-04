import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { defaultJudgeSettings } from '@problemforge/contracts';
import { render, statementSettings, STATEMENT_RENDERER_VERSION, templateImage, type TemplateFiles } from '@problemforge/template-engine';
import { SandboxClient, type SandboxCommand } from '../packages/judge-adapter/src/index.ts';
import { createApp } from '../apps/api/src/app.ts';

// Explicit integration check: original DB, no listener, no real queue delivery,
// and all fixture writes roll back. Optional TeX runs only in the Linux sandbox.
if (!process.argv.includes('--rollback')) throw new Error('请指定 --rollback，数据库夹具必须回滚');
const { Queue } = createRequire(new URL('../packages/domain/package.json', import.meta.url))('bullmq');
const savedAdd = Queue.prototype.add, queued: string[] = [], checks: string[] = [];
Queue.prototype.add = async (_name: string, data: { buildId: string }) => { queued.push(data.buildId); return { id: data.buildId }; };
const app = await createApp(false), rollback = new Error('ROLLBACK_STATEMENT_SETTINGS');
const userId = randomUUID(), token = randomUUID(), csrf = randomUUID();
let problemId = '', compileInput: any;
try {
  await app.ready();
  await db.$transaction(async tx => {
    const saved: { object: any; method: string; original: any }[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), object = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        saved.push({ object, method, original: object[method] }); object[method] = delegate[method].bind(delegate);
      }
    }
    saved.push({ object: db, method: '$transaction', original: db.$transaction });
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      await tx.user.create({ data: { id: userId, name: 'Statement settings rollback', email: `${userId}@example.test`, role: 'USER', passwordHash: 'not-a-login-credential' } });
      await tx.session.create({ data: { id: sha256(token), userId, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, expected = 200) => {
        const response = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${token}`, 'x-csrf-token': csrf }, ...(payload ? { payload } : {}) });
        assert.equal(response.statusCode, expected, `${path}: ${response.body.slice(0, 1000)}`); return response.json();
      };
      problemId = (await call('POST', '/problems', { title: '题面限制回滚检查', language: 'zh-CN' })).id;
      const problem = await call('GET', `/problems/${problemId}`);
      const statement = problem.documents.find((d: any) => d.kind === 'STATEMENT');
      const editorial = problem.documents.find((d: any) => d.kind === 'EDITORIAL_DOCUMENT');
      const templateBefore = await tx.templateVersion.findUniqueOrThrow({ where: { id: statement.templateVersionId } });
      const documentBefore = await tx.document.findUniqueOrThrow({ where: { id: statement.id }, include: { currentRevision: true } });
      const build = async (documentId: string) => {
        const row = await call('POST', '/builds', { documentId });
        // Terminal metadata is only for currentness/publication checks; no claim
        // that this API fixture was compiled or contains a genuine PDF.
        await tx.build.update({ where: { id: row.id }, data: { state: 'SUCCEEDED', finishedAt: new Date() } });
        await tx.artifact.upsert({ where: { key: `rollback/${row.id}.pdf` }, create: { buildId: row.id, key: `rollback/${row.id}.pdf`, hash: 'rollback-metadata-only', bytes: 1, mediaType: 'application/pdf' }, update: {} });
        return row;
      };
      let settings = { ...defaultJudgeSettings }, version = 1;
      const save = async () => { const result = await call('PUT', `/problems/${problemId}/judge-settings`, { expectedVersion: version, settings }); version = result.version; };
      const first = await build(statement.id), editorialBuild = await build(editorial.id);
      assert.deepEqual(first.input.statementSettings, statementSettings());
      assert.equal(first.input.statementRendererVersion, STATEMENT_RENDERER_VERSION);
      assert.equal((await call('GET', `/builds/${first.id}`)).stale, false);
      settings.timeLimitMs = 2500; await save();
      assert.equal((await call('GET', `/builds/${first.id}`)).stale, true);
      assert.equal((await call('GET', `/builds?problemId=${problemId}`)).find((b: any) => b.id === first.id).stale, true);
      await call('POST', `/documents/${statement.id}/publish`, { buildId: first.id }, 409);
      const timeBuild = await build(statement.id);
      assert.notEqual(timeBuild.id, first.id); assert.notEqual(timeBuild.inputHash, first.inputHash);
      assert.equal(timeBuild.input.statementSettings.timeLimitMs, 2500);
      settings.memoryLimitMb = 512; await save();
      assert.equal((await call('GET', `/builds/${timeBuild.id}`)).stale, true);
      const memoryBuild = await build(statement.id);
      assert.notEqual(memoryBuild.inputHash, timeBuild.inputHash);
      assert.equal(memoryBuild.input.statementSettings.memoryLimitMb, 512);
      compileInput = memoryBuild.input;
      checks.push('saved time and memory independently change immutable build input/cache keys; old detail/list are stale and publication is rejected');
      settings.checkerMode = 'EXACT'; settings.outputLimitBytes = 2048; settings.inputFile = 'unused.txt'; await save();
      assert.equal((await call('GET', `/builds/${memoryBuild.id}`)).stale, false);
      assert.equal((await call('POST', '/builds', { documentId: statement.id })).id, memoryBuild.id);
      await call('POST', `/documents/${statement.id}/publish`, { buildId: memoryBuild.id });
      settings.ioMode = 'FILES'; settings.inputFile = 'data_in.txt'; settings.outputFile = 'data_out.txt'; await save();
      assert.equal((await call('GET', `/builds/${memoryBuild.id}`)).stale, true);
      const fileBuild = await build(statement.id);
      assert.equal(fileBuild.input.statementSettings.inputFile, 'data_in.txt');
      assert.equal(fileBuild.input.statementSettings.outputFile, 'data_out.txt');
      assert.equal((await call('GET', `/builds/${editorialBuild.id}`)).stale, false);
      assert.deepEqual((await tx.build.findUniqueOrThrow({ where: { id: first.id } })).input, first.input);
      assert.deepEqual(await tx.document.findUniqueOrThrow({ where: { id: statement.id }, include: { currentRevision: true } }), documentBefore);
      assert.deepEqual(await tx.templateVersion.findUniqueOrThrow({ where: { id: statement.templateVersionId } }), templateBefore);
      checks.push('file I/O is fixed in the snapshot; irrelevant judge settings and editorial currentness are unaffected; existing source, template and old build inputs are unchanged');
      const legacyInput = { ...first.input }; delete legacyInput.statementSettings; delete legacyInput.statementRendererVersion;
      const legacy = await tx.build.create({ data: { requestedById: userId, problemId, documentId: statement.id, revisionId: first.revisionId, templateVersionId: statement.templateVersionId, kind: 'STATEMENT', input: legacyInput, inputHash: hashObject(legacyInput), state: 'SUCCEEDED' } });
      assert.equal((await call('GET', `/builds/${legacy.id}`)).stale, true);
      const rendered = render(compileInput.files, 'STATEMENT', compileInput.body, compileInput.metadata, [], 'single', [], compileInput.statementSettings);
      assert.match(Object.values(rendered).join('\n'), /\{ 2\.5 s \}\{ 512 MB \}/);
      checks.push('existing published template renders non-default limits without changing its saved version; legacy snapshots require rebuilding');
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 45000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.problem.count({ where: { id: problemId } }), 0);
  assert.equal(await db.user.count({ where: { id: userId } }), 0);
  assert.equal(await db.build.count({ where: { requestedById: userId } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: userId } }), 0);
} finally { Queue.prototype.add = savedAdd; await app.close(); await db.$disconnect(); }

await mkdir('.local/statement-settings', { recursive: true });
if (process.argv.includes('--sandbox')) {
  const sandbox = new SandboxClient(config.sandboxUrl, config.sandboxToken), ids: string[] = [];
  try {
    const sources = render(compileInput.files, 'STATEMENT', compileInput.body, compileInput.metadata, [], 'single', [], compileInput.statementSettings);
    const copyIn: SandboxCommand['copyIn'] = Object.fromEntries(Object.entries(sources).map(([name, content]) => [name, { content }]));
    for (const [name, encoded] of Object.entries(compileInput.files as TemplateFiles)) if (/\.(png|jpe?g)$/.test(name)) {
      const fileId = await sandbox.upload(name.split('/').at(-1)!, templateImage(encoded, name)); ids.push(fileId); copyIn[name] = { fileId };
    }
    const [result] = await sandbox.execute({
      args: ['/usr/bin/latexmk', '-norc', '-xelatex', '-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', '-file-line-error', 'main.tex'],
      env: ['PATH=/usr/bin:/bin', 'HOME=/w', 'TMPDIR=/tmp', 'LANG=C.UTF-8', 'openin_any=p', 'openout_any=p', 'TEXMFOUTPUT=/w', 'TZ=UTC'],
      files: [{ content: '' }, { name: 'stdout', max: 262144 }, { name: 'stderr', max: 262144 }],
      cpuLimit: 30e9, clockLimit: 60e9, memoryLimit: 768 * 1024 * 1024, stackLimit: 64 * 1024 * 1024, procLimit: 32,
      copyIn, copyOut: ['main.log?'], copyOutCached: ['main.pdf?'], copyOutMax: 16 * 1024 * 1024,
    });
    ids.push(...Object.values(result.fileIds ?? {}));
    await writeFile('.local/statement-settings/sandbox-fixture.log', JSON.stringify(result, null, 2));
    assert.equal(result.status, 'Accepted'); assert.equal(result.exitStatus, 0); assert.ok(result.fileIds?.['main.pdf']);
    const pdf = await sandbox.download(result.fileIds['main.pdf']); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await writeFile('.local/statement-settings/sandbox-fixture.pdf', pdf);
    checks.push(`Linux TeX accepted saved 2500 ms / 512 MiB snapshot with existing published template; PDF ${pdf.length} bytes`);
  } finally { for (const id of ids) await sandbox.delete(id); }
}
await writeFile('.local/statement-settings/api-verification.json', JSON.stringify({ passed: true, checks, queuedOnlyInMemory: queued.length, allFixturesRolledBack: true }, null, 2));
console.log(JSON.stringify({ passed: true, checks, queuedOnlyInMemory: queued.length, allFixturesRolledBack: true }, null, 2));
process.exit(0);
