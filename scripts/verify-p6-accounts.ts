// Explicit, isolated account verification; never changes the development admins.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config, hashPassword, sha256, token } from '@problemforge/domain';
import { db } from '@problemforge/database';

if (!process.argv.includes('--isolated')) {
  const url = new URL(process.env.DATABASE_URL!), database = `problemforge_p60_verify_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  await db.$disconnect(); url.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: url.toString() };
  for (const args of [['scripts/database.ts', 'migrate'], [fileURLToPath(import.meta.url), '--isolated']]) {
    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', ...args], { env, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
const database = new URL(process.env.DATABASE_URL!).pathname;
assert.match(database, /^\/problemforge_p60_verify_[a-f0-9]{12}$/);
const { createApp } = await import('../apps/api/src/app.ts');
const app = await createApp(false);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
let sequence = 1;
const ipGroup = Math.floor(Math.random() * 240) + 1;
class AccountClient {
  cookie = ''; csrf = ''; ip = `198.18.${ipGroup}.${sequence++}`;
  async call(path: string, method: 'GET'|'POST'|'PATCH' = 'GET', body?: object, expected = 200, extra: Record<string, string> = {}) {
    const response = await app.inject({ method, url: `/api${path}`, remoteAddress: this.ip, headers: { origin: config.origin, cookie: this.cookie, 'x-csrf-token': this.csrf, ...extra }, ...(body ? { payload: body } : {}) });
    const result = response.json(); assert.equal(response.statusCode, expected, `${method} ${path}: ${result.code ?? 'unexpected response'}`);
    const cookie = response.headers['set-cookie']; if (cookie) this.cookie = String(Array.isArray(cookie) ? cookie[0] : cookie).split(';')[0];
    return result;
  }
  async login(email: string, password: string, expected = 200) { const r = await this.call('/auth/login', 'POST', { email, password }, expected); if (r.csrfToken) this.csrf = r.csrfToken; return r.user; }
}
const secret = token(), nextSecret = token(), finalSecret = token(), checks: string[] = [];
try {
  const passwordHash = await hashPassword(secret);
  const a = await db.user.create({ data: { email: 'admin-a@verify.invalid', name: 'A', role: 'ADMIN', passwordHash } });
  const b = await db.user.create({ data: { email: 'admin-b@verify.invalid', name: 'B', role: 'ADMIN', passwordHash } });
  const adminA = new AccountClient(), adminB = new AccountClient();
  await adminA.login(a.email, secret); await adminB.login(b.email, secret);
  const u = await adminA.call('/admin/users', 'POST', { email: 'member@verify.invalid', name: 'Member', role: 'USER', password: secret });
  const user = new AccountClient(), other = new AccountClient(); await user.login(u.email, secret); await other.login(u.email, secret);
  const update = async (client: AccountClient, id: string, data: object, expected = 200) => {
    const row = await db.user.findUniqueOrThrow({ where: { id } });
    return client.call(`/admin/users/${id}`, 'PATCH', { email: row.email, name: row.name, role: row.role, disabled: row.disabled, expectedVersion: row.version, ...data }, expected);
  };
  const reset = async (id: string, expected = 200, client = adminA) => client.call(`/admin/users/${id}/reset-password`, 'POST', { expectedVersion: (await db.user.findUniqueOrThrow({ where: { id } })).version }, expected);
  await user.call('/admin/users', 'GET', undefined, 403);
  await update(user, u.id, { role: 'ADMIN' }, 403); await reset(u.id, 403, user);
  await user.call('/auth/sessions/revoke', 'POST', { all: false }, 403, { origin: 'http://untrusted.invalid' });
  await user.call('/auth/sessions/revoke', 'POST', { all: false }, 403, { 'x-csrf-token': 'wrong' });
  const list = await adminA.call('/admin/users'); assert(!JSON.stringify(list).includes(passwordHash)); assert(!JSON.stringify(list).includes('resetToken'));
  checks.push('ordinary-user denial, Origin/CSRF, public DTO excludes hashes/tokens');
  await user.call('/auth/sessions/revoke', 'POST', { all: false });
  await other.call('/auth/me', 'GET', undefined, 401); await user.call('/auth/me');
  await other.login(u.email, secret);
  await user.call('/auth/password', 'POST', { currentPassword: 'incorrect', newPassword: nextSecret }, 400);
  await user.call('/auth/password', 'POST', { currentPassword: secret, newPassword: nextSecret });
  await other.call('/auth/me', 'GET', undefined, 401); await user.call('/auth/me', 'GET', undefined, 401);
  await user.login(u.email, secret, 401); await user.login(u.email, nextSecret);
  checks.push('own password check/change invalidates every session; other-device revocation retains current');
  const staleVersion = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).version;
  await update(adminA, u.id, { name: 'Member updated' });
  await update(adminA, u.id, { expectedVersion: staleVersion, name: 'stale' }, 409);
  await update(adminA, u.id, { disabled: true });
  await user.call('/auth/me', 'GET', undefined, 401); await user.login(u.email, nextSecret, 401);
  await update(adminA, u.id, { disabled: false }); await user.login(u.email, nextSecret);
  await update(adminA, u.id, { role: 'ADMIN' }); await user.call('/admin/users', 'GET', undefined, 401);
  await update(adminA, u.id, { role: 'USER' });
  // A separate client avoids exhausting the legitimate per-IP login budget.
  const fresh = new AccountClient(); await fresh.login(u.email, nextSecret);
  const controller = new AbortController();
  const events = await fetch(`${address}/api/events`, { headers: { Cookie: fresh.cookie }, signal: controller.signal });
  assert.equal(events.status, 200); const reader = events.body!.getReader();
  let stream = ''; const decoder = new TextDecoder();
  const readUntil = async (needle: string) => { const timer = setTimeout(() => controller.abort(), 10000); try { while (!stream.includes(needle)) { const r = await reader.read(); assert(!r.done, 'SSE ended before expected event'); stream += decoder.decode(r.value); } } finally { clearTimeout(timer); } };
  await readUntil('event: tasks');
  const issued = await reset(u.id); await readUntil('event: access-revoked'); controller.abort();
  assert.equal((await db.passwordReset.findUniqueOrThrow({ where: { userId: u.id } })).id, sha256(issued.resetToken));
  await fresh.call('/auth/me', 'GET', undefined, 401); await fresh.login(u.email, nextSecret, 401);
  const anonymous = new AccountClient();
  await db.passwordReset.update({ where: { userId: u.id }, data: { expiresAt: new Date(0) } });
  await anonymous.call('/auth/reset-password', 'POST', { resetToken: issued.resetToken, newPassword: finalSecret }, 400);
  const superseded = await reset(u.id), latest = await reset(u.id);
  await anonymous.call('/auth/reset-password', 'POST', { resetToken: superseded.resetToken, newPassword: finalSecret }, 400);
  const attempts = await Promise.all([0,1].map(async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/reset-password', remoteAddress: anonymous.ip, headers: { origin: config.origin }, payload: { resetToken: latest.resetToken, newPassword: finalSecret } }); return response.statusCode;
  }));
  assert.deepEqual(attempts.sort(), [200,400]);
  await anonymous.call('/auth/reset-password', 'POST', { resetToken: latest.resetToken, newPassword: finalSecret }, 400);
  await fresh.login(u.email, finalSecret);
  await adminA.call(`/admin/users/${u.id}/revoke-sessions`, 'POST', { expectedVersion: (await db.user.findUniqueOrThrow({ where: { id: u.id } })).version });
  await fresh.call('/auth/me', 'GET', undefined, 401);
  checks.push('CAS, disable/enable, role-change invalidation, live SSE revocation, reset expiry/supersession/single-use concurrency and old-password denial');
  // Force a login to wait after its password check, then disable the account.
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { entered = resolve; });
  const holder = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`; entered(); await gate;
    await tx.user.update({ where: { id: u.id }, data: { disabled: true } }); await tx.session.deleteMany({ where: { userId: u.id } });
  }, { timeout: 12000 });
  await held; const racing = new AccountClient(), pendingLogin = racing.login(u.email, finalSecret, 401);
  try {
    const end = Date.now() + 7000; let waiting = false;
    while (Date.now() < end) { const [r] = await db.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND objid=70406100 AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`; if (r.count) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 40)); }
    assert(waiting, 'login did not reach account lock');
  } finally { release(); }
  await holder; await pendingLogin; assert.equal(await db.session.count({ where: { userId: u.id } }), 0);
  checks.push('deterministic login/disable race cannot issue a stale session');
  const demotions = await Promise.all([
    update(adminA, a.id, { role: 'USER' }).then(() => 200).catch(e => { if (String(e).includes('LAST_ADMIN')) return 409; throw e; }),
    update(adminB, b.id, { role: 'USER' }).then(() => 200).catch(e => { if (String(e).includes('LAST_ADMIN')) return 409; throw e; }),
  ]);
  assert.deepEqual(demotions.sort(), [200,409]);
  assert.equal(await db.user.count({ where: { role: 'ADMIN', disabled: false, passwordResetRequired: false } }), 1);
  const remaining = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } }), remainingClient = remaining.id === a.id ? adminA : adminB;
  assert.equal((await update(remainingClient, remaining.id, { disabled: true }, 409)).code, 'LAST_ADMIN');
  assert.equal((await reset(remaining.id, 409, remainingClient)).code, 'LAST_ADMIN');
  checks.push('concurrent last-admin demotion leaves exactly one; disabling/resetting last available admin rejected');
  const limited = new AccountClient();
  for (let n=0;n<8;n++) await limited.login('missing@verify.invalid', secret, 401);
  await limited.login('missing@verify.invalid', secret, 429);
  const audit = JSON.stringify(await db.auditLog.findMany());
  for (const value of [secret, nextSecret, finalSecret, passwordHash, issued.resetToken, latest.resetToken, superseded.resetToken]) assert(!audit.includes(value));
  for (const action of ['CHANGE_PASSWORD','ISSUE_PASSWORD_RESET','RESET_PASSWORD','REVOKE_USER_SESSIONS','UPDATE_USER']) assert(audit.includes(action));
  checks.push('login rate limit remains enforced; successful mutations audited without password/reset credentials');
  await mkdir('.local', { recursive: true });
  await writeFile('.local/verify-p6-accounts.json', JSON.stringify({ database, checkedAt: new Date(), checks, realJudgeOrTex: false }, null, 2));
  console.log(`PASS P6.0 accounts (${checks.length} groups); isolated database retained: ${database}`);
} finally { await app.close(); await db.$disconnect(); }
