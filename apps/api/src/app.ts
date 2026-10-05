import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { protectedSwaggerUI } from './swagger-ui.ts';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Redis } from 'ioredis';
import { db } from '@problemforge/database';
import { config, sha256, HttpError, ManagedStorage } from '@problemforge/domain';
import { ContentPolicyError } from '@problemforge/template-engine';
import type { AuthenticatedUser } from '@problemforge/contracts';
import { publicUser } from './modules/user-view.ts';
import { authRoutes } from './modules/auth.ts';
import { problemRoutes } from './modules/problems.ts';
import { templateRoutes } from './modules/templates.ts';
import { buildRoutes } from './modules/builds.ts';
import { assetRoutes } from './modules/assets.ts';
import { judgeRoutes } from './modules/judge.ts';
import { testRunRoutes } from './modules/test-runs.ts';
import { stressRoutes } from './modules/stress.ts';
import { counterexampleRoutes } from './modules/counterexamples.ts';
import { groupRoutes } from './modules/test-groups.ts';
import { memberRoutes } from './modules/members.ts';
import { revisionRoutes } from './modules/revisions.ts';
import { contestRoutes } from './modules/contests.ts';
import { contestBuildRoutes } from './modules/contest-builds.ts';
import { releaseRoutes } from './modules/releases.ts';
import { packageRoutes } from './modules/packages.ts';
import { PackageError } from '@problemforge/problem-format';
import { operationsRoutes } from './modules/operations.ts';
import { staticRoutes } from './modules/static.ts';
import { historyRoutes } from './modules/history.ts';
import { trustedProxies } from './trusted-proxies.ts';

declare module 'fastify' {
  interface FastifyRequest { user: AuthenticatedUser; sessionId: string; csrfToken: string; }
}
export type Api = ReturnType<typeof createTypedApp>;
function createTypedApp(logging: boolean) {
  return Fastify({ logger: logging ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.credential', 'req.body.appKey', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.resetToken'] } : false,
    trustProxy: trustedProxies(process.env.API_TRUSTED_PROXIES),
    bodyLimit: 2_500_000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();
}
export const storage = new ManagedStorage(config.storageRoot);
export async function authenticate(req: FastifyRequest) {
  const raw = req.cookies.pf_session;
  if (!raw) throw new HttpError(401, '请先登录', 'AUTH_REQUIRED');
  const session = await db.session.findUnique({ where: { id: sha256(raw) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || session.user.disabled || session.user.passwordResetRequired) throw new HttpError(401, '登录已过期', 'AUTH_REQUIRED');
  req.user = publicUser(session.user);
  req.sessionId = session.id; req.csrfToken = session.csrfToken;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrfToken) throw new HttpError(403, 'CSRF 验证失败', 'CSRF_FAILED');
}
export async function admin(req: FastifyRequest) {
  await authenticate(req);
  if (req.user.role !== 'ADMIN') throw new HttpError(403, '只有系统管理员可以维护模板或用户', 'ADMIN_REQUIRED');
}
export async function createApp(logging = true) {
  const app = createTypedApp(logging);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', e => app.log.error({ message: e.message }, 'Redis connection failed'));
  await app.register(cookie);
  await app.register(rateLimit, { global: false, redis, skipOnError: false });
  await app.register(swagger, { openapi: { info: { title: `${config.appName} API`, version: '0.1.0' }, components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'pf_session' } } } } });
  await protectedSwaggerUI(app, authenticate);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) throw new HttpError(403, '请求来源不被允许', 'ORIGIN_FAILED');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof PackageError) return reply.code(422).send({code:'PACKAGE_ERROR',message:error.message});
    if (error instanceof ContentPolicyError) return reply.code(422).send({ code: 'CONTENT_POLICY', message: error.message, details: error.issues });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ code: error.code, message: error.message, details: error.details });
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请求字段不符合接口约束', details: fastifyError.validation });
    if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ code: 'CONFLICT', message: '记录已存在或版本冲突' });
    if ((error as { code?: string }).code === 'P2034') return reply.code(409).send({ code: 'VERSION_CONFLICT', message: '并发更新冲突，请刷新后合并修改' });
    if (fastifyError.statusCode && fastifyError.statusCode < 500) return reply.code(fastifyError.statusCode).send({ code: 'REQUEST_ERROR', message: fastifyError.message });
    req.log.error(error);
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: '后端处理失败，请查看服务日志' });
  });
  await operationsRoutes(app,redis);
  await authRoutes(app);
  await historyRoutes(app);
  await problemRoutes(app);
  await templateRoutes(app);
  await buildRoutes(app);
  await assetRoutes(app);
  await judgeRoutes(app);
  await testRunRoutes(app);
  await stressRoutes(app);
  await counterexampleRoutes(app);
  await groupRoutes(app);
  await memberRoutes(app);
  await revisionRoutes(app);
  await contestRoutes(app);
  await contestBuildRoutes(app);
  await releaseRoutes(app);
  await packageRoutes(app);
  await staticRoutes(app);
  app.addHook('onClose', async () => { redis.disconnect(); });
  return app;
}
