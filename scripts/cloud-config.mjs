import { createHash, randomBytes } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const INSTALL_ROOT = '/opt/problemforge';
export const SERVICE_USER = 'problemforge';
export const APP_NAMES = ['problemforge-api', 'problemforge-tex', 'problemforge-judge'];
export const CADDY_FILE = '/etc/caddy/Caddyfile';
export const CADDY_BEGIN = '# BEGIN PROBLEMFORGE MANAGED SITE';
export const CADDY_END = '# END PROBLEMFORGE MANAGED SITE';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function cloudSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['format', 'domain', 'instances', 'ports'].includes(k))) throw new Error('未知部署配置字段');
  if (input.format !== undefined && input.format !== 1) throw new Error('不支持的部署配置版本');
  if (input.ports !== undefined && (!input.ports || typeof input.ports !== 'object' || Array.isArray(input.ports))) throw new Error('ports 必须是端口对象');
  const settings = {
    format: 1, domain: input.domain ?? 'problems.cwnupaa.com', instances: input.instances ?? 2,
    ports: { api: 5181, postgres: 25432, redis: 26379, tex: 25050, judge: 25051, ...input.ports },
  };
  if (typeof settings.domain !== 'string' || settings.domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(settings.domain)) throw new Error('域名必须是纯小写 DNS 主机名');
  if (!Number.isInteger(settings.instances) || settings.instances < 2 || settings.instances > 8) throw new Error('API instances 必须为 2—8');
  if (Object.keys(settings.ports).sort().join() !== 'api,judge,postgres,redis,tex') throw new Error('未知端口配置');
  const ports = Object.values(settings.ports);
  if (ports.some(p => !Number.isInteger(p) || p < 1024 || p > 65535 || [3100, 5180].includes(p)) || new Set(ports).size !== ports.length) throw new Error('端口必须互不相同且为 1024—65535，不能占用原开发 3100/5180');
  return settings;
}

const environment = object => Object.entries(object).map(([key, value]) => {
  if (/[\r\n"'`#$\\]/.test(String(value))) throw new Error(`配置 ${key} 含不支持的环境文件字符`);
  return `${key}=${value}\n`;
}).join('');

export function privateConfiguration(settings, input) {
  const key = input?.associationAppKey;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(key)) throw new Error('首次部署需要 secrets JSON 中的 associationAppKey');
  const email = input.adminEmail ?? `admin@${settings.domain}`;
  if (typeof email !== 'string' || email.length > 254 || !/^[A-Za-z0-9.!%+_-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) throw new Error('adminEmail 格式不正确');
  const secret = () => randomBytes(32).toString('hex');
  const postgres = secret(), redis = secret(), tex = secret(), judge = secret(), adminPassword = secret();
  const p = settings.ports;
  return {
    'infra.env': environment({ COMPOSE_PROJECT_NAME: 'problemforge-cloud', PF_PG_PORT: p.postgres, PF_REDIS_PORT: p.redis,
      PF_TEX_PORT: p.tex, PF_JUDGE_PORT: p.judge, POSTGRES_PASSWORD: postgres, REDIS_PASSWORD: redis, TEX_SANDBOX_TOKEN: tex, JUDGE_SANDBOX_TOKEN: judge }),
    'app.env': environment({ NODE_ENV: 'production', APP_NAME: 'ProblemForge', APP_ORIGIN: `https://${settings.domain}`,
      PF_DEPLOYMENT_ID: randomBytes(16).toString('hex'),
      API_HOST: '127.0.0.1', API_PORT: p.api, API_TRUSTED_PROXIES: '127.0.0.1/32',
      DATABASE_URL: `postgresql://problemforge:${postgres}@127.0.0.1:${p.postgres}/problemforge?connection_limit=5&pool_timeout=20`,
      REDIS_URL: `redis://:${redis}@127.0.0.1:${p.redis}/0`, STORAGE_ROOT: `${INSTALL_ROOT}/shared/storage`,
      TEX_SANDBOX_URL: `http://127.0.0.1:${p.tex}`, TEX_SANDBOX_TOKEN: tex, TEX_CONCURRENCY: 1,
      JUDGE_SANDBOX_URL: `http://127.0.0.1:${p.judge}`, JUDGE_SANDBOX_TOKEN: judge, JUDGE_CONCURRENCY: 1,
      TASK_LEASE_MS: 45000, TASK_MAX_ATTEMPTS: 3, BUILD_QUOTA: 6, JUDGE_QUOTA: 3, STORAGE_QUOTA_BYTES: 10000000000 }),
    'api.env': environment({ ASSOCIATION_APP_KEY: key }),
    'admin.env': environment({ PF_ADMIN_EMAIL: email, PF_ADMIN_PASSWORD: adminPassword }),
    'bootstrap-admin.txt': `管理员登录：https://${settings.domain}/login?mode=admin\n邮箱：${email}\n初始密码：${adminPassword}\n首次登录后可在账户设置改密。此文件只留在服务器，勿放入公开源码包。\n`,
  };
}

export function ecosystem(settings, release, node) {
  const shared = `${INSTALL_ROOT}/shared`;
  const common = {
    cwd: release, interpreter: node, node_args: ['--import', 'tsx', `--env-file=${shared}/app.env`],
    autorestart: true, watch: false, min_uptime: '10s', max_restarts: 10, restart_delay: 3000,
    kill_timeout: 30000, listen_timeout: 60000, merge_logs: true, time: true,
    env: { NODE_ENV: 'production' },
  };
  return { apps: [
    { ...common, name: APP_NAMES[0], script: 'scripts/pm2-api.mjs', exec_mode: 'cluster', instances: settings.instances,
      wait_ready: true, node_args: [...common.node_args, `--env-file=${shared}/api.env`], max_memory_restart: '768M',
      out_file: `${shared}/logs/api.out.log`, error_file: `${shared}/logs/api.err.log` },
    ...['tex', 'judge'].map((kind, i) => ({ ...common, name: APP_NAMES[i + 1], script: `workers/${kind}/src/index.ts`,
      exec_mode: 'fork', instances: 1, max_memory_restart: '1024M', out_file: `${shared}/logs/${kind}.out.log`, error_file: `${shared}/logs/${kind}.err.log` })),
  ] };
}

export function caddySite(settings) {
  return `${CADDY_BEGIN}\n${settings.domain} {\n\trequest_body {\n\t\tmax_size 40MiB\n\t}\n\treverse_proxy 127.0.0.1:${settings.ports.api} {\n\t\theader_up X-Forwarded-For {remote_host}\n\t\theader_up X-Forwarded-Host {host}\n\t\theader_up X-Forwarded-Proto {scheme}\n\t\ttransport http {\n\t\t\tresponse_header_timeout 300s\n\t\t}\n\t}\n}\n${CADDY_END}\n`;
}

export function mergeCaddyfile(current, settings) {
  const starts = current.split(CADDY_BEGIN).length - 1, ends = current.split(CADDY_END).length - 1;
  if (starts !== ends || starts > 1) throw new Error('Caddy 托管标记不完整，停止修改');
  if (starts === 1) {
    const from = current.indexOf(CADDY_BEGIN), to = current.indexOf(CADDY_END);
    if (to < from) throw new Error('Caddy 托管标记顺序错误');
    return current.slice(0, from) + caddySite(settings).trimEnd() + current.slice(to + CADDY_END.length);
  }
  if (current.includes(settings.domain)) throw new Error('Caddy 已有该域名的非托管配置，请先明确合并，脚本不会覆盖');
  return current + (current.endsWith('\n') ? '\n' : '\n\n') + caddySite(settings);
}

export function hasCaddyHost(value, domain) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.host) && value.host.includes(domain)) return true;
  return Object.values(value).some(v => typeof v === 'object' && hasCaddyHost(v, domain));
}

