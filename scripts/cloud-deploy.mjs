import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { access, chmod, chown, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { APP_NAMES, CADDY_BEGIN, INSTALL_ROOT as root, SERVICE_USER as user,
  cloudSettings, privateConfiguration, ecosystem, mergeCaddyfile, hasCaddyHost, serviceUnit, digest, verifyRelease, checkPendingDeployment, matchesCloudHealth,
  caddyAdminEndpoint, matchingCaddyInvocation, pendingReleasePath } from './cloud-config.mjs';
import { deployWorkflow } from './cloud-workflow.mjs';
import { runCloudCommand } from './cloud-process.mjs';
import { inspectCloudPorts, assertCloudPorts, repairCloudNetwork, assertHostPortUse, hostProbeCode } from './cloud-network.mjs';

let source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shared = `${root}/shared`, current = `${root}/current`, marker = `${root}/.problemforge-managed`;
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'install';
const recoveringNetwork = command === 'resume-network';
const flags = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (name === '--help') { flags.help = true; continue; }
  if (!['--secrets-file', '--settings-file'].includes(name) || !args[i + 1] || flags[name]) throw new Error('参数：install / resume-network / plan / check-caddy / status / backup / reload-api；--secrets-file JSON；--settings-file JSON');
  flags[name] = resolve(args[++i]);
}
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const cleanEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/root', LANG: 'C.UTF-8', CI: 'true' };
const say = message => console.log(`[ProblemForge] ${message}`);
const run = (bin, argv, options = {}) => runCloudCommand(bin, argv, {
  ...options, cwd: options.cwd ?? source, env: { ...cleanEnv, ...options.env },
});
let settings, bins, identity;
const appEnv = () => [`HOME=${shared}/home`, `PM2_HOME=${shared}/pm2`,
  `PATH=${dirname(bins.node)}:${dirname(bins.pnpmCommand)}:/usr/local/bin:/usr/bin:/bin`, 'LANG=C.UTF-8', 'CI=true'];
