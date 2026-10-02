import { Type } from '@sinclair/typebox';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { LoginInput, LocalAdminPasswordInput, UserUpdateInput, UserVersionInput, SessionRevokeInput } from '@problemforge/contracts';
import { db, type Prisma, type User } from '@problemforge/database';
import { config, token, sha256, HttpError, isLocalAdministrator, hashPassword, verifyPassword } from '@problemforge/domain';
import { admin, authenticate, type Api } from '../app.ts';
import { associationConfigured, associationLogin, syncAssociationUser } from './association-login.ts';
import { publicUser, managedUser } from './user-view.ts';

const userParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false });
const dummyPasswordHash = `scrypt:32768:8:1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
const usableLocalAdmin = (u: User | null): u is User => !!u && isLocalAdministrator(u) && !u.disabled && !u.passwordResetRequired;
const loginFailed = () => new HttpError(401, '管理员账号或密码错误，或账号不可用', 'LOGIN_FAILED');
function sessionCookie(reply: FastifyReply, raw: string) {
  reply.setCookie('pf_session', raw, { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/api', maxAge: 7 * 86400 });
}

// All account writes and session issuance serialize across API processes.
// Remote authentication stays outside the lock; lock-time reads see prior commits.
async function accountTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`; return fn(tx); }, { timeout: 15000 });
}
async function actor(tx: Prisma.TransactionClient, req: FastifyRequest, needsAdmin = false) {
  const s = await tx.session.findUnique({ where: { id: req.sessionId }, include: { user: true } });
  if (!s || s.expiresAt <= new Date() || s.user.disabled || s.user.passwordResetRequired || s.csrfToken !== req.headers['x-csrf-token']) throw new HttpError(401, '登录已过期', 'AUTH_REQUIRED');
  if (needsAdmin && s.user.role !== 'ADMIN') throw new HttpError(403, '只有系统管理员可以管理用户', 'ADMIN_REQUIRED');
  return s.user;
}
async function target(tx: Prisma.TransactionClient, id: string, version: number) {
  const u = await tx.user.findUnique({ where: { id } });
  if (!u) throw new HttpError(404, '用户不存在');
  if (u.version !== version) throw new HttpError(409, '账号已被修改，请刷新后重新确认操作', 'VERSION_CONFLICT');
  return u;
}
async function protectAdmin(tx: Prisma.TransactionClient, before: User, after: Pick<User, 'role' | 'disabled'>) {
  if (before.role === 'ADMIN' && !before.disabled && (after.role !== 'ADMIN' || after.disabled)) {
    const others = await tx.user.findMany({ where: { role: 'ADMIN', disabled: false, passwordResetRequired: false, id: { not: before.id } } });
    if (isLocalAdministrator(before) && !others.some(isLocalAdministrator)) throw new HttpError(409, '必须保留至少一个可登录的独立超级管理员', 'LAST_LOCAL_ADMIN');
    if (!others.some(u => u.associationUserId !== null || isLocalAdministrator(u))) throw new HttpError(409, '必须保留至少一个可登录的系统管理员', 'LAST_ADMIN');
  }
}
async function invalidate(tx: Prisma.TransactionClient, userId: string, reset = false) {
  const result = await tx.session.deleteMany({ where: { userId } });
  if (reset) await tx.passwordReset.deleteMany({ where: { userId } });
  return result.count;
}
async function record(tx: Prisma.TransactionClient, actorId: string, action: string, resourceId: string, detail?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actorId, action, resourceId, detail } });
}

