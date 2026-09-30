import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Redis } from 'ioredis';
import { db } from '@problemforge/database';
import { config, sha256, HttpError } from '@problemforge/domain';
import { PrivateFileStorage } from '@problemforge/storage';
import { ContentPolicyError } from '@problemforge/template-engine';
import type { UserView } from '@problemforge/contracts';
import { authRoutes } from './modules/auth.ts';
import { problemRoutes } from './modules/problems.ts';
import { templateRoutes } from './modules/templates.ts';
import { buildRoutes } from './modules/builds.ts';
import { assetRoutes } from './modules/assets.ts';

declare module 'fastify' {
  interface FastifyRequest { user: UserView; sessionId: string; csrfToken: string; }
}
export type Api = ReturnType<typeof createTypedApp>;
function createTypedApp(logging: boolean) {
  return Fastify({ logger: logging ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'] } : false,
    bodyLimit: 2_500_000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();
}
export const storage = new PrivateFileStorage(config.storageRoot);
export async function authenticate(req: FastifyRequest) {
  const raw = req.cookies.pf_session;
  if (!raw) throw new HttpError(401, '请先登录', 'AUTH_REQUIRED');
  const session = await db.session.findUnique({ where: { id: sha256(raw) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.disabled) throw new HttpError(401, '登录已过期', 'AUTH_REQUIRED');
  req.user = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role };
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
  await app.register(swaggerUI, { routePrefix: '/api/docs', uiHooks: { onRequest: authenticate } });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) throw new HttpError(403, '请求来源不被允许', 'ORIGIN_FAILED');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ContentPolicyError) return reply.code(422).send({ code: 'CONTENT_POLICY', message: error.message, details: error.issues });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ code: error.code, message: error.message, details: error.details });
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请求字段不符合接口约束', details: fastifyError.validation });
    if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ code: 'CONFLICT', message: '记录已存在或版本冲突' });
    if (fastifyError.statusCode && fastifyError.statusCode < 500) return reply.code(fastifyError.statusCode).send({ code: 'REQUEST_ERROR', message: fastifyError.message });
    req.log.error(error);
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: '后端处理失败，请查看服务日志' });
  });
  app.get('/api/health', async () => { await db.$queryRaw`SELECT 1`; await redis.ping(); return { status: 'ok', appName: config.appName }; });
  await authRoutes(app);
  await problemRoutes(app);
  await templateRoutes(app);
  await buildRoutes(app);
  await assetRoutes(app);
  app.addHook('onClose', async () => { redis.disconnect(); });
  return app;
}
