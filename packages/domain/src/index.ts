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
  leaseMs: Number(process.env.TASK_LEASE_MS ?? 45000),
  buildQuota: Number(process.env.BUILD_QUOTA ?? 6), judgeQuota: Number(process.env.JUDGE_QUOTA ?? 3),
  maxAttempts: Number(process.env.TASK_MAX_ATTEMPTS ?? 3),
  storageQuotaBytes: Number(process.env.STORAGE_QUOTA_BYTES ?? 10_000_000_000),
};
for (const value of [config.leaseMs, config.buildQuota, config.judgeQuota, config.maxAttempts, config.storageQuotaBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('运行配额配置必须为正整数');
if (config.leaseMs < 10000) throw new Error('TASK_LEASE_MS 至少 10000');
if (config.production && new URL(config.origin).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.origin).hostname)) throw new Error('生产 APP_ORIGIN 必须使用 HTTPS；仅本机演练可用 HTTP');
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
export async function problemPermission(user: { id: string; role: string }, problemId: string) {
  const problem = await db.problem.findUnique({ where: { id: problemId }, select: { id: true, archived: true } });
  const member = await db.problemMember.findUnique({ where: { problemId_userId: { problemId, userId: user.id } } });
  const groups = await db.problemGroupMember.findMany({where:{problemId,group:{members:{some:{userId:user.id}}}}});
  const grants = [...(member ? [member] : []), ...groups];
  if (!problem || (!grants.length && user.role !== 'ADMIN')) throw new HttpError(404, '题目不存在或没有访问权限');
  const order = ['OWNER','EDITOR','REVIEWER','VIEWER','TRANSLATOR'];
  const role = user.role === 'ADMIN' ? 'OWNER' : grants.sort((a,b)=>order.indexOf(a.role)-order.indexOf(b.role))[0].role;
  return {role,archived:problem.archived,languages:[...new Set(grants.flatMap(g=>g.languages))]};
}
export async function problemAccess(user: { id: string; role: string }, problemId: string, write = false) {
  const permission = await problemPermission(user,problemId);
  if (permission.role === 'TRANSLATOR') throw new HttpError(403,'翻译成员仅可访问已授权语言的稿件');
  if (write && permission.archived) throw new HttpError(409, '题目已归档');
  if (write && !['OWNER','EDITOR'].includes(permission.role)) throw new HttpError(403,'需要题目编辑权限');
  return permission.role;
}
export async function documentAccess(user: {id:string;role:string}, problemId:string, language:string, write=false) {
  const permission = await problemPermission(user,problemId);
  if (permission.role === 'TRANSLATOR' && !permission.languages.includes(language)) throw new HttpError(404,'稿件不存在或未授权此语言');
  if (write && permission.archived) throw new HttpError(409,'题目已归档');
  if (write && !['OWNER','EDITOR','TRANSLATOR'].includes(permission.role)) throw new HttpError(403,'需要稿件编辑权限');
  return permission.role;
}
export async function contestAccess(user:{id:string;role:string},contestId:string,write=false) {
  const contest=await db.contest.findUnique({where:{id:contestId},include:{members:{where:{userId:user.id}},groupMembers:{where:{group:{members:{some:{userId:user.id}}}}}}});
  const order=['OWNER','EDITOR','REVIEWER','VIEWER'];
  const grants=contest?[...contest.members,...contest.groupMembers]:[];
  if(!contest||(!grants.length&&user.role!=='ADMIN'))throw new HttpError(404,'比赛不存在或没有访问权限');
  const role=user.role==='ADMIN'?'OWNER':grants.sort((a,b)=>order.indexOf(a.role)-order.indexOf(b.role))[0].role;
  if(write&&contest.archived)throw new HttpError(409,'比赛已归档');
  if(write&&!['OWNER','EDITOR'].includes(role))throw new HttpError(403,'需要比赛编辑权限');
  return role;
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
export * from './tasks.ts';
export * from './storage.ts';
