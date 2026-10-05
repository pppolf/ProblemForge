import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '@problemforge/domain';
import { acquireStreamLease } from './stream-lease.ts';

test('two API clients share SSE quota, release slots, and reclaim expired leases', { skip: process.env.PF_VERIFY_REDIS !== '1' }, async () => {
  const clients = [new Redis(config.redisUrl, { maxRetriesPerRequest: 1 }), new Redis(config.redisUrl, { maxRetriesPerRequest: 1 })];
  const user = `verify-stream-${randomUUID()}`, key = `problemforge:sse:${user}`;
  try {
    const leases = (await Promise.all(Array.from({ length: 12 }, (_, i) => acquireStreamLease(clients[i % 2], user)))).filter(x => x !== null);
    assert.equal(leases.length, 5);
    assert.equal(await acquireStreamLease(clients[1], user), null);
    assert.equal(await leases[0].renew(), true);
    await leases[0].release();
    const replacement = await acquireStreamLease(clients[1], user); assert.ok(replacement);
    assert.equal(await clients[0].zcard(key), 5);
    const members = await clients[0].zrange(key, 0, -1);
    await clients[0].zadd(key, ...members.flatMap(member => ['0', member]));
    assert.equal(await replacement.renew(), false);
    const recovered = await acquireStreamLease(clients[0], user); assert.ok(recovered);
    assert.ok(await clients[0].pttl(key) > 0);
    clients[1].disconnect();
    await assert.rejects(acquireStreamLease(clients[1], user));
    await recovered.release();
  } finally { await clients[0].del(key); for (const client of clients) client.disconnect(); }
});
