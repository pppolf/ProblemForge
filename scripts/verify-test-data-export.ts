import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, sha256 } from '@problemforge/domain';
import { defaultJudgeSettings } from '@problemforge/contracts';
import { comparisonChecker, readArchive } from '@problemforge/problem-format';
import { compareOutput } from '../packages/judge-core/src/index.ts';
import { SandboxClient, type SandboxCommand } from '../packages/judge-adapter/src/index.ts';
import { createApp, storage } from '../apps/api/src/app.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';

if (!process.argv.includes('--rollback')) throw new Error('请显式指定 --rollback；所有数据库夹具均回滚');
const rollback = new Error('ROLLBACK_TEST_DATA_EXPORT'), userId = randomUUID(), outsiderId = randomUUID(), problemId = randomUUID();
const app = await createApp(false), memory = new Map<string, Buffer>(), savedPut = storage.put, savedGet = storage.get;
const evidence: object[] = [];
storage.put = async (key, bytes) => { memory.set(key, Buffer.from(bytes)); };
storage.get = async key => { assert(memory.has(key), `Missing blob ${key}`); return memory.get(key)!; };
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
      const token = randomUUID(), csrf = randomUUID(), outsideToken = randomUUID();
      for (const [id, session] of [[userId, token], [outsiderId, outsideToken]]) {
        await tx.user.create({ data: { id, name: 'Rollback data export', email: `${id}@example.test`, role: 'USER', passwordHash: 'not-a-login-credential' } });
        await tx.session.create({ data: { id: sha256(session), userId: id, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      }
      await tx.problem.create({ data: { id: problemId, title: 'Rollback data export', members: { create: { userId, role: 'OWNER' } } } });
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, expected = 200, session = token, sendCsrf = true) => {
        const response = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${session}`, ...(sendCsrf ? { 'x-csrf-token': csrf } : {}) }, ...(payload ? { payload } : {}) });
        assert.equal(response.statusCode, expected, `${path}: ${response.body.slice(0, 500)}`); return response;
      };
      const url = `/problems/${problemId}/test-data-exports`;
      await call('POST', url, { target: 'HYDRO' }, 422);
      await call('POST', url, { target: 'UNKNOWN' }, 400);
      await call('POST', url, { target: 'HYDRO' }, 403, token, false);
      await call('POST', url, { target: 'HYDRO' }, 404, outsideToken);
      const body = { number: 7, groupName: 'main', isSample: true, enabled: true, notes: 'private', inputBase64: Buffer.from('1 2\r\n').toString('base64'), answerBase64: Buffer.from('3\r\n').toString('base64') };
      const testcase = (await call('POST', `/problems/${problemId}/tests`, body)).json();
      const snapshot = await problemSnapshot(tx, problemId), before = structuredClone(snapshot.manifest);
      const artifactIds: string[] = [];
      for (const target of ['HYDRO', 'NOVAJUDGE']) {
        const artifact = (await call('POST', url, { target })).json(); artifactIds.push(artifact.id);
        assert.equal(artifact.format, target + '_DATA'); assert.equal(artifact.revisionId, `WORKING:${snapshot.hash}`);
        assert(!artifact.report.some((r: any) => r.status === 'BLOCKED'));
        const download = await call('GET', `/exports/${artifact.id}/file`);
        assert.match(String(download.headers['content-disposition']), /attachment/);
        assert.equal(sha256(download.rawPayload), artifact.hash);
        const files = await readArchive(download.rawPayload);
        assert.deepEqual(files.get('7.in'), Buffer.from('1 2\r\n')); assert.deepEqual(files.get('7.ans'), Buffer.from('3\r\n'));
        const configName = target === 'HYDRO' ? 'config.yaml' : 'problem.yml', checkerName = target === 'HYDRO' ? 'checker.cc' : 'checker.cpp';
        const config = JSON.parse(files.get(configName)!.toString());
        assert(files.has(checkerName)); assert(!files.has(target === 'HYDRO' ? 'checker.cpp' : 'checker.cc'));
        assert.deepEqual(config.checker, target === 'HYDRO' ? { file: checkerName, lang: 'cc' } : checkerName);
        await call('GET', `/exports/${artifact.id}/file`, undefined, 404, outsideToken);
        await call('POST', `/problems/${problemId}/releases`, { exportId: artifact.id }, 404);
      }
      assert.equal(await tx.problemRevision.count({ where: { problemId } }), 0);
      assert.equal(await tx.testRun.count({ where: { problemId } }), 0);
      assert.deepEqual((await problemSnapshot(tx, problemId)).manifest, before);
      const revision = await tx.problemRevision.create({ data: { problemId, number: 1, label: 'Draft export', ...snapshot, manifest: snapshot.manifest as unknown as Prisma.InputJsonValue, createdById: userId } });
      await call('PUT', `/tests/${testcase.id}`, { ...body, expectedVersion: 1, answerBase64: null });
      await call('POST', url, { target: 'HYDRO' }, 422);
      const fixed = (await call('POST', url, { target: 'HYDRO', revisionId: revision.id })).json();
      assert.equal(fixed.revisionId, revision.id);
      assert.deepEqual((await readArchive((await call('GET', `/exports/${fixed.id}/file`)).rawPayload)).get('7.ans'), Buffer.from('3\r\n'));
      assert.deepEqual((await readArchive((await call('GET', `/exports/${artifactIds[0]}/file`)).rawPayload)).get('7.ans'), Buffer.from('3\r\n'));
      const other = await tx.problem.create({ data: { title: 'Other rollback problem', members: { create: { userId, role: 'OWNER' } } } });
      await call('POST', `/problems/${other.id}/test-data-exports`, { target: 'HYDRO', revisionId: revision.id }, 404);
      await call('PUT', `/problems/${problemId}/judge-settings`, { expectedVersion: 1, settings: { ...defaultJudgeSettings, interactionMode: 'INTERACTIVE' } });
      const profile = await tx.compileProfile.findFirstOrThrow({ where: { language: 'CPP17', enabled: true } });
      await call('POST', `/problems/${problemId}/programs`, { name: 'Interactor export fixture', role: 'INTERACTOR', source: '// Export-only fixture; never executed.\n', profileId: profile.id, enabled: true, expectedVerdicts: ['AC'], notes: '' });
      await call('POST', `/problems/${problemId}/tests`, { ...body, number: 8, isSample: false });
      const interactive = await problemSnapshot(tx, problemId);
      const interactiveRevision = await tx.problemRevision.create({ data: { problemId, number: 2, label: 'Interactive export', ...interactive, manifest: interactive.manifest as unknown as Prisma.InputJsonValue, createdById: userId } });
      for (const target of ['HYDRO', 'NOVAJUDGE']) for (const revisionId of [undefined, interactiveRevision.id]) {
        const artifact = (await call('POST', url, { target, ...(revisionId ? { revisionId } : {}) })).json();
        const files = await readArchive((await call('GET', `/exports/${artifact.id}/file`)).rawPayload);
        const configName = target === 'HYDRO' ? 'config.yaml' : 'problem.yml', interactorName = target === 'HYDRO' ? 'interactor.cc' : 'interactor.cpp';
        assert.deepEqual([...files.keys()].sort(), ['8.in', interactorName, 'testlib.h', 'testlib.LICENSE', configName].sort());
        assert.deepEqual(files.get('8.in'), Buffer.from('1 2\r\n'));
        const config = JSON.parse(files.get(configName)!.toString());
        assert.equal(config.type, 'interactive'); assert.deepEqual(config.cases, [{ input: '8.in' }]);
        assert.deepEqual(config.interactor, target === 'HYDRO' ? { file: interactorName, lang: 'cc' } : interactorName);
        evidence.push({ target, source: revisionId ? 'fixed' : 'working', entries: [...files.keys()] });
      }
      assert.deepEqual((await problemSnapshot(tx, problemId)).manifest, interactive.manifest);
      assert.equal(await tx.testRun.count({ where: { problemId } }), 0);
      await tx.problemMember.deleteMany({ where: { problemId, userId } });
      await call('GET', `/exports/${artifactIds[0]}/file`, undefined, 404);
      await call('POST', url, { target: 'HYDRO' }, 404);
      evidence.push({ api: 'passed', platforms: ['Hydro', 'NovaJudge'], checks: ['working data without revisions or acceptance', 'draft revision export', 'byte hashes', 'immutable downloads after answer change', 'missing batch answer', 'interactive input-only exports even with saved answers', 'target-specific tool extensions and config references', 'schema/CSRF/cross-problem/outsider/revoked membership', 'no publication', 'no source data mutation or queued jobs'] });
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 45000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.problem.count({ where: { id: problemId } }), 0);
  assert.equal(await db.user.count({ where: { id: { in: [userId, outsiderId] } } }), 0);
  assert.equal(await db.exportArtifact.count({ where: { requestedById: userId } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: userId } }), 0);
} finally { storage.put = savedPut; storage.get = savedGet; await app.close(); await db.$disconnect(); }

if (process.argv.includes('--sandbox')) {
  const sandbox = new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken);
  await sandbox.health();
  const command = (args: string[], copyIn: SandboxCommand['copyIn']): SandboxCommand => ({ args, copyIn, env: ['PATH=/usr/bin:/bin', 'LANG=C.UTF-8'], files: [{ content: '' }, { name: 'stdout', max: 65536 }, { name: 'stderr', max: 65536 }], cpuLimit: 10000000000, clockLimit: 20000000000, memoryLimit: 512 * 1024 * 1024, stackLimit: 128 * 1024 * 1024, procLimit: 30, copyOutMax: 8_000_000 });
  const examples: [Buffer, Buffer][] = [
    ['a\r\n', 'a\n'], ['', ''], ['1 2', '1\t2\r\n'], ['1', '1 extra'], ['a\v\f b', 'a b'],
    ['1.000000', '1.0000005'], ['1', '1.01'], ['0', '0.0000009'], ['1e100', '1.0000001e100'],
    ['-0', '0'], ['.5', '5e-1'], ['1.', '1'], ['+01', '1'], ['1e-999', '0'], ['NaN', 'NaN'], ['+iNfInItY', '+iNfInItY'],
    ['1e999', '1e999'], ['nanosecond', 'nanosecond'], ['0x10', '16'], ['a\u00a0b', 'a b'], ['1e+', '1e+'], ['a\0b', 'a\0b'],
    ['9'.repeat(20000), '9'.repeat(20000)], ['word'.repeat(20000), 'word'.repeat(20000)],
  ].map(([a, b]) => [Buffer.from(a), Buffer.from(b)]);
  examples.push([Buffer.from([255, 32, 254]), Buffer.from([255, 9, 254])]);
  for (const checkerMode of ['EXACT', 'TOKENS', 'FLOAT'] as const) {
    const settings = { ...defaultJudgeSettings, checkerMode };
    const [compiled] = await sandbox.execute({ ...command(['/usr/bin/g++', '-std=c++11', '-O2', 'checker.cpp', '-o', 'checker'], { 'checker.cpp': { content: comparisonChecker(settings) } }), copyOutCached: ['checker'] });
    assert.equal(compiled.status, 'Accepted', JSON.stringify(compiled));
    const binary = compiled.fileIds!.checker;
    try {
      for (const [answer, output] of examples) {
        const uploaded = await Promise.all([sandbox.upload('answer', answer), sandbox.upload('output', output)]);
        try {
          const [result] = await sandbox.execute(command(['./checker', 'input', 'output', 'answer'], { checker: { fileId: binary }, input: { content: '' }, answer: { fileId: uploaded[0] }, output: { fileId: uploaded[1] } }));
          const expected = compareOutput(answer, output, settings).verdict;
          assert.equal(result.exitStatus, expected === 'AC' ? 0 : 1, `${checkerMode}: ${JSON.stringify(result)}`);
          assert.match(result.files?.stderr ?? '', expected === 'AC' ? /^ok / : /^wrong answer /);
        } finally { await Promise.all(uploaded.map(id => sandbox.delete(id))); }
      }
      evidence.push({ checkerMode, linuxSandbox: true, compiledAs: 'C++11', matchingComparisons: examples.length });
    } finally { await sandbox.delete(binary); }
  }
}
await mkdir('.local/data-export', { recursive: true });
await writeFile('.local/data-export/verification.json', JSON.stringify({ passed: true, rolledBack: true, evidence }, null, 2));
console.log(JSON.stringify({ passed: true, rolledBack: true, evidence }, null, 2));
process.exit(0);
