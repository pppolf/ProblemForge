import { Type } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import { LoginInput, UserInput, UserUpdateInput, UserVersionInput, PasswordChangeInput, PasswordResetInput, SessionRevokeInput } from '@problemforge/contracts';
import { db, type Prisma, type User } from '@problemforge/database';
import { config, token, sha256, verifyPassword, hashPassword, HttpError } from '@problemforge/domain';
import { admin, authenticate, type Api } from '../app.ts';

const userSelect = { id: true, email: true, name: true, role: true, disabled: true, version: true, passwordResetRequired: true } as const;
const userParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false });
const availableAdmin = { role: 'ADMIN' as const, disabled: false, passwordResetRequired: false };
const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const invalidLogin = () => new HttpError(401, '邮箱或密码错误，或账号需要管理员处理', 'LOGIN_FAILED');
const invalidReset = () => new HttpError(400, '重置凭据无效、已使用或已过期，请联系管理员重新发起', 'RESET_INVALID');

// All account writes and session issuance serialize across API processes.
// Hashing stays outside the lock; READ COMMITTED reads after locking see prior commits.
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
async function protectAdmin(tx: Prisma.TransactionClient, before: User, after: Pick<User, 'role' | 'disabled' | 'passwordResetRequired'>) {
  if (before.role === 'ADMIN' && !before.disabled && !before.passwordResetRequired && (after.role !== 'ADMIN' || after.disabled || after.passwordResetRequired)) {
    if (!await tx.user.count({ where: { ...availableAdmin, id: { not: before.id } } })) throw new HttpError(409, '必须保留至少一个可登录的系统管理员', 'LAST_ADMIN');
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
  const dummyHash = await hashPassword(token());
  app.post('/api/auth/login', { schema: { body: LoginInput, tags: ['身份'] }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const candidate = await db.user.findUnique({ where: { email: req.body.email.trim().toLowerCase() } });
    const valid = await verifyPassword(req.body.password, candidate?.passwordHash ?? dummyHash);
    if (!valid || !candidate) throw invalidLogin();
    const raw = token(), csrfToken = token();
    const user = await accountTransaction(async tx => {
      const current = await tx.user.findUnique({ where: { id: candidate.id } });
      if (!current || current.passwordHash !== candidate.passwordHash || current.email !== candidate.email || current.disabled || current.passwordResetRequired) throw invalidLogin();
      await tx.session.create({ data: { id: sha256(raw), userId: current.id, csrfToken, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
      await record(tx, current.id, 'LOGIN', current.id); return publicUser(current);
    });
    reply.setCookie('pf_session', raw, { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/api', maxAge: 7 * 86400 });
    return { user, csrfToken, appName: config.appName };
  });
  app.get('/api/auth/me', { preHandler: authenticate, schema: { tags: ['身份'] } }, async req => ({ user: req.user, csrfToken: req.csrfToken, appName: config.appName }));
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
  app.post('/api/auth/password', { preHandler: authenticate, schema: { body: PasswordChangeInput }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const candidate = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!await verifyPassword(req.body.currentPassword, candidate.passwordHash)) throw new HttpError(400, '当前密码不正确', 'CURRENT_PASSWORD_INVALID');
    const passwordHash = await hashPassword(req.body.newPassword);
    await accountTransaction(async tx => {
      const u = await actor(tx, req);
      if (u.passwordHash !== candidate.passwordHash) throw new HttpError(409, '密码已变更，请重新登录', 'VERSION_CONFLICT');
      await tx.user.update({ where: { id: u.id }, data: { passwordHash, passwordResetRequired: false, version: { increment: 1 } } });
      await invalidate(tx, u.id, true); await record(tx, u.id, 'CHANGE_PASSWORD', u.id);
    });
    reply.clearCookie('pf_session', { path: '/api' }); return { ok: true };
  });
  app.post('/api/auth/reset-password', { schema: { body: PasswordResetInput }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const resetId = sha256(req.body.resetToken), candidate = await db.passwordReset.findUnique({ where: { id: resetId } });
    if (!candidate || candidate.expiresAt <= new Date()) throw invalidReset();
    const passwordHash = await hashPassword(req.body.newPassword);
    await accountTransaction(async tx => {
      const reset = await tx.passwordReset.findUnique({ where: { id: resetId }, include: { user: true } });
      if (!reset || reset.expiresAt <= new Date() || reset.user.disabled || !reset.user.passwordResetRequired) throw invalidReset();
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordResetRequired: false, version: { increment: 1 } } });
      await invalidate(tx, reset.userId, true); await record(tx, reset.userId, 'RESET_PASSWORD', reset.userId);
    });
    reply.clearCookie('pf_session', { path: '/api' }); return { ok: true };
  });
  app.get('/api/admin/users', { preHandler: admin }, async () => db.user.findMany({ select: userSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
  app.post('/api/admin/users', { preHandler: admin, schema: { body: UserInput, tags: ['系统管理'] } }, async req => {
    const passwordHash = await hashPassword(req.body.password);
    return accountTransaction(async tx => {
      const by = await actor(tx, req, true);
      const user = await tx.user.create({ data: { email: req.body.email.trim().toLowerCase(), name: req.body.name, role: req.body.role, passwordHash }, select: userSelect });
      await record(tx, by.id, 'CREATE_USER', user.id); return user;
    });
  });
  app.patch('/api/admin/users/:id', { preHandler: admin, schema: { params: userParams, body: UserUpdateInput, tags: ['系统管理'] } }, async (req, reply) => {
    const result = await accountTransaction(async tx => {
      const by = await actor(tx, req, true), before = await target(tx, req.params.id, req.body.expectedVersion);
      const data = { email: req.body.email.trim().toLowerCase(), name: req.body.name, role: req.body.role, disabled: req.body.disabled };
      await protectAdmin(tx, before, { ...before, ...data });
      const user = await tx.user.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } }, select: userSelect });
      const sessionsRevoked = before.email !== user.email || before.role !== user.role || before.disabled !== user.disabled;
      if (sessionsRevoked) await invalidate(tx, user.id, true);
      await record(tx, by.id, 'UPDATE_USER', user.id, { before: { ...publicUser(before), disabled: before.disabled }, after: data, sessionsRevoked });
      return { user, signedOut: user.id === by.id && sessionsRevoked };
    });
    if (result.signedOut) reply.clearCookie('pf_session', { path: '/api' }); return result;
  });
  app.post('/api/admin/users/:id/reset-password', { preHandler: admin, schema: { params: userParams, body: UserVersionInput } }, async (req, reply) => {
    const raw = token();
    const result = await accountTransaction(async tx => {
      const by = await actor(tx, req, true), u = await target(tx, req.params.id, req.body.expectedVersion);
      if (u.disabled) throw new HttpError(409, '请先启用账号再发起重置', 'ACCOUNT_DISABLED');
      await protectAdmin(tx, u, { ...u, passwordResetRequired: true });
      await invalidate(tx, u.id, true);
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      await tx.passwordReset.create({ data: { id: sha256(raw), userId: u.id, expiresAt } });
      await tx.user.update({ where: { id: u.id }, data: { passwordResetRequired: true, version: { increment: 1 } } });
      await record(tx, by.id, 'ISSUE_PASSWORD_RESET', u.id, { expiresAt: expiresAt.toISOString() });
      return { resetToken: raw, expiresAt, signedOut: by.id === u.id };
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