export async function authRoutes(app: Api) {
  app.get('/api/auth/config', async () => ({ provider: 'association', configured: associationConfigured(), localAdmin: true }));
  app.post('/api/auth/admin/login', { schema: { body: LoginInput, tags: ['身份'] }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const candidate = await db.user.findUnique({ where: { email: req.body.account.trim().toLowerCase() } });
    const valid = await verifyPassword(req.body.password, usableLocalAdmin(candidate) ? candidate.passwordHash : dummyPasswordHash);
    if (!usableLocalAdmin(candidate) || !valid) throw loginFailed();
    const raw = token(), csrfToken = token();
    const user = await accountTransaction(async tx => {
      const current = await tx.user.findUnique({ where: { id: candidate.id } });
      // Recheck under the same lock as password, role and session changes.
      if (!usableLocalAdmin(current) || current.passwordHash !== candidate.passwordHash) throw loginFailed();
      await tx.session.create({ data: { id: sha256(raw), userId: current.id, csrfToken, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
      await record(tx, current.id, 'LOCAL_ADMIN_LOGIN', current.id); return publicUser(current);
    });
    sessionCookie(reply, raw); return { user, csrfToken, appName: config.appName };
  });
  app.post('/api/auth/login', { schema: { body: LoginInput, tags: ['身份'] }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const identity = await associationLogin(req.body.account, req.body.password);
    const raw = token(), csrfToken = token();
    const user = await accountTransaction(async tx => {
      const current = await syncAssociationUser(tx, identity);
      await tx.session.create({ data: { id: sha256(raw), userId: current.id, csrfToken, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
      await record(tx, current.id, 'LOGIN', current.id); return publicUser(current);
    });
    sessionCookie(reply, raw);
    return { user, csrfToken, appName: config.appName };
  });
  app.get('/api/auth/me', { preHandler: authenticate, schema: { tags: ['身份'] } }, async req => ({ user: req.user, csrfToken: req.csrfToken, appName: config.appName }));
  app.post('/api/auth/admin/password', { preHandler: admin, schema: { body: LocalAdminPasswordInput, tags: ['身份'] }, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (req.user.authProvider !== 'local-admin') throw new HttpError(403, '只有独立超级管理员可以修改本地密码', 'LOCAL_ADMIN_REQUIRED');
    if (req.body.newPassword === req.body.currentPassword) throw new HttpError(400, '新密码不能与当前密码相同');
    const passwordHash = await hashPassword(req.body.newPassword);
    await accountTransaction(async tx => {
      const current = await actor(tx, req, true);
      if (!isLocalAdministrator(current)) throw new HttpError(403, '只有独立超级管理员可以修改本地密码', 'LOCAL_ADMIN_REQUIRED');
      if (!await verifyPassword(req.body.currentPassword, current.passwordHash)) throw new HttpError(400, '当前密码不正确', 'CURRENT_PASSWORD_INVALID');
      await tx.user.update({ where: { id: current.id }, data: { passwordHash, version: { increment: 1 } } });
      await invalidate(tx, current.id, true);
      await record(tx, current.id, 'CHANGE_LOCAL_ADMIN_PASSWORD', current.id);
    });
    reply.clearCookie('pf_session', { path: '/api' }); return { signedOut: true };
  });
  app.post('/api/auth/logout', { preHandler: authenticate }, async (req, reply) => {
    await db.session.deleteMany({ where: { id: req.sessionId } });
    reply.clearCookie('pf_session', { path: '/api' }); return { ok: true };
  });
  app.get('/api/auth/sessions', { preHandler: authenticate }, async req => {
    const rows = await db.session.findMany({ where: { userId: req.user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return rows.map(s => ({ createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === req.sessionId }));
  });
  app.post('/api/auth/sessions/revoke', { preHandler: authenticate, schema: { body: SessionRevokeInput } }, async (req, reply) => {
    const revoked = await accountTransaction(async tx => {
      const u = await actor(tx, req);
      const result = await tx.session.deleteMany({ where: { userId: u.id, ...(req.body.all ? {} : { id: { not: req.sessionId } }) } });
      await record(tx, u.id, 'REVOKE_OWN_SESSIONS', u.id, { all: req.body.all, count: result.count }); return result.count;
    });
    if (req.body.all) reply.clearCookie('pf_session', { path: '/api' }); return { revoked };
  });
  app.get('/api/admin/users', { preHandler: admin }, async () => (await db.user.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map(managedUser));
  app.patch('/api/admin/users/:id', { preHandler: admin, schema: { params: userParams, body: UserUpdateInput, tags: ['系统管理'] } }, async (req, reply) => {
    const result = await accountTransaction(async tx => {
      const by = await actor(tx, req, true), before = await target(tx, req.params.id, req.body.expectedVersion);
      const data = { role: req.body.role, disabled: req.body.disabled };
      await protectAdmin(tx, before, { ...before, ...data });
      const user = managedUser(await tx.user.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } }));
      const sessionsRevoked = before.role !== user.role || before.disabled !== user.disabled;
      if (sessionsRevoked) await invalidate(tx, user.id, true);
      await record(tx, by.id, 'UPDATE_USER', user.id, { before: { ...publicUser(before), disabled: before.disabled }, after: data, sessionsRevoked });
      return { user, signedOut: user.id === by.id && sessionsRevoked };
    });
    if (result.signedOut) reply.clearCookie('pf_session', { path: '/api' }); return result;
  });
  app.post('/api/admin/users/:id/revoke-sessions', { preHandler: admin, schema: { params: userParams, body: UserVersionInput } }, async (req, reply) => {
    const result = await accountTransaction(async tx => {
      const by = await actor(tx, req, true), u = await target(tx, req.params.id, req.body.expectedVersion);
      const revoked = await invalidate(tx, u.id);
      await record(tx, by.id, 'REVOKE_USER_SESSIONS', u.id, { count: revoked }); return { revoked, signedOut: by.id === u.id };
    });
    if (result.signedOut) reply.clearCookie('pf_session', { path: '/api' }); return result;
  });
}
