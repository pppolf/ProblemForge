import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { db } from '@problemforge/database';
import { Queue } from 'bullmq';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
dotenv({ path: resolve(root, '.env') });
function required(name: string) {
  const value = process.env[name];
  if (!value || value === 'CHANGE_ME') throw new Error(`请配置 ${name}，参见 .env.example`);
  return value;
}
export const config = {
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5180',
  port: Number(process.env.API_PORT ?? 3100), host: process.env.API_HOST ?? '127.0.0.1',
  production: process.env.NODE_ENV === 'production', appName: process.env.APP_NAME ?? 'ProblemForge',
  storageRoot: resolve(root, process.env.STORAGE_ROOT ?? './storage'),
  redisUrl: required('REDIS_URL'), sandboxUrl: process.env.TEX_SANDBOX_URL ?? 'http://127.0.0.1:15050',
  sandboxToken: required('TEX_SANDBOX_TOKEN'),
  judgeSandboxUrl: process.env.JUDGE_SANDBOX_URL ?? 'http://127.0.0.1:15051',
  judgeSandboxToken: process.env.JUDGE_SANDBOX_TOKEN,
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
export function sha256(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function hashObject(value: unknown) { return sha256(canonical(value)); }
export const token = () => randomBytes(32).toString('hex');
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt:32768:8:1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hex] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hex || n !== '32768' || r !== '8' || p !== '1') return false;
  const actual = await derive(password, salt);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code = 'REQUEST_ERROR', public details?: unknown) { super(message); }
}
export async function problemAccess(user: { id: string; role: string }, problemId: string, write = false) {
  const problem = await db.problem.findUnique({ where: { id: problemId }, select: { id: true, archived: true } });
  const member = await db.problemMember.findUnique({ where: { problemId_userId: { problemId, userId: user.id } } });
  if (!problem || (!member && user.role !== 'ADMIN')) throw new HttpError(404, '题目不存在或没有访问权限');
  if (write && problem.archived) throw new HttpError(409, '题目已归档');
  if (write && user.role !== 'ADMIN' && !['OWNER', 'EDITOR'].includes(member?.role ?? '')) throw new HttpError(403, '需要题目编辑权限');
  return member?.role ?? 'OWNER';
}
export async function audit(actorId: string | null, action: string, resourceId?: string, detail?: object) {
  await db.auditLog.create({ data: { actorId, action, resourceId, ...(detail ? { detail } : {}) } });
}
export function redisConnection(worker = false) {
  const url = new URL(config.redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined, db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: worker };
}
export const texQueue = () => new Queue('tex', { connection: redisConnection(), prefix: 'problemforge', defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 200 } });
export const judgeQueue = () => new Queue('judge', { connection: redisConnection(), prefix: 'problemforge', defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 200 } });
