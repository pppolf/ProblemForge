import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, hashObject, sha256 } from '@problemforge/domain';
import { createApp, storage } from '../apps/api/src/app.ts';
import { introductionAssets } from '../apps/api/src/modules/contest-assets.ts';
import type { ContestDataValue } from '@problemforge/contracts';

// Explicit original-database integration check. All business writes are rolled
// back; storage is in memory and no listener, queue or author execution is used.
if (!process.argv.includes('--rollback')) throw new Error('Explicit --rollback is required');
const imageArgument = process.argv.find(arg => arg.startsWith('--image='))?.slice(8);
const image = imageArgument ? await readFile(imageArgument) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const database = new URL(process.env.DATABASE_URL!);
assert(['127.0.0.1', 'localhost'].includes(database.hostname) && !config.production, 'Only the configured local development database is allowed');
const app = await createApp(false), rollback = new Error('ROLLBACK_CONTEST_ASSETS');
const actorIds: string[] = [], checks: string[] = [], blobs = new Map<string, Buffer>();
let freezeVerified = false;
const originalPut = storage.put, originalGet = storage.get;
storage.put = async (key, bytes) => { blobs.set(key, Buffer.from(bytes)); };
storage.get = async key => { const value = blobs.get(key); assert(value); return Buffer.from(value); };
try {
  await app.ready();
  const original = (await db.contest.findMany({ where: { archived: false }, orderBy: { updatedAt: 'desc' } })).find(c => (c.data as unknown as ContestDataValue).items.length);
  assert(original, 'An existing contest with problems is required');
  const before = { contest: hashObject(original), assets: await db.contestAsset.count(), revisions: await db.contestRevision.count(), builds: await db.build.count() };
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${original.id} FOR UPDATE`;
    assert.deepEqual(await tx.contest.findUniqueOrThrow({ where: { id: original.id } }), original);
    const replaced: { target: any; method: string; original: any }[] = [];
    const replace = (target: any, method: string, replacement: any) => { replaced.push({ target, method, original: target[method] }); target[method] = replacement; };
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), target = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) replace(target, method, delegate[method].bind(delegate));
    }
    replace(db, '$transaction', (fn: any) => fn(tx)); replace(db, '$queryRaw', tx.$queryRaw.bind(tx));
    try {
      const actors = [];
      for (const role of ['OWNER', 'EDITOR', 'VIEWER', 'OUTSIDER'] as const) {
        const user = await tx.user.create({ data: { name: `Contest image ${role}`, email: `${randomUUID()}@example.test`, passwordHash: 'not-a-login-credential', role: 'USER' } });
        actorIds.push(user.id);
        const token = randomUUID(), csrf = randomUUID();
        await tx.session.create({ data: { id: sha256(token), userId: user.id, csrfToken: csrf, expiresAt: new Date(Date.now() + 120000) } });
        if (role !== 'OUTSIDER') await tx.contestMember.create({ data: { contestId: original.id, userId: user.id, role } });
        actors.push({ user, token, csrf });
      }
      const [owner, editor, viewer, outsider] = actors;
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown, expected = 200, actor = editor, csrf = true) => {
        const response = await app.inject({ method, url: `/api/contests/${path}`, headers: { origin: config.origin, cookie: `pf_session=${actor.token}`, ...(csrf ? { 'x-csrf-token': actor.csrf } : {}) }, ...(payload ? { payload } : {}) });
        assert.equal(response.statusCode, expected, `${method} ${path}: ${response.body.slice(0, 800)}`); return response;
      };
      const upload = { name: '比赛统计图.png', base64: image.toString('base64') }, path = `${original.id}/assets`;
      await call('POST', path, upload, 403, viewer);
      await call('POST', path, upload, 404, outsider);
      await call('POST', path, upload, 403, editor, false);
      await call('POST', path, { ...upload, base64: Buffer.from('<svg/>').toString('base64') }, 422);
      const asset = (await call('POST', path, upload)).json();
      assert.equal(asset.hash, sha256(image)); assert.equal(asset.bytes, image.length);
      assert.equal((await tx.contest.findUniqueOrThrow({ where: { id: original.id } })).version, original.version);
      assert((await call('GET', path, undefined, 200, viewer)).json().some((a: any) => a.id === asset.id));
      const filePath = `${path}/${asset.id}/file`;
      const download = await call('GET', filePath, undefined, 200, viewer);
      assert.deepEqual(download.rawPayload, image); assert.equal(download.headers['content-type'], asset.mediaType);
      await call('GET', filePath, undefined, 404, outsider);
      checks.push('Real sessions, CSRF and contest roles protect upload/list/download; bytes match and unused upload preserves arrangement version');
      const data = structuredClone(original.data) as unknown as ContestDataValue;
      data.beamerIntroduction = `\\begin{frame}{比赛总结}\n\\centering\n\\includegraphics[width=1\\linewidth,height=0.68\\textheight,keepaspectratio]{${asset.path}}\n\\end{frame}`;
      const saved = (await call('PUT', original.id, { expectedVersion: original.version, data })).json();
      const captured = await introductionAssets(tx, original.id, data.beamerIntroduction!);
      assert.equal(captured.length, 1); assert.equal(captured[0].path, asset.path);
      assert.equal(captured[0].blob.hash, sha256(image)); assert.equal(captured[0].blob.bytes, image.length);
      const freezeResponse = await app.inject({ method: 'POST', url: `/api/contests/${original.id}/freeze`, headers: { origin: config.origin, cookie: `pf_session=${owner.token}`, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: saved.version } });
      let frozenRow: Awaited<ReturnType<typeof tx.contestRevision.findUniqueOrThrow>> | undefined;
      if (freezeResponse.statusCode === 200) {
        frozenRow = await tx.contestRevision.findUniqueOrThrow({ where: { id: freezeResponse.json().id } });
        assert.deepEqual((frozenRow.data as any).introductionAssets, captured); freezeVerified = true;
      } else {
        assert.equal(freezeResponse.statusCode, 409, freezeResponse.body);
        assert.match(freezeResponse.json().message, /缺少匹配的成功验收/);
        checks.push('Existing source problems lack current acceptance: full database freeze is blocked as expected; no acceptance result was fabricated');
      }
      await call('POST', path, { ...upload, name: '未插入的图.png' });
      assert.deepEqual(await introductionAssets(tx, original.id, data.beamerIntroduction!), captured);
      if (frozenRow) assert.equal((await call('POST', `${original.id}/freeze`, { expectedVersion: saved.version }, 200, owner)).json().id, frozenRow.id);
      checks.push('Saved image frame passes real policy and captures key/hash/size from database; unused images do not change captured image references');
      const other = await tx.contest.create({ data: { title: 'Rollback image isolation', data: { ...data, items: [], beamerIntroduction: '' }, members: { create: { userId: editor.user.id, role: 'OWNER' } } } });
      await call('GET', `${other.id}/assets/${asset.id}/file`, undefined, 404);
      await call('PUT', other.id, { expectedVersion: other.version, data: { ...data, items: [] } }, 422);
      await call('PUT', original.id, { expectedVersion: saved.version, data: { ...data, beamerIntroduction: '\\includegraphics{assets/notuploaded.png}' } }, 422);
      await call('PUT', original.id, { expectedVersion: saved.version, data: { ...data, beamerIntroduction: '\\input{private}' } }, 422);
      await tx.contestMember.delete({ where: { contestId_userId: { contestId: original.id, userId: viewer.user.id } } });
      await call('GET', filePath, undefined, 404, viewer);
      await tx.contest.update({ where: { id: original.id }, data: { archived: true } });
      await call('POST', path, upload, 409);
      if (frozenRow) assert.deepEqual(await tx.contestRevision.findUniqueOrThrow({ where: { id: frozenRow.id } }), frozenRow);
      checks.push('Cross-contest references/downloads, undeclared images, file I/O, revoked access and archived writes are rejected');
      throw rollback;
    } finally { for (const item of replaced.reverse()) item.target[item.method] = item.original; }
  }, { timeout: 60000 }).catch(error => { if (error !== rollback) throw error; });
  const after = { contest: hashObject(await db.contest.findUniqueOrThrow({ where: { id: original.id } })), assets: await db.contestAsset.count(), revisions: await db.contestRevision.count(), builds: await db.build.count() };
  assert.deepEqual(after, before);
  for (const [delegate, where] of [[db.user, { id: { in: actorIds } }], [db.session, { userId: { in: actorIds } }], [db.auditLog, { actorId: { in: actorIds } }]] as const) assert.equal(await (delegate as any).count({ where }), 0);
  const result = { passed: true, database: database.pathname.slice(1), imageBytes: image.length, imageHash: sha256(image), checks, freezeVerified, rolledBack: true, persistentFixtureRows: 0, storage: 'in-memory substitute', queuedTasks: 0, newListeners: 0, before, after };
  await mkdir('.local/contest-intro-assets', { recursive: true });
  await writeFile('.local/contest-intro-assets/api-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { storage.put = originalPut; storage.get = originalGet; await app.close(); await db.$disconnect(); }
process.exit(0);
