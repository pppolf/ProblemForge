import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { trustedProxies } from './trusted-proxies.ts';

test('proxy configuration defaults to no trust and rejects ambiguous or universal trust', () => {
  assert.equal(trustedProxies(undefined), false);
  assert.equal(trustedProxies('  '), false);
  assert.deepEqual(trustedProxies('127.0.0.1, ::1, 192.0.2.0/24, 127.0.0.1'), ['127.0.0.1', '::1', '192.0.2.0/24']);
  for (const value of ['true', '*', '1', 'localhost', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1/', '127.0.0.1,', '127.0.0.1/8/8']) {
    assert.throws(() => trustedProxies(value), /API_TRUSTED_PROXIES/);
  }
});

test('only trusted peers supply client IP; untrusted forwarded headers cannot spoof it', async t => {
  const app = Fastify({ trustProxy: trustedProxies('192.0.2.10,::1') });
  t.after(() => app.close());
  app.get('/ip', req => ({ ip: req.ip }));
  const check = async (peer: string, forwarded: string, expected: string) => {
    const response = await app.inject({ url: '/ip', remoteAddress: peer, headers: { 'x-forwarded-for': forwarded } });
    assert.equal(response.json().ip, expected);
  };
  await check('192.0.2.10', '198.51.100.1', '198.51.100.1');
  await check('::1', '2001:db8::1', '2001:db8::1');
  await check('198.51.100.2', '198.51.100.99', '198.51.100.2');
  await check('192.0.2.10', '198.51.100.99, 198.51.100.1', '198.51.100.1');
});

test('clients behind a trusted proxy receive separate rate-limit buckets', async t => {
  const app = Fastify({ trustProxy: trustedProxies('192.0.2.10') });
  t.after(() => app.close());
  await app.register(rateLimit, { max: 2, timeWindow: '1 minute' });
  app.get('/limited', () => ({ ok: true }));
  const request = (client: string) => app.inject({ url: '/limited', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': client } });
  assert.equal((await request('198.51.100.1')).statusCode, 200);
  assert.equal((await request('198.51.100.1')).statusCode, 200);
  assert.equal((await request('198.51.100.1')).statusCode, 429);
  assert.equal((await request('198.51.100.2')).statusCode, 200);
});
