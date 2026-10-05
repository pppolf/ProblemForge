// Build-time check only: native PM2 cluster/loader/reload and Caddy validation.
// The fixture never opens an HTTP port or touches an application database.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { caddySite, cloudSettings, ecosystem } from './cloud-config.mjs';
if (process.platform !== 'linux' || !process.argv.includes('--build-check')) throw new Error('仅在显式 Linux 构建检查中运行');
const scratch = await mkdtemp(join(tmpdir(), 'problemforge-pm2-check-'));
const env = { ...process.env, PM2_HOME: join(scratch, 'pm2') };
const run = (bin, args) => {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const settings = cloudSettings(), caddy = join(scratch, 'Caddyfile');
await writeFile(caddy, caddySite(settings));
const adapted = JSON.parse(run('caddy', ['adapt', '--adapter', 'caddyfile', '--config', caddy]));
assert.ok(JSON.stringify(adapted).includes(`127.0.0.1:${settings.ports.api}`));
run('caddy', ['validate', '--adapter', 'caddyfile', '--config', caddy]);
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
app.node_args = ['--import', 'tsx', `--env-file=${join(scratch, 'app.env')}`, `--env-file=${join(scratch, 'api.env')}`];
app.out_file = join(scratch, 'out.log'); app.error_file = join(scratch, 'error.log');
for (const worker of applications.slice(1)) {
  worker.script = fixture;
  worker.node_args = ['--import', 'tsx', `--env-file=${join(scratch, 'app.env')}`];
  worker.out_file = join(scratch, `${worker.name}.out.log`); worker.error_file = join(scratch, `${worker.name}.err.log`);
}
const config = join(scratch, 'ecosystem.config.cjs');
await writeFile(config, `module.exports=${JSON.stringify({ apps: applications })};\n`);
try {
  run('pm2', ['ping']);
  assert.deepEqual(JSON.parse(run('pm2', ['jlist'])), []);
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
  const report = { passed: true, caddyValidated: true, freshPm2ListParsed: true, pm2ClusterInstances: 2, pm2ForkWorkers: 2, workerAppKeyExcluded: true,
    envFilesLoaded: true, typescriptEsmLoaded: true,
    reloadReplacedBothProcesses: true, oldProcessesStoppedGracefully: true, httpListenerStarted: false, applicationDatabaseAccessed: false };
  await writeFile('/tmp/problemforge-cloud-runtime-check.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { run('pm2', ['kill']); }