export function serviceUnit(node, pm2) {
  return `# ProblemForge managed service\n[Unit]\nDescription=ProblemForge PM2 processes\nWants=network-online.target\nAfter=network-online.target docker.service\nRequires=docker.service\n\n[Service]\nType=forking\nUser=${SERVICE_USER}\nGroup=${SERVICE_USER}\nUMask=0077\nEnvironment=PM2_HOME=${INSTALL_ROOT}/shared/pm2\nEnvironment=HOME=${INSTALL_ROOT}/shared/home\nEnvironment=PATH=${node.slice(0, node.lastIndexOf('/'))}:/usr/local/bin:/usr/bin:/bin\nPIDFile=${INSTALL_ROOT}/shared/pm2/pm2.pid\nExecStart=${node} ${pm2} resurrect\nExecStop=${node} ${pm2} kill\nRestart=on-failure\nTimeoutStartSec=120\nTimeoutStopSec=45\nLimitNOFILE=65536\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n`;
}

export function safeReleasePath(path) {
  return typeof path === 'string' && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every(part => part && part !== '..' && part !== '.') &&
    path.split('/')[0] !== 'storage' &&
    !path.split('/').some(part => ['.git', '.local', 'node_modules', 'dist', '.env'].includes(part));
}

export function checkPendingDeployment(pending, command, buildId) {
  if (!pending) return;
  if (command === 'status') return;
  if (command !== 'install' || pending.buildId !== buildId) throw new Error('上次部署尚未完成，只能检查 status 或重试同一部署包；不自动切换其他版本或重新备份部分迁移状态');
}

export function matchesCloudHealth(body, deploymentId) {
  return !!deploymentId && body?.status === 'ok' && body.appName === 'ProblemForge' && body.deploymentId === deploymentId;
}

export async function verifyRelease(source) {
  const root = await realpath(source);
  const manifest = JSON.parse(await readFile(resolve(root, 'cloud-release.json'), 'utf8'));
  if (manifest.format !== 1 || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(manifest.buildId) ||
      !/^[a-f0-9]{40}$/.test(manifest.gitCommit) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('无效部署包清单；请使用 pnpm package:cloud 生成');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!safeReleasePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.path)) throw new Error('部署包路径或哈希清单无效');
    seen.add(file.path);
    const path = resolve(root, file.path), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await realpath(path)).startsWith(root + sep) || digest(await readFile(path)) !== file.sha256) throw new Error(`部署包校验失败：${file.path}`);
  }
  for (const path of ['package.json', 'pnpm-lock.yaml', 'deploy.sh', 'scripts/cloud-deploy.mjs', 'infra/compose.pm2.yml', 'release.json']) {
    if (!seen.has(path)) throw new Error(`部署包缺少 ${path}`);
  }
  return manifest;
}
