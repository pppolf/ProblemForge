import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { protectedSwaggerUI } from './swagger-ui.ts';

test('upgraded Swagger UI protects both documents and static files', async () => {
  const app = Fastify();
  await app.register(swagger, { openapi: { info: { title: 'Dependency check', version: '1' } } });
  await protectedSwaggerUI(app, async (req, reply) => {
    if (req.headers.authorization !== 'Bearer test-only') return reply.code(401).send();
  });
  try {
    for (const url of ['/api/docs/', '/api/docs/json', '/api/docs/static/swagger-ui.css']) {
      assert.equal((await app.inject({ url })).statusCode, 401, url);
      assert.equal((await app.inject({ url, headers: { authorization: 'Bearer test-only' } })).statusCode, 200, url);
    }
    const traversal = await app.inject({ url: '/api/docs/static/../package.json', headers: { authorization: 'Bearer test-only' } });
    assert.notEqual(traversal.statusCode, 200);
    assert.ok(!traversal.body.includes('"dependencies"'));
  } finally { await app.close(); }
});

test('upgraded Fastify keeps strict JSON body validation', async () => {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.post('/check', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'integer' } },
  } } }, async () => ({ ok: true }));
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/check', payload: { value: 1 } })).statusCode, 200);
    for (const payload of [{ value: '1' }, { value: 1, unexpected: true }, {}]) {
      assert.equal((await app.inject({ method: 'POST', url: '/check', payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/check', payload: 'arbitrary', headers: { 'content-type': 'application/octet-stream' } })).statusCode, 415);
  } finally { await app.close(); }
});
