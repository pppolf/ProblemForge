import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const ttl = 30_000;
const acquireScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1`;
const renewScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if not redis.call('ZSCORE', KEYS[1], ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`;

// PM2 instances share five slots per user. A crashed process loses its slots
// automatically; a rolling reload releases its slots before Redis disconnects.
export async function acquireStreamLease(redis: Redis, userId: string) {
  const key = `problemforge:sse:${userId}`, token = randomUUID(), now = Date.now();
  if (await redis.eval(acquireScript, 1, key, now, now + ttl, token, 5, ttl) !== 1) return null;
  return {
    renew: async () => {
      const time = Date.now();
      return await redis.eval(renewScript, 1, key, time, time + ttl, token, ttl) === 1;
    },
    release: async () => { await redis.zrem(key, token); },
  };
}
