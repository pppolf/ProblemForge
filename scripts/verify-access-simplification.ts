import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, HttpError, sha256 } from '@problemforge/domain';
import { associationLogin, parseAssociationResponse } from '../apps/api/src/modules/association-login.ts';
import { createApp } from '../apps/api/src/app.ts';
import { builtinProfiles } from '../apps/api/src/modules/judge-snapshot.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';
import { appendTest } from '../apps/api/src/modules/judge-data.ts';

// No listener, new database, outbound request, file blob or queue job. All fixture
// users, revisions, terminal acceptance metadata and audits are rolled back.
if (!process.argv.includes('--rollback')) throw new Error('请显式指定 --rollback；仅使用原库的必定回滚事务');
const oldKey = config.associationAppKey, realFetch = globalThis.fetch;
const suffix = randomUUID(), fixtureProblemId = `verify-${suffix}`, emails: string[] = [];
const evidence: string[] = [], rollback = new Error('ROLLBACK_VERIFICATION');
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.statusCode === code;
let response: () => Response | Promise<Response>, calls = 0;
let submitted: any;
const envelope = (data: any) => JSON.stringify({ code: 200, msg: 'success', data });
const identity = (userId: string, name: string) => ({ userId, userAccount: name, userName: name, email: `${name}-${suffix}@example.test` });
const identityBase = BigInt(Date.now()) * 10000n + BigInt(randomInt(1000));
const fixtureIdentity = (offset: number) => String(identityBase + BigInt(offset));
const remote = identity(fixtureIdentity(1), 'author'); emails.push(remote.email);
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://www.cwnupaa.com/api/user/external/login');
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
  assert.ok(init?.signal instanceof AbortSignal);
  submitted = JSON.parse(String(init?.body)); calls++; return response();
};
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  config.associationAppKey = '';
  await assert.rejects(associationLogin('author', 'verification only'), status(503)); assert.equal(calls, 0);
  config.associationAppKey = 'verification-key-never-sent';
  response = () => new Response(envelope(remote).replace(`"${remote.userId}"`, remote.userId));
  assert.equal((await associationLogin('  author  ', '  password unchanged  ')).userId, remote.userId);
  assert.equal(parseAssociationResponse(envelope({...remote, userId: '9223372036854775807'}).replace('"9223372036854775807"', '9223372036854775807')).userId, '9223372036854775807');
  assert.deepEqual(submitted, { appKey: config.associationAppKey, loginType: 'password', account: 'author', credential: '  password unchanged  ' });
  for (const data of [{ ...remote, userId: '9223372036854775808' }, { ...remote, userId: '1.2' }, { ...remote, userId: '0' }, { ...remote, email: '' }, null]) assert.throws(() => parseAssociationResponse(envelope(data)), status(502));
  assert.throws(() => parseAssociationResponse('not JSON'), status(502));
  assert.throws(() => parseAssociationResponse('{"code":500,"msg":"AppKey invalid"}'), status(503));
  assert.throws(() => parseAssociationResponse('{"code":500,"msg":"学号登录已禁用"}'), status(401));
  assert.throws(() => parseAssociationResponse('{"code":500,"msg":"verification-key-never-sent"}'), (e: any) => e.statusCode === 401 && !e.message.includes('verification-key'));
  for (const makeResponse of [() => new Response('down', { status: 503 }), () => { throw new DOMException('timeout', 'TimeoutError'); }, () => { throw new TypeError('connection refused'); }]) {
    response = makeResponse; await assert.rejects(associationLogin('author', 'verification only'), status(503));
  }
  response = () => new Response('x'.repeat(32769)); await assert.rejects(associationLogin('author', 'verification only'), status(502));
  evidence.push('exact password request contract, missing key, exact Java Long identity, bounded response, invalid key/credentials, malformed/timeout/unavailable failures');

  app = await createApp(false); await app.ready();
  const application = app;
  let addressCounter = 0;
  const ipPrefix = `127.${randomInt(1, 250)}.${randomInt(1, 250)}`;
  const call = async (path: string, body?: object, auth?: {cookie: string; csrf: string}, expected = 200, method = body ? 'POST' : 'GET', headers: Record<string, string> = {}) => {
    const res = await application.inject({ method: method as any, url: `/api${path}`, remoteAddress: `${ipPrefix}.${++addressCounter}`, headers: { origin: config.origin, ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}), ...headers }, ...(body ? { payload: body } : {}) });
    assert.equal(res.statusCode, expected, `${method} ${path}: ${res.body}`); return res;
  };
  await db.$transaction(async tx => {
    // Route handlers read exactly this transaction, so no fixture is ever visible
    // to the running developer API/Workers. Restore all delegates in finally.
    const saved: {object: any; method: string; original: any}[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), target = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        const bound = delegate[method].bind(delegate); saved.push({object: target, method, original: target[method]}); target[method] = bound;
      }
    }
    saved.push({object: db, method: '$transaction', original: db.$transaction});
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      const login = async (info: typeof remote, account = info.userAccount, expected = 200) => {
        response = () => new Response(envelope(info));
        const res = await call('/auth/login', { account, password: 'verification password' }, undefined, expected);
        return { cookie: String(res.headers['set-cookie'] ?? '').split(';')[0], csrf: res.json().csrfToken, user: res.json().user, res };
      };
      config.associationAppKey = '';
      const configReply = await call('/auth/config'); assert.deepEqual(configReply.json(), {provider: 'association', configured: false});
      const beforeCalls = calls; await call('/auth/login', {account: 'author', password: 'anything'}, undefined, 503); assert.equal(calls, beforeCalls);
      config.associationAppKey = 'verification-key-never-sent';
      const first = await login(remote);
      assert.match(String(first.res.headers['set-cookie']), /HttpOnly/); assert.match(String(first.res.headers['set-cookie']), /SameSite=Strict/);
      assert.equal(first.user.role, 'USER'); assert.ok(!first.res.body.includes('passwordHash')); assert.ok(!first.res.body.includes(config.associationAppKey));
      const second = await login(remote, remote.email.toUpperCase()); assert.equal(second.user.id, first.user.id);
      assert.equal(await tx.user.count({where: {associationUserId: remote.userId}}), 1);
      assert.equal((await call('/auth/me', undefined, first)).json().user.id, first.user.id);
      await call('/auth/login', {account: 'a', password: 'a', role: 'ADMIN'}, undefined, 400);
      await call('/auth/login', {account: 'a', password: 'a'}, undefined, 403, 'POST', {origin: 'https://wrong.example'});
      await call('/auth/logout', {}, first, 403, 'POST', {'x-csrf-token': 'wrong'});
      await call('/admin/users', undefined, first, 403);
      for (const path of ['/auth/password', '/auth/reset-password', '/admin/users', `/admin/users/${first.user.id}/reset-password`]) await call(path, {}, first, 404);
      evidence.push('account/email share one local identity, ordinary-user default, session issuance, DTO secrecy, Origin/CSRF, admin boundary, retired password/create-user routes');

      const collision = identity(fixtureIdentity(2), 'collision'); emails.push(collision.email);
      await tx.user.create({data: {email: collision.email, name: 'unbound old admin', role: 'ADMIN', passwordHash: 'not a remote password'}});
      await login(collision, collision.userAccount, 409);
      assert.equal(await tx.user.count({where: {associationUserId: collision.userId}}), 0);

      const adminInfo = identity(fixtureIdentity(3), 'bound-admin'); emails.push(adminInfo.email);
      const localAdmin = await tx.user.create({data: {email: `old-${adminInfo.email}`, name: 'old admin', role: 'ADMIN', passwordHash: 'external', associationUserId: adminInfo.userId}});
      emails.push(localAdmin.email);
      const administrator = await login(adminInfo); assert.equal(administrator.user.id, localAdmin.id); assert.equal(administrator.user.role, 'ADMIN');
      const changed = await login({...remote, userAccount: 'renamed-account', userName: 'new nickname'});
      assert.equal(changed.user.id, first.user.id); assert.equal(changed.user.name, 'new nickname');
      let managed = await tx.user.findUniqueOrThrow({where: {id: first.user.id}});
      await call(`/admin/users/${first.user.id}`, {expectedVersion: managed.version, role: 'USER', disabled: true}, administrator, 200, 'PATCH');
      await call('/auth/me', undefined, first, 401); await login(remote, remote.userAccount, 403);
      managed = await tx.user.findUniqueOrThrow({where: {id: first.user.id}});
      await call(`/admin/users/${first.user.id}`, {expectedVersion: managed.version - 1, role: 'USER', disabled: false}, administrator, 409, 'PATCH');
      await call(`/admin/users/${first.user.id}`, {expectedVersion: managed.version, role: 'USER', disabled: false}, administrator, 200, 'PATCH');
      const author = await login(remote);
      const adminRow = await tx.user.findUniqueOrThrow({where: {id: localAdmin.id}});
      // Do not disable real administrators to manufacture this boundary in a live
      // database. Before first binding, the fixture is the sole usable admin.
      if (await tx.user.count({where: {role: 'ADMIN', disabled: false, associationUserId: {not: null}}}) === 1) {
        await call(`/admin/users/${localAdmin.id}`, {expectedVersion: adminRow.version, role: 'USER', disabled: false}, administrator, 409, 'PATCH');
        evidence.push('last bound administrator protected; unbound legacy administrators do not satisfy the guard');
      } else evidence.push('last-administrator boundary skipped: other bound administrators already exist');
      evidence.push('no automatic email takeover, explicit binding retains local ID/admin role, name/account sync, disable revokes sessions and stale edits rejected');

      await tx.problem.create({data: {id: fixtureProblemId, title: 'Rollback-only direct freeze', members: {create: {userId: author.user.id, role: 'OWNER'}}}});
      const profile = await tx.compileProfile.create({data: {...builtinProfiles[0], id: `profile-${suffix}`}});
      for (const role of ['MAIN_SOLUTION', 'VALIDATOR'] as const) {
        const p = await tx.program.create({data: {problemId: fixtureProblemId, name: role, role, profileId: profile.id, expectedVerdicts: ['AC']}});
        const r = await tx.programRevision.create({data: {programId: p.id, version: 1, source: '// Never executed', hash: sha256(role), configuration: {}}});
        await tx.program.update({where: {id: p.id}, data: {currentRevisionId: r.id}});
      }
      const blob = {key: 'verification-only/not-written', hash: sha256('fixture'), bytes: 7};
      await appendTest(tx, fixtureProblemId, {number: 1, groupName: 'main', isSample: false, enabled: true, notes: ''}, blob, blob, {});
      const document = await tx.document.create({data: {problemId: fixtureProblemId, language: 'zh-CN', kind: 'STATEMENT'}});
      const content = await tx.contentRevision.create({data: {documentId: document.id, version: 1, body: 'A rollback-only statement.', metadata: {title: 'Fixture', author: ''}, hash: sha256('statement')}});
      await tx.document.update({where: {id: document.id}, data: {currentRevisionId: content.id}});
      const snapshot = await problemSnapshot(tx, fixtureProblemId); assert.ok(snapshot.judgeHash); assert.equal(snapshot.acceptanceRunId, null);
      const draft = (await call(`/problems/${fixtureProblemId}/revisions`, {label: 'Direct freeze', expectedHash: snapshot.hash}, author)).json();
      assert.equal(draft.state, 'DRAFT');
      await call(`/revisions/${draft.id}/review`, {action: 'APPROVE', message: ''}, author, 404);
      await call(`/revisions/${draft.id}/freeze`, {}, author, 409);
      // Terminal metadata is a deliberate fixture, never a claim of real Judge execution.
      const run = await tx.testRun.create({data: {problemId: fixtureProblemId, requestedById: author.user.id, requestKey: suffix, purpose: 'ACCEPTANCE', state: 'SUCCEEDED', accepted: true, dependencyHash: snapshot.judgeHash!, inputHash: 'fixture', input: {verificationOnly: true}, stage: 'Not executed; rollback-only fixture'}});
      await tx.problemMember.create({data: {problemId: fixtureProblemId, userId: localAdmin.id, role: 'REVIEWER'}});
      // A regular reviewer can comment but cannot freeze.
      const reviewerInfo = identity(fixtureIdentity(4), 'reviewer'); emails.push(reviewerInfo.email);
      const reviewer = await login(reviewerInfo);
      await tx.problemMember.create({data: {problemId: fixtureProblemId, userId: reviewer.user.id, role: 'REVIEWER'}});
      await call(`/revisions/${draft.id}/comments`, {body: 'Comment without approval', anchor: 'statement'}, reviewer);
      await call(`/revisions/${draft.id}/freeze`, {}, reviewer, 403);
      await tx.problem.update({where: {id: fixtureProblemId}, data: {archived: true}});
      await call(`/revisions/${draft.id}/freeze`, {}, author, 409);
      await tx.problem.update({where: {id: fixtureProblemId}, data: {archived: false, title: 'changed'}});
      await call(`/revisions/${draft.id}/freeze`, {}, author, 409);
      await tx.problem.update({where: {id: fixtureProblemId}, data: {title: 'Rollback-only direct freeze'}});
      const frozen = (await call(`/revisions/${draft.id}/freeze`, {}, author)).json();
      assert.equal(frozen.state, 'FROZEN'); assert.equal(frozen.acceptanceRunId, run.id); assert.equal(frozen.hash, draft.hash);
      assert.equal(await tx.reviewDecision.count({where: {revisionId: draft.id}}), 0);
      await call(`/revisions/${draft.id}/freeze`, {}, author, 409);
      const legacy = (await call(`/problems/${fixtureProblemId}/revisions`, {label: 'Legacy pending', expectedHash: snapshot.hash}, author)).json();
      await tx.problemRevision.update({where: {id: legacy.id}, data: {state: 'SUBMITTED'}});
      assert.equal((await call(`/revisions/${legacy.id}`, undefined, author)).json().state, 'DRAFT');
      await call(`/revisions/${legacy.id}/freeze`, {}, author);
      await tx.problem.update({where: {id: fixtureProblemId}, data: {title: 'new working copy'}});
      assert.equal((await call(`/revisions/${draft.id}`, undefined, author)).json().hash, draft.hash);
      evidence.push('approval route removed, direct draft/legacy freeze, owner-only permission, required acceptance, archived/stale/repeated rejection, comments and immutable frozen history');

      const audits = JSON.stringify(await tx.auditLog.findMany({where: {actorId: {in: [author.user.id, localAdmin.id, reviewer.user.id]}}}));
      assert.ok(!audits.includes('verification password')); assert.ok(!audits.includes(config.associationAppKey));
      await call('/auth/logout', {}, author); await call('/auth/me', undefined, author, 401);
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, {timeout: 45000}).catch(e => {if (e !== rollback) throw e;});
  assert.equal(await db.problem.count({where: {id: fixtureProblemId}}), 0);
  assert.equal(await db.user.count({where: {email: {in: emails}}}), 0);
  assert.equal(await db.testRun.count({where: {requestKey: suffix}}), 0);
  evidence.push('all fixture identities, revisions, acceptance metadata and audit mutations rolled back; no listener or real external/Judge/TeX execution');
  const report = {passed: true, rolledBack: true, evidence};
  await writeFile('.local/verify-access-simplification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  config.associationAppKey = oldKey; globalThis.fetch = realFetch;
  await app?.close(); await db.$disconnect();
}
process.exit(0);
