import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import swaggerUI from '@fastify/swagger-ui';

// The plugin's uiHooks cover document routes, not every static asset route.
// Encapsulation keeps the entire documentation subtree behind authentication.
export async function protectedSwaggerUI(app: FastifyInstance, authenticate: onRequestAsyncHookHandler) {
  await app.register(async docs => {
    docs.addHook('onRequest', authenticate);
    await docs.register(swaggerUI, { routePrefix: '/api/docs' });
  });
}