const asApp = (bin, argv, options = {}) => run('runuser', ['-u', user, '--', 'env', '-i', ...appEnv(),
  ...Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`), bin, ...argv], { ...options, cwd: options.cwd ?? root });
const pm2 = (argv, options) => asApp(bins.node, [bins.pm2, ...argv], options);
const appNode = (release, argv, options = {}) => asApp(bins.node, [`--env-file=${shared}/app.env`, '--import', 'tsx', ...argv], { ...options, cwd: release });
const compose = (release, buildId, argv, options = {}) => run(bins.docker, ['compose', '--project-name', 'problemforge-cloud',
  '--env-file', `${shared}/infra.env`, '-f', `${release}/infra/compose.pm2.yml`, ...argv], { ...options, env: { PF_RELEASE_ID: buildId } });
const setOwned = async (path, mode, appOwned = false) => { await chmod(path, mode); await chown(path, appOwned ? identity.uid : 0, identity.gid); };
const writeOwned = async (path, data, mode = 0o640, exclusive = false) => {
  if (await exists(path) && (await lstat(path)).isSymbolicLink()) throw new Error(`拒绝写入符号链接：${path}`);
  await writeFile(path, data, { mode, flag: exclusive ? 'wx' : 'w' }); await setOwned(path, mode);
};
const appPath = path => /^\/opt\/problemforge\/releases\/[a-z0-9][a-z0-9.-]{2,80}$/.test(path);
async function activeRelease() {
  if (!await exists(current)) return null;
  if (!(await lstat(current)).isSymbolicLink()) throw new Error('current 不是托管的版本链接');
  const path = await realpath(current);
  if (!appPath(path)) throw new Error('current 指向非托管目录');
  return { path, manifest: await json(`${path}/cloud-release.json`) };
}
async function processList() {
  // First use can print daemon startup messages; keep those out of JSON parsing.
  await pm2(['ping'], { capture: true });
  const rows = JSON.parse(await pm2(['jlist'], { capture: true }));
  if (rows.some(p => !APP_NAMES.includes(p.name))) throw new Error('本项目 PM2_HOME 含未知进程，拒绝操作');
  return rows;
}
async function processAction(action, names = APP_NAMES) {
  const rows = await processList();
  const present = names.filter(name => rows.some(p => p.name === name));
  if (present.length) await pm2([action, ...present]);
}
async function checkHostPortUse() {
  const ownPids = (await processList()).map(row => row.pid).filter(pid => Number.isInteger(pid) && pid > 0);
  const pidFile = `${shared}/pm2/pm2.pid`;
  if (await exists(pidFile)) {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0 && await exists(`/proc/${pid}/status`)) {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      if (Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) === identity.uid) ownPids.push(pid);
    }
  }
  const listeners = await run('ss', ['-H', '-lntp'], { capture: true, timeout: 10000 });
  await assertHostPortUse(argv => run(bins.docker, argv, { capture: true, timeout: 30000 }), listeners, settings.ports, ownPids);
  say(`端口归属已检查：${Object.values(settings.ports).join('、')} 为空闲或本项目占用。`);
}
async function health(url, attempts = 30) {
  const deploymentId = (await readFile(`${shared}/app.env`, 'utf8')).match(/^PF_DEPLOYMENT_ID=([a-f0-9]{32})$/m)?.[1];
  if (!deploymentId) throw new Error('私有配置缺少部署标识，不能确认域名是否指向当前实例');
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (response.ok && matchesCloudHealth(await response.json(), deploymentId)) return;
    } catch { /* A starting dependency or certificate may not be ready yet. */ }
    if (i + 1 < attempts) await delay(2000);
  }
  throw new Error(`健康检查未通过：${url}`);
}
async function status(checkHttps = true) {
  const rows = await processList();
  for (const [name, count] of [[APP_NAMES[0], settings.instances], [APP_NAMES[1], 1], [APP_NAMES[2], 1]]) {
    if (rows.filter(p => p.name === name && p.pm2_env.status === 'online').length !== count) throw new Error(`${name} 的在线进程数不符合配置`);
  }
  await health(`http://127.0.0.1:${settings.ports.api}/api/health`);
  say(`本机应用健康，API ${settings.instances} 个进程、TeX / Judge 各 1 个。`);
  if (checkHttps) { await health(`https://${settings.domain}/api/health`); say(`HTTPS 验证通过：https://${settings.domain}`); }
}
async function findBinary(name) {
  const path = await run('sh', ['-c', 'command -v "$1"', 'sh', name], { capture: true, timeout: 10000 });
  const resolved = await realpath(path);
  if (!/^\/[A-Za-z0-9_./+@-]+$/.test(resolved)) throw new Error(`${name} 安装路径含不支持的字符`);
  return { path, resolved };
}
async function adaptedCaddy(configArgument = settings.caddyFile) {
  return JSON.parse(await run(bins.caddy, ['adapt', '--adapter', 'caddyfile', '--config', configArgument],
    { cwd: dirname(settings.caddyFile), capture: true, timeout: 30000 }));
}
async function checkCaddyAdmin(adapted) {
  const endpoint = caddyAdminEndpoint(adapted);
  let response;
  try { response = await fetch(endpoint.url, { signal: AbortSignal.timeout(5000), redirect: 'error' }); }
  catch { throw new Error(`无法读取 Caddy 回环管理接口 ${endpoint.address}；请确认现有 Caddy 已启动且管理接口可用`); }
  if (!response.ok) throw new Error(`Caddy 管理接口返回 HTTP ${response.status}，停止修改配置`);
  const configArgument = await matchingCaddyInvocation(settings.caddyFile, adapted, await response.json(), adaptedCaddy);
  return { address: endpoint.address, configArgument };
}
async function reloadCaddy(checked, allowFailure = false) {
  return settings.caddyReload === 'systemd'
    ? run('systemctl', ['reload', 'caddy'], { timeout: 30000, allowFailure })
    : run(bins.caddy, ['reload', '--adapter', 'caddyfile', '--config', checked.configArgument, '--address', checked.address],
      { cwd: dirname(settings.caddyFile), timeout: 30000, allowFailure });
}
async function preflight() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() !== 0) throw new Error('请在 Ubuntu x86_64 云主机使用 sudo bash deploy.sh；本脚本不会在 Windows 开发环境执行部署');
  const os = await readFile('/etc/os-release', 'utf8');
  if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="?(22\.04|24\.04)"?$/m.test(os)) throw new Error('当前版本面向 Ubuntu 22.04 / 24.04');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major === 24 || major === 22 && minor >= 12)) throw new Error('需要 Node.js 22.12+ 或 24');
  bins = { node: await realpath(process.execPath) };
  if (!/^\/[A-Za-z0-9_./+@-]+$/.test(bins.node)) throw new Error('Node 安装路径含不支持的字符');
  for (const name of ['pnpm', 'pm2', 'docker', 'caddy']) {
    const binary = await findBinary(name); bins[name] = binary.resolved; bins[`${name}Command`] = binary.path;
  }
  if ((await run(bins.node, [bins.pnpm, '--version'], { capture: true })) !== '10.11.1') throw new Error('需要项目固定的 pnpm 10.11.1；脚本不会升级服务器其他项目的 pnpm');
  const docker = JSON.parse(await run(bins.docker, ['info', '--format', '{{json .}}'], { capture: true }));
  if (docker.OSType !== 'linux' || (docker.SecurityOptions ?? []).some(v => v.includes('rootless'))) throw new Error('需要 Linux rootful Docker，以运行独立沙箱');
  await run(bins.docker, ['compose', 'version'], { timeout: 10000 });
  if (settings.caddyReload === 'systemd') {
    await run('systemctl', ['is-active', '--quiet', 'caddy'], { timeout: 10000 });
    const service = await run('systemctl', ['show', 'caddy', '--property=ExecStart', '--value'], { capture: true, timeout: 10000 });
    const path = settings.caddyFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`${path}(?:\\s|;|$)`).test(service)) throw new Error(`现有 Caddy 服务未明确使用 ${settings.caddyFile}，请核对配置入口或使用 caddy 重载模式`);
  }
  const stat = await lstat(settings.caddyFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('caddyFile 必须指向已有的普通文件，不能为符号链接');
  await run(bins.caddy, ['validate', '--adapter', 'caddyfile', '--config', settings.caddyFile], { cwd: dirname(settings.caddyFile), timeout: 30000 });
  if (settings.caddyReload === 'caddy') await checkCaddyAdmin(await adaptedCaddy());
}
async function provision(settingsInput, secretsPath) {
  if (await exists(root) && (await lstat(root)).isSymbolicLink()) throw new Error('安装目录不能为符号链接');
  const managed = await exists(marker);
  if (!managed && await exists(root) && (await readdir(root)).length) throw new Error(`${root} 非空且不属于本安装器，拒绝覆盖`);
  if (!managed) {
    const containers = await run(bins.docker, ['ps', '-aq', '--filter', 'label=com.docker.compose.project=problemforge-cloud'], { capture: true });
    const volumes = await run(bins.docker, ['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=problemforge-cloud'], { capture: true });
    if (containers || volumes) throw new Error('已存在同名 Compose 资源，拒绝接管');
    const input = secretsPath ? await json(secretsPath) : null;
    settings = cloudSettings(settingsInput);
    const config = privateConfiguration(settings, input);
    for (const port of Object.values(settings.ports)) await new Promise((ok, fail) => {
      const probe = createServer();
      probe.once('error', () => fail(new Error(`回环端口 ${port} 已被占用，请在首次 settings JSON 中选择空闲端口`)));
      probe.listen(port, '127.0.0.1', () => probe.close(ok));
    });
    await mkdir(root, { recursive: true, mode: 0o750 });
    await writeFile(marker, 'ProblemForge Caddy PM2 deployment v1\n', { flag: 'wx', mode: 0o600 });
    // The marker permits a safe retry of an interrupted first install.
    await mkdir(shared, { mode: 0o750 });
    await writeFile(`${shared}/settings.json`, JSON.stringify(settings, null, 2), { mode: 0o600 });
    for (const [name, value] of Object.entries(config)) await writeFile(`${shared}/${name}`, value, { flag: 'wx', mode: 0o600 });
  } else {
    if ((await readFile(marker, 'utf8')).trim() !== 'ProblemForge Caddy PM2 deployment v1') throw new Error('安装目录标记不匹配');
    settings = cloudSettings(await json(`${shared}/settings.json`));
    if (settingsInput && JSON.stringify(settings) !== JSON.stringify(cloudSettings(settingsInput))) throw new Error('已有实例的域名/端口/进程配置不同，不在升级中隐式修改');
    for (const name of ['app.env', 'api.env', 'infra.env']) if (!await exists(`${shared}/${name}`)) throw new Error(`私有配置缺少 ${name}，先恢复配置，不自动更换数据库密码`);
  }
  const account = await run('getent', ['passwd', user], { capture: true, allowFailure: true });
  if (account.code) await run('useradd', ['--system', '--user-group', '--home-dir', `${shared}/home`, '--no-create-home', '--shell', '/usr/sbin/nologin', user]);
  else if (account.text.split(':')[5] !== `${shared}/home`) throw new Error('系统已有同名非托管用户，拒绝接管');
  identity = { uid: Number(await run('id', ['-u', user], { capture: true })), gid: Number(await run('id', ['-g', user], { capture: true })) };
  for (const path of [root, shared, `${root}/releases`, `${shared}/backups`]) {
    await mkdir(path, { recursive: true, mode: 0o750 });
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`托管目录不能为符号链接：${path}`);
    await setOwned(path, path.endsWith('/backups') ? 0o700 : 0o750);
  }
  for (const name of ['home', 'pm2', 'storage', 'logs']) {
    const path = `${shared}/${name}`;
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink()) throw new Error('运行目录不能为符号链接');
    await setOwned(path, 0o700, true);
  }
  for (const name of ['settings.json', 'app.env', 'api.env', 'admin.env']) if (await exists(`${shared}/${name}`)) await setOwned(`${shared}/${name}`, 0o640);
  // Check the actual service user, including nvm installations hidden under /root.
  await asApp(bins.node, ['--version']);
  for (const bin of [bins.pnpm, bins.pm2]) await run('runuser', ['-u', user, '--', 'test', '-r', bin]);
  await writeOwned(`${shared}/binaries.json`, JSON.stringify(bins, null, 2));
}
async function prepare(manifest) {
  const release = `${root}/releases/${manifest.buildId}`;
  if (!appPath(release)) throw new Error('无效版本目录');
  if (await exists(`${release}/.prepared`)) {
    if (digest(await readFile(`${release}/cloud-release.json`)) !== digest(await readFile(`${source}/cloud-release.json`))) throw new Error('已存在同名不同内容的版本');
    await verifyRelease(release);
    return release;
  }
  if (await exists(release) && (await lstat(release)).isSymbolicLink()) throw new Error('版本目录不能为符号链接');
  await mkdir(release, { recursive: true, mode: 0o750 });
  for (const file of [...manifest.files, { path: 'cloud-release.json' }]) {
    const destination = resolve(release, file.path);
    await mkdir(dirname(destination), { recursive: true }); await copyFile(resolve(source, file.path), destination);
  }
  await run('chown', ['-R', `${user}:${user}`, release]);
  say('安装锁定依赖、生成数据库客户端并构建前端。');
  await asApp(bins.node, [bins.pnpm, 'install', '--frozen-lockfile', '--registry=https://registry.npmjs.org'], { cwd: release });
  await asApp(bins.node, ['--import', 'tsx', 'scripts/database.ts', 'generate'], { cwd: release,
    env: { DATABASE_URL: 'postgresql://build:build@127.0.0.1/build' } });
  await asApp(bins.node, [bins.pnpm, 'build:web'], { cwd: release });
  await run('chown', ['-R', `root:${user}`, release]);
  await run('chmod', ['-R', 'g-w,o-rwx', release]);
  await writeOwned(`${release}/.prepared`, 'ready\n');
  return release;
}
async function quiesce(previous) {
  await appNode(previous.path, ['scripts/cloud-database.ts', 'idle']);
  await processAction('stop', [APP_NAMES[0]]);
  try {
    // Catch jobs submitted between the first check and closing the API listeners.
    await appNode(previous.path, ['scripts/cloud-database.ts', 'idle']);
    await processAction('stop', APP_NAMES.slice(1));
    await appNode(previous.path, ['scripts/cloud-database.ts', 'idle']);
  } catch (error) { await processAction('restart'); throw error; }
}
async function backup(previous) {
  const out = `${shared}/backups/${new Date().toISOString().replace(/[^0-9]/g, '')}`;
  await mkdir(out, { mode: 0o700 });
  await appNode(previous.path, ['scripts/ops-state.ts', '--quiescent'], { output: `${out}/state.json` });
  await compose(previous.path, previous.manifest.buildId, ['exec', '-T', 'postgres', 'pg_dump', '-U', 'problemforge', '-d', 'problemforge', '--format=custom', '--no-owner'], { output: `${out}/database.dump` });
  await run('tar', ['-cpf', `${out}/storage.tar`, '-C', `${shared}/storage`, '.']); await chmod(`${out}/storage.tar`, 0o600);
  const files = {};
  for (const name of ['state.json', 'database.dump', 'storage.tar']) {
    const hash = createHash('sha256'); for await (const chunk of createReadStream(`${out}/${name}`)) hash.update(chunk);
    files[name] = hash.digest('hex');
  }
  await writeFile(`${out}/manifest.json`, JSON.stringify({ format: 1, kind: 'problemforge-pm2', buildId: previous.manifest.buildId, files }, null, 2), { mode: 0o600 });
  say(`一致备份已保存：${out}`); return out;
}
async function installStartup() {
  for (const [path, content] of [
    ['/etc/systemd/system/problemforge-pm2.service', serviceUnit(bins.node, bins.pm2)],
    ['/etc/logrotate.d/problemforge', `# ProblemForge managed logs\n${shared}/logs/*.log {\n  daily\n  maxsize 20M\n  rotate 7\n  compress\n  missingok\n  notifempty\n  copytruncate\n  su ${user} ${user}\n}\n`],
  ]) {
    if (await exists(path) && !(await readFile(path, 'utf8')).startsWith('# ProblemForge managed')) throw new Error(`已有非托管文件：${path}`);
    await writeOwned(path, content, 0o644);
  }
  await pm2(['save']);
  await run('systemctl', ['daemon-reload']);
  // PM2 is already running. Enable resurrection for the next boot without killing it.
  await run('systemctl', ['enable', 'problemforge-pm2.service']);
}
async function activateCaddy() {
  const original = await readFile(settings.caddyFile, 'utf8');
  const adapted = await adaptedCaddy();
  const checked = settings.caddyReload === 'caddy' ? await checkCaddyAdmin(adapted) : undefined;
  if (!original.includes(CADDY_BEGIN) && hasCaddyHost(adapted, settings.domain)) throw new Error('Caddy 导入配置已包含目标域名，不自动接管');
  const candidate = `${dirname(settings.caddyFile)}/.problemforge-candidate-${process.pid}`;
  const saved = `${shared}/backups/Caddyfile-${Date.now()}`;
  const stat = await lstat(settings.caddyFile);
  try {
    await writeFile(candidate, mergeCaddyfile(original, settings), { flag: 'wx', mode: stat.mode & 0o777 });
    await chown(candidate, stat.uid, stat.gid);
    await run(bins.caddy, ['validate', '--adapter', 'caddyfile', '--config', candidate], { cwd: dirname(settings.caddyFile), timeout: 30000 });
    if (await readFile(settings.caddyFile, 'utf8') !== original) throw new Error('Caddyfile 在部署期间被修改，停止覆盖');
    await writeFile(saved, original, { flag: 'wx', mode: 0o600 });
    await rename(candidate, settings.caddyFile);
    try { await reloadCaddy(checked); }
    catch (error) { await writeFile(settings.caddyFile, original); await reloadCaddy(checked, true); throw error; }
  } finally { await rm(candidate, { force: true }); }
}

