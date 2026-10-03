import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { MAX_TEST_BYTES } from '@problemforge/contracts';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { createApp, storage } from '../apps/api/src/app.ts';
import { judgeSnapshot, dependencyHash } from '../apps/api/src/modules/judge-snapshot.ts';
import { makeTestZip } from '../fixtures/judge/zip.ts';

// Real API/schema/DB validation with uncommitted fixture rows and an in-memory
// storage substitute. No listener, queue submission, author execution or files.
if (!process.argv.includes('--rollback')) throw new Error('请显式指定 --rollback；所有夹具写入均回滚');
const rollback = new Error('ROLLBACK_LARGE_DATA'), problemId = randomUUID(), userId = randomUUID();
const app = await createApp(false), blobs = new Map<string, Buffer>(), savedPut = storage.put;
storage.put = async (key, bytes) => { blobs.set(key, Buffer.from(bytes)); };
try {
  await app.ready();
  await db.$transaction(async tx => {
    const saved: { object: any; method: string; original: any }[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), target = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        saved.push({ object: target, method, original: target[method] }); target[method] = delegate[method].bind(delegate);
      }
    }
    saved.push({ object: db, method: '$transaction', original: db.$transaction });
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      await tx.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Rollback large-data fixture', role: 'ADMIN', passwordHash: 'not-a-login-credential' } });
      await tx.problem.create({ data: { id: problemId, title: 'Rollback large-data fixture' } });
      const token = randomUUID(), csrf = randomUUID();
      await tx.session.create({ data: { id: sha256(token), userId, csrfToken: csrf, expiresAt: new Date(Date.now() + 60000) } });
      const call = async (method: 'POST' | 'PUT', path: string, payload: object, expected = 200) => {
        const response = await app.inject({ method, url: `/api${path}`, headers: { origin: config.origin, cookie: `pf_session=${token}`, 'x-csrf-token': csrf }, payload });
        assert.equal(response.statusCode, expected, `${method} ${path}: ${response.body.slice(0, 500)}`); return response.json();
      };
      const large = Buffer.alloc(MAX_TEST_BYTES, 65), base64 = large.toString('base64');
      const body = { number: 1, groupName: 'main', isSample: false, enabled: true, notes: '', inputBase64: base64, answerBase64: base64 };
      const created = await call('POST', `/problems/${problemId}/tests`, body);
      const updated = await call('PUT', `/tests/${created.id}`, { ...body, expectedVersion: 1 });
      assert.equal(updated.version, 2);
      assert.equal(updated.currentRevision.inputBytes, MAX_TEST_BYTES);
      assert.equal(updated.currentRevision.answerBytes, MAX_TEST_BYTES);
      assert.equal(updated.currentRevision.inputHash, sha256(large));
      assert([...blobs.values()].some(bytes => bytes.equals(large)));
      const oversized = Buffer.alloc(MAX_TEST_BYTES + 1).toString('base64');
      await call('POST', `/problems/${problemId}/tests`, { ...body, number: 9, inputBase64: oversized }, 422);
      assert.equal(await tx.testCase.count({ where: { problemId } }), 1);
      const self = { name: 'large checker fixture', kind: 'CHECKER', programId: null, enabled: true, expected: 'AC', inputBase64: base64, answerBase64: base64, outputBase64: base64 };
      const selfTest = await call('POST', `/problems/${problemId}/self-tests`, self);
      assert.equal((await call('PUT', `/self-tests/${selfTest.id}`, { ...self, expectedVersion: 1 })).version, 2);
      const sample = large.subarray(0, 2_200_000);
      await call('POST', `/problems/${problemId}/tests/import-zip`, { base64: makeTestZip([{ name: '2.in', bytes: sample }]).toString('base64'), groupName: 'main' });
      assert.equal((await tx.testCase.findFirstOrThrow({ where: { problemId, number: 2 }, include: { currentRevision: true } })).currentRevision!.inputHash, sha256(sample));
      // Only metadata is simulated here: exercise collection of a large
      // generated case without claiming that this fixture ran in a sandbox.
      const input = await judgeSnapshot(tx, problemId, 'GENERATE');
      const run = await tx.testRun.create({ data: { problemId, requestedById: userId, requestKey: randomUUID(), purpose: 'GENERATE', state: 'SUCCEEDED', input: input as unknown as Prisma.InputJsonValue, inputHash: hashObject(input), dependencyHash: dependencyHash(input) } });
      const revision = await tx.testCaseRevision.findUniqueOrThrow({ where: { id: updated.currentRevision.id } });
      const c = await tx.runCase.create({ data: { runId: run.id, ref: 'fixture:generated', number: 3, groupName: 'main', isSample: false, inputKey: revision.inputKey, inputBytes: MAX_TEST_BYTES, inputHash: revision.inputHash, origin: { type: 'GENERATOR' } } });
      const collected = await call('POST', `/test-runs/${run.id}/apply-data`, { caseIds: [c.id] });
      assert.equal((await tx.testCase.findUniqueOrThrow({ where: { id: collected.testIds[0] }, include: { currentRevision: true } })).currentRevision!.inputBytes, MAX_TEST_BYTES);
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 45000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.problem.count({ where: { id: problemId } }), 0);
  assert.equal(await db.user.count({ where: { id: userId } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: userId } }), 0);
  const result = { passed: true, rolledBack: true, maxBytes: MAX_TEST_BYTES, verified: ['8 MB input + answer create/update through API', '8 MB + 1 byte rejects without creating data', 'three 8 MB self-test files create/update', '2.2 MB ZIP input preserves hash', '8 MB generated input collection'], storage: 'in-memory only', queuedJobs: 0 };
  await mkdir('.local/large-test-data', { recursive: true });
  await writeFile('.local/large-test-data/api-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { storage.put = savedPut; await app.close(); await db.$disconnect(); }
process.exit(0);
