import { LoginInput, UserInput } from '@problemforge/contracts';
import { db } from '@problemforge/database';
import { config, token, sha256, verifyPassword, hashPassword, HttpError, audit } from '@problemforge/domain';
import { admin, authenticate, type Api } from '../app.ts';

export async function authRoutes(app: Api) {
  const dummyHash = await hashPassword(token());
  app.post('/api/auth/login', { schema: { body: LoginInput, tags: ['身份'] }, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const user = await db.user.findUnique({ where: { email: req.body.email.trim().toLowerCase() } });
    const valid = await verifyPassword(req.body.password, user?.passwordHash ?? dummyHash);
    if (!valid || !user || user.disabled) throw new HttpError(401, '邮箱或密码错误', 'LOGIN_FAILED');
    const raw = token(); const csrfToken = token();
    await db.session.create({ data: { id: sha256(raw), userId: user.id, csrfToken, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    reply.setCookie('pf_session', raw, { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/api', maxAge: 7 * 86400 });
    await audit(user.id, 'LOGIN', user.id);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, csrfToken, appName: config.appName };
  });
  app.get('/api/auth/me', { preHandler: authenticate, schema: { tags: ['身份'] } }, async req => ({ user: req.user, csrfToken: req.csrfToken, appName: config.appName }));
  app.post('/api/auth/logout', { preHandler: authenticate }, async (req, reply) => {
    await db.session.deleteMany({ where: { id: req.sessionId } });
    reply.clearCookie('pf_session', { path: '/api' }); return { ok: true };
  });
  app.get('/api/admin/users', { preHandler: admin }, async () => db.user.findMany({ select: { id: true, email: true, name: true, role: true, disabled: true }, orderBy: { createdAt: 'desc' } }));
  app.post('/api/admin/users', { preHandler: admin, schema: { body: UserInput, tags: ['系统管理'] } }, async req => {
    const user = await db.user.create({ data: { email: req.body.email.toLowerCase(), name: req.body.name, role: req.body.role, passwordHash: await hashPassword(req.body.password) }, select: { id: true, email: true, name: true, role: true } });
    await audit(req.user.id, 'CREATE_USER', user.id); return user;
  });
}