async function main() {
  if (flags.help) { console.log('sudo bash deploy.sh [install|status|backup|reload-api]\n首次：--secrets-file /私有路径/problemforge.secrets.json\n可选首次配置：--settings-file settings.json\n只读预览：bash deploy.sh plan\n只读 Caddy 检查：node scripts/cloud-deploy.mjs check-caddy --settings-file settings.json\n旧包网络恢复并继续同一版本：node scripts/cloud-deploy.mjs resume-network\n详见 docs/CADDY_PM2.md'); return; }
  if (!['install', 'resume-network', 'plan', 'check-caddy', 'status', 'backup', 'reload-api'].includes(command)) throw new Error('未知部署命令');
  const settingsInput = flags['--settings-file'] ? await json(flags['--settings-file']) : undefined;
  if (command === 'plan') {
    const proposed = cloudSettings(settingsInput);
    console.log(JSON.stringify({ installRoot: root, domain: proposed.domain, apiInstances: proposed.instances, loopbackPorts: proposed.ports,
      caddyFile: proposed.caddyFile, caddyReload: proposed.caddyReload,
      prerequisites: ['Ubuntu 22.04/24.04 x86_64', 'Node 22.12+ or 24', 'pnpm 10.11.1', 'PM2', 'rootful Docker + Compose v2', 'running Caddy with the selected configuration'],
      actions: ['create project service user and private configuration', 'build immutable release and isolated sandbox images',
        'on upgrade: require idle tasks, stop only this app, backup database and private files', 'migrate database and preserve/init administrator',
        'start PM2 API cluster and one worker per kind', 'require full local health before merging Caddy site', 'enable startup and verify HTTPS'],
      executesDeployment: false }, null, 2)); return;
  }
  settings = cloudSettings(await exists(marker) ? await json(`${shared}/settings.json`) : settingsInput);
  if (command === 'check-caddy') {
    if (process.platform !== 'linux') throw new Error('请在 Linux 云服务器执行此只读检查');
    bins = { caddy: (await findBinary('caddy')).resolved };
    const checked = await checkCaddyAdmin(await adaptedCaddy());
    say(`Caddyfile 与运行配置匹配（--config ${checked.configArgument}）；仅检查，未写入或重载。`);
    return;
  }
  await preflight();
  if (recoveringNetwork) {
    source = pendingReleasePath(await json(`${shared}/pending-deploy.json`));
    if (await realpath(source) !== source || !await exists(`${source}/.prepared`)) throw new Error('待完成版本不是已准备的原始部署目录');
  }
  const manifest = command === 'install' || recoveringNetwork ? await verifyRelease(source) : null;
  if (command !== 'install' && !await exists(marker)) throw new Error('尚未部署');
  await provision(settingsInput, flags['--secrets-file']);
  const lock = `${root}/.deploy.lock`;
  let handle;
  try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(`${process.pid}\n`); }
  catch { throw new Error('已有部署/维护操作或遗留锁；先检查锁中 PID，脚本不自动抢锁'); }
  let previous;
  try {
    previous = await activeRelease();
    const pendingFile = `${shared}/pending-deploy.json`;
    const pending = await exists(pendingFile) ? await json(pendingFile) : null;
    if (recoveringNetwork && pendingReleasePath(pending) !== source) throw new Error('待完成版本已变化；停止网络恢复');
    checkPendingDeployment(pending, recoveringNetwork ? 'install' : command, manifest?.buildId);
    if (command === 'status') { await status(); return; }
    if (!previous && command !== 'install' && !recoveringNetwork) throw new Error('没有已安装的应用版本');
    if (command === 'reload-api') { await pm2(['reload', APP_NAMES[0]]); await pm2(['save']); await status(); return; }
    if (command === 'backup') {
      await quiesce(previous);
      try { await backup(previous); } finally { await processAction('restart'); }
      await status(false); return;
    }
    await checkHostPortUse();
    let release, backupPath = pending?.backupPath ?? null;
    await deployWorkflow({
      prepare: async () => { release = await prepare(manifest); },
      buildSandboxes: async () => {
        if (recoveringNetwork) {
          const rows = await inspectCloudPorts(argv => run(bins.docker, argv, { capture: true, timeout: 10000 }), settings.ports, manifest.buildId);
          for (const kind of ['tex', 'judge']) {
            const image = await run(bins.docker, ['image', 'inspect', `problemforge-${kind}:${manifest.buildId}`, '--format', '{{.Id}}'], { capture: true, timeout: 10000 });
            if (rows.find(row => row.name === `${kind}-sandbox`).actual.imageId !== image) throw new Error(`${kind} 镜像标签已变化；停止同版本恢复`);
          }
          say(`继续待完成版本 ${manifest.buildId}；复用已构建的 TeX / Judge 镜像。`);
          return;
        }
        say('构建独立 TeX / Judge 沙箱镜像（独立下载缓存；最长 30 分钟，可按 Ctrl+C 取消）。');
        await compose(release, manifest.buildId, ['--progress', 'plain', 'build', 'tex-sandbox', 'judge-sandbox'], { processGroup: true });
      },
      quiesce: () => quiesce(previous), backup: async () => { backupPath = await backup(previous); },
      startInfrastructure: async () => {
        await checkHostPortUse();
        if (pending) await processAction('stop');
        if (!recoveringNetwork) await compose(release, manifest.buildId, ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180']);
      },
      checkInfrastructure: async () => {
        const docker = argv => run(bins.docker, argv, { capture: true, timeout: 30000 });
        if (recoveringNetwork) await repairCloudNetwork(docker, settings.ports, manifest.buildId);
        else assertCloudPorts(await inspectCloudPorts(docker, settings.ports, manifest.buildId));
        await asApp(bins.node, ['--eval', hostProbeCode, JSON.stringify(settings.ports)], { cwd: release, timeout: 40000 });
      },
      migrate: async () => {
        await writeOwned(pendingFile, JSON.stringify({ buildId: manifest.buildId, previousBuildId: pending?.previousBuildId ?? previous?.manifest.buildId ?? null, backupPath }, null, 2), 0o600);
        await appNode(release, ['scripts/database.ts', 'migrate']);
      },
      bootstrap: async () => {
        const adminEnv = await exists(`${shared}/admin.env`) ? [`--env-file=${shared}/admin.env`] : [];
        await appNode(release, [...adminEnv, 'scripts/cloud-database.ts', 'bootstrap']); await rm(`${shared}/admin.env`, { force: true });
        if (!previous) await appNode(release, ['scripts/init-demo.ts']);
      },
      startApplication: async () => {
        await processAction('delete');
        await writeOwned(`${shared}/ecosystem.config.cjs`, `module.exports = ${JSON.stringify(ecosystem(settings, release, bins.node), null, 2)};\n`);
        await pm2(['start', `${shared}/ecosystem.config.cjs`]);
      },
      checkLocal: () => status(false),
      activateVersion: async () => {
        const next = `${root}/.current-next`;
        if (await exists(next)) throw new Error('发现遗留版本切换链接，请先检查');
        await symlink(release, next); await rename(next, current);
      },
      installStartup, activateProxy: activateCaddy, checkHttps: () => status(),
      recordSuccess: async () => {
        await writeOwned(`${shared}/last-deploy.json`, JSON.stringify({ buildId: manifest.buildId, gitCommit: manifest.gitCommit, deployedAt: new Date().toISOString(), httpsVerified: true }, null, 2));
        await rm(pendingFile);
      },
      resumePrevious: () => processAction('restart'), stopApplication: () => processAction('stop'),
      reportFailure: async ({ migrationStarted, applicationHealthy }) => {
        if (migrationStarted) say(applicationHealthy
          ? '应用本机健康，但部署后续步骤未通过；请检查 Caddy / HTTPS，修复后重试同一部署包完成收尾。'
          : '数据库迁移阶段已开始，应用已停下；不自动降级数据库或重启旧版本。保留配置、备份和日志，修复原因后重试同一部署包。');
      },
    }, !!previous && !pending);
    say(`部署完成。管理员凭据：${shared}/bootstrap-admin.txt；普通用户使用协会账号登录。`);
  } finally { await handle.close(); await rm(lock); }
}
main().catch(error => { console.error(`[ProblemForge] ${error.message}`); process.exitCode = 1; });
