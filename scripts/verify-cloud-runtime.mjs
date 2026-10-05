// Build-time check only: native PM2 cluster/loader/reload and Caddy validation.
// The fixture never opens an HTTP port or touches an application database.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { caddySite, cloudSettings, ecosystem, mergeCaddyfile, hasCaddyHost } from './cloud-config.mjs';
if (process.platform !== 'linux' || !process.argv.includes('--build-check')) throw new Error('仅在显式 Linux 构建检查中运行');
const scratch = await mkdtemp(join(tmpdir(), 'problemforge-pm2-check-'));
const managerCwd = join(scratch, 'daemon-without-node-modules');
await mkdir(managerCwd);
const env = { ...process.env, PM2_HOME: join(scratch, 'pm2') };
const run = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { env, cwd: managerCwd, encoding: 'utf8', timeout: 90000, ...options });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const settings = cloudSettings(), caddy = join(scratch, 'Caddyfile');
await writeFile(caddy, caddySite(settings));
const adapted = JSON.parse(run('caddy', ['adapt', '--adapter', 'caddyfile', '--config', caddy]));
assert.ok(JSON.stringify(adapted).includes(`127.0.0.1:${settings.ports.api}`));
run('caddy', ['validate', '--adapter', 'caddyfile', '--config', caddy]);
const customDir = join(scratch, '.hydro');
await mkdir(join(customDir, 'sites'), { recursive: true });
await writeFile(join(customDir, 'sites/hydro.caddy'), 'hydro.example.invalid {\n reverse_proxy 127.0.0.1:8888\n}\n');
const original = 'import sites/hydro.caddy\n';
const custom = cloudSettings({ caddyFile: join(customDir, 'Caddyfile'), caddyReload: 'caddy' });
const merged = mergeCaddyfile(original, custom);
assert.ok(merged.startsWith(original));
await writeFile(custom.caddyFile, merged);
const customAdapted = JSON.parse(run('caddy', ['adapt', '--adapter', 'caddyfile', '--config', custom.caddyFile], { cwd: customDir }));
assert.ok(hasCaddyHost(customAdapted, 'hydro.example.invalid') && hasCaddyHost(customAdapted, custom.domain));
run('caddy', ['validate', '--adapter', 'caddyfile', '--config', custom.caddyFile], { cwd: customDir });
await writeFile(join(scratch, 'app.env'), 'PF_SMOKE_ENV=loaded\n');
await writeFile(join(scratch, 'api.env'), 'ASSOCIATION_APP_KEY=smoke-test-only\n');
// Keep the fixture under /app so package resolution uses the real tsx installation.
const fixture = join(process.cwd(), '.pm2-smoke.ts');
await writeFile(fixture, `import { writeFileSync } from 'node:fs';\nconst value: string = process.env.PF_SMOKE_ENV ?? '';\nconst record = {pid:process.pid,instance:process.env.NODE_APP_INSTANCE,value,keyLoaded:!!process.env.ASSOCIATION_APP_KEY};\nwriteFileSync(${JSON.stringify(scratch)}+'/'+process.pid+'.json',JSON.stringify(record));\nprocess.send?.('ready');\nconst timer=setInterval(()=>{},1000);\nprocess.on('SIGINT',()=>{clearInterval(timer);writeFileSync(${JSON.stringify(scratch)}+'/'+process.pid+'.stopped','graceful');process.exit(0);});\n`);
const entry = join(process.cwd(), '.pm2-smoke.mjs');
await writeFile(entry, "await import('./.pm2-smoke.ts');\n");
const applications = ecosystem(settings, process.cwd(), process.execPath).apps;
const app = applications[0];
app.script = entry;
app.node_args = [...app.node_args.slice(0, 2), `--env-file=${join(scratch, 'app.env')}`, `--env-file=${join(scratch, 'api.env')}`];
app.out_file = join(scratch, 'out.log'); app.error_file = join(scratch, 'error.log');
for (const worker of applications.slice(1)) {
  worker.script = fixture;
  worker.node_args = [...worker.node_args.slice(0, 2), `--env-file=${join(scratch, 'app.env')}`];
  worker.out_file = join(scratch, `${worker.name}.out.log`); worker.error_file = join(scratch, `${worker.name}.err.log`);
}
const config = join(scratch, 'ecosystem.config.cjs');
await writeFile(config, `module.exports=${JSON.stringify({ apps: applications })};\n`);
const otherEnv = { ...env, PM2_HOME: join(scratch, 'unrelated-pm2-fixture') };
const other = args => run('pm2', args, { env: otherEnv });
const otherScript = join(scratch, 'unrelated.mjs');
await writeFile(otherScript, 'setInterval(() => {}, 1000);\n');
try {
  other(['ping']);
  other(['start', otherScript, '--name', 'unrelated-service-fixture']);
  const unrelatedBefore = JSON.parse(other(['jlist'])).map(p => ({ name: p.name, pid: p.pid, restarts: p.pm2_env.restart_time }));
  run('pm2', ['ping']);
  assert.deepEqual(JSON.parse(run('pm2', ['jlist'])), []);
  // Reproduce the reported failure using real PM2 from a cwd with no tsx.
  const broken = { ...app, name: 'problemforge-loader-negative-check', instances: 1,
    node_args: ['--import', 'tsx', ...app.node_args.slice(2)], autorestart: false, listen_timeout: 1000,
    error_file: join(scratch, 'bare-loader.err.log'), out_file: join(scratch, 'bare-loader.out.log') };
  const brokenConfig = join(scratch, 'broken.config.cjs');
  await writeFile(brokenConfig, `module.exports=${JSON.stringify({ apps: [broken] })};\n`);
  run('pm2', ['start', brokenConfig]);
  let failure = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    failure = await readFile(join(env.PM2_HOME, 'pm2.log'), 'utf8');
    if (failure.includes("Cannot find package 'tsx' imported from " + managerCwd)) break;
    await delay(50);
  }
  assert.ok(failure.includes("Cannot find package 'tsx' imported from " + managerCwd), failure);
  run('pm2', ['delete', broken.name]);
  run('pm2', ['start', config]);
  const initial = JSON.parse(run('pm2', ['jlist']));
  assert.equal(initial.length, 4); assert.ok(initial.every(p => p.pm2_env.status === 'online'));
  const before = initial.filter(p => p.name === app.name).map(p => p.pid);
  assert.equal(before.length, 2);
  const workerPids = initial.filter(p => p.name !== app.name).map(p => p.pid);
  for (const process of initial) {
    let record;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { record = JSON.parse(await readFile(join(scratch, `${process.pid}.json`), 'utf8')); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
    }
    assert.ok(record, `${process.name} did not load its TypeScript entry`);
    assert.equal(record.value, 'loaded'); assert.equal(record.keyLoaded, process.name === app.name);
  }
  run('pm2', ['reload', app.name]);
  const after = JSON.parse(run('pm2', ['jlist']));
  assert.equal(after.length, 4); assert.ok(after.every(p => p.pm2_env.status === 'online' && !before.includes(p.pid)));
  assert.deepEqual(after.filter(p => p.name !== app.name).map(p => p.pid), workerPids);
  for (const pid of before) assert.equal(await readFile(join(scratch, `${pid}.stopped`), 'utf8'), 'graceful');
  assert.deepEqual(JSON.parse(other(['jlist'])).map(p => ({ name: p.name, pid: p.pid, restarts: p.pm2_env.restart_time })), unrelatedBefore);
  const report = { passed: true, caddyValidated: true, customCaddyPathValidated: true, existingCaddyImportPreserved: true,
    daemonCwdDiffersFromRelease: true, bareTsxFailureReproduced: true, absoluteReleaseLoaderPassed: true, unrelatedPm2PidAndRestartCountUnchanged: true,
    freshPm2ListParsed: true, pm2ClusterInstances: 2, pm2ForkWorkers: 2, workerAppKeyExcluded: true,
    envFilesLoaded: true, typescriptEsmLoaded: true,
    reloadReplacedBothProcesses: true, oldProcessesStoppedGracefully: true, httpListenerStarted: false, applicationDatabaseAccessed: false };
  await writeFile('/tmp/problemforge-cloud-runtime-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { run('pm2', ['kill']); } finally { other(['kill']); }
}
