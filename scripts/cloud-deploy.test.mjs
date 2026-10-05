import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { cloudSettings, privateConfiguration, ecosystem, mergeCaddyfile, hasCaddyHost, safeReleasePath, CADDY_BEGIN, checkPendingDeployment, matchesCloudHealth, digest, verifyRelease, caddyAdminEndpoint, assertCaddyMatches } from './cloud-config.mjs';
import { deployWorkflow } from './cloud-workflow.mjs';

test('configuration rejects injected domain, overlapping/dev ports and excessive processes', () => {
  for (const domain of ['https://example.org', 'example.org\n:80', 'example.org/path', '*.example.org']) assert.throws(() => cloudSettings({ domain }));
  for (const ports of [{ api: 5180 }, { api: 3100 }, { api: 25432 }, { judge: 65536 }, { unknown: 22000 }]) assert.throws(() => cloudSettings({ ports }));
  for (const instances of [0, 1, 9, 'max']) assert.throws(() => cloudSettings({ instances }));
  for (const input of [null, [], { format: 2 }, { ports: [] }, { unknown: true }]) assert.throws(() => cloudSettings(input));
  assert.equal(cloudSettings().instances, 2);
});

test('Hydro Caddy path and CLI reload are explicit while existing systemd settings retain defaults', () => {
  const settings = cloudSettings({ caddyFile: '/root/.hydro/Caddyfile', caddyReload: 'caddy' });
  assert.equal(settings.caddyFile, '/root/.hydro/Caddyfile');
  assert.equal(settings.caddyReload, 'caddy');
  assert.equal(cloudSettings().caddyFile, '/etc/caddy/Caddyfile');
  assert.equal(cloudSettings().caddyReload, 'systemd');
  for (const caddyFile of ['relative/Caddyfile', '/root/../etc/Caddyfile', '/root/.hydro/./Caddyfile', '/root/x\nstop', '/root/x;stop']) assert.throws(() => cloudSettings({ caddyFile }));
  assert.throws(() => cloudSettings({ caddyReload: 'pm2 restart all' }));
});

test('Caddy CLI reload only contacts a local enabled admin and verifies the current configuration', () => {
  assert.deepEqual(caddyAdminEndpoint({}), { address: 'localhost:2019', url: 'http://localhost:2019/config/' });
  assert.equal(caddyAdminEndpoint({ admin: { listen: '127.0.0.1:2020' } }).address, '127.0.0.1:2020');
  assert.equal(caddyAdminEndpoint({ admin: { listen: '[::1]:2019' } }).url, 'http://[::1]:2019/config/');
  for (const admin of [{ disabled: true }, { listen: 'example.org:2019' }, { listen: 'localhost:0' }, { listen: '127.0.0.1:65536' }]) assert.throws(() => caddyAdminEndpoint({ admin }));
  const saved = { apps: { http: { routes: [{ host: ['hydro.example.org'], handler: 'reverse_proxy' }] } }, admin: { listen: 'localhost:2019' } };
  const live = { admin: { listen: 'localhost:2019' }, apps: { http: { routes: [{ handler: 'reverse_proxy', host: ['hydro.example.org'] }] } } };
  assert.doesNotThrow(() => assertCaddyMatches(saved, live));
  assert.throws(() => assertCaddyMatches(saved, { apps: { http: {} } }), /配置不一致/);
});
test('fresh installations generate independent secrets and do not put APPKEY or admin credentials in workers/PM2', () => {
  const settings = cloudSettings(), input = { associationAppKey: 'test-only-not-a-real-key' };
  const first = privateConfiguration(settings, input), second = privateConfiguration(settings, input);
  assert.notEqual(first['infra.env'], second['infra.env']);
  assert.ok(!first['app.env'].includes(input.associationAppKey));
  assert.ok(!first['infra.env'].includes(input.associationAppKey));
  assert.match(first['app.env'], /API_HOST=127.0.0.1\n/);
  assert.match(first['app.env'], /API_TRUSTED_PROXIES=127.0.0.1\/32\n/);
  const pm = ecosystem(settings, '/opt/problemforge/releases/release-1', '/usr/bin/node');
  assert.equal(pm.apps[0].exec_mode, 'cluster'); assert.equal(pm.apps[0].instances, 2);
  assert.equal(pm.apps[0].wait_ready, true);
  for (const worker of pm.apps.slice(1)) {
    assert.equal(worker.exec_mode, 'fork'); assert.equal(worker.instances, 1);
    assert.ok(!worker.node_args.some(arg => arg.includes('api.env') || arg.includes('admin.env')));
  }
  assert.ok(!JSON.stringify(pm).includes(input.associationAppKey));
  assert.throws(() => privateConfiguration(settings, { associationAppKey: 'x\nNODE_OPTIONS=attack' }));
});
test('Caddy changes preserve unrelated sites and repeat without duplicate blocks', () => {
  const original = '{\n email owner@example.org\n}\n\nother.example.org {\n reverse_proxy 127.0.0.1:9999\n}\n';
  const settings = cloudSettings();
  const first = mergeCaddyfile(original, settings), second = mergeCaddyfile(first, settings);
  assert.equal(first, second); assert.ok(first.startsWith(original));
  assert.equal(first.split(CADDY_BEGIN).length, 2);
  assert.throws(() => mergeCaddyfile('problems.cwnupaa.com { reverse_proxy localhost:1234 }', settings));
  assert.throws(() => mergeCaddyfile(CADDY_BEGIN, settings));
  assert.equal(hasCaddyHost({ apps: { http: { routes: [{ match: [{ host: ['problems.cwnupaa.com'] }] }] } } }, settings.domain), true);
});
test('release members reject private data, path traversal and package installation outputs', () => {
  for (const path of ['../escape', '/etc/passwd', 'dir/../../escape', '.env', '.local/secret', 'apps/api/node_modules/x', 'apps/web/dist/x', 'storage/a', 'x\\y']) assert.equal(safeReleasePath(path), false, path);
  for (const path of ['.env.example', 'packages/storage/src/index.ts', 'scripts/cloud-deploy.mjs', 'templates/builtin/题面.tex']) assert.equal(safeReleasePath(path), true, path);
});

test('release verification detects modified source and duplicate manifest entries', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'problemforge-package-check-'));
  try {
    const paths = ['package.json', 'pnpm-lock.yaml', 'deploy.sh', 'scripts/cloud-deploy.mjs', 'infra/compose.pm2.yml', 'release.json'];
    const files = [];
    for (const path of paths) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), path);
      files.push({ path, sha256: digest(path) });
    }
    const manifest = { format: 1, buildId: 'test-release', gitCommit: 'a'.repeat(40), files };
    await writeFile(join(folder, 'cloud-release.json'), JSON.stringify(manifest));
    assert.equal((await verifyRelease(folder)).buildId, manifest.buildId);
    await writeFile(join(folder, 'deploy.sh'), 'modified');
    await assert.rejects(verifyRelease(folder), /部署包校验失败/);
    await writeFile(join(folder, 'deploy.sh'), 'deploy.sh');
    await writeFile(join(folder, 'cloud-release.json'), JSON.stringify({ ...manifest, files: [...files, files[0]] }));
    await assert.rejects(verifyRelease(folder), /清单无效/);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('problemforge-package-check-'));
    await rm(folder, { recursive: true, force: true });
  }
});
test('persisted unfinished migration only permits retry of the same release or status inspection', () => {
  const pending = { buildId: 'release-1', backupPath: '/opt/problemforge/shared/backups/before-upgrade' };
  assert.doesNotThrow(() => checkPendingDeployment(pending, 'install', 'release-1'));
  assert.doesNotThrow(() => checkPendingDeployment(pending, 'status'));
  for (const command of ['install', 'backup', 'reload-api']) assert.throws(() => checkPendingDeployment(pending, command, 'release-2'));
});
test('HTTPS health must belong to this deployment rather than another healthy site', () => {
  const expected = 'this-deployment';
  assert.equal(matchesCloudHealth({ status: 'ok', appName: 'ProblemForge', deploymentId: expected }, expected), true);
  for (const body of [{ status: 'ok' }, { status: 'ok', appName: 'ProblemForge', deploymentId: 'old-deployment' }, { status: 'degraded', appName: 'ProblemForge', deploymentId: expected }]) assert.equal(matchesCloudHealth(body, expected), false);
});

const operations = ['prepare', 'buildSandboxes', 'quiesce', 'backup', 'startInfrastructure', 'migrate', 'bootstrap', 'startApplication', 'checkLocal', 'activateVersion', 'installStartup', 'activateProxy', 'checkHttps', 'recordSuccess', 'resumePrevious', 'stopApplication', 'reportFailure'];
async function scenario(failure, upgrading = true) {
  const events = [];
  const ops = Object.fromEntries(operations.map(name => [name, async () => { events.push(name); if (name === failure) throw new Error(name); }]));
  if (failure) await assert.rejects(deployWorkflow(ops, upgrading), new RegExp(failure));
  else await deployWorkflow(ops, upgrading);
  return events;
}
test('deployment only activates public proxy and records success after health checks', async () => {
  const events = await scenario();
  assert.ok(events.indexOf('backup') < events.indexOf('migrate'));
  assert.ok(events.indexOf('checkLocal') < events.indexOf('activateProxy'));
  assert.ok(events.indexOf('checkHttps') < events.indexOf('recordSuccess'));
  const fresh = await scenario(undefined, false);
  assert.ok(!fresh.includes('backup') && !fresh.includes('quiesce'));
});
test('a build failure leaves old processes running, a backup failure resumes them without migrating', async () => {
  const build = await scenario('buildSandboxes'); assert.ok(!build.includes('quiesce') && !build.includes('resumePrevious'));
  const backup = await scenario('backup'); assert.ok(backup.includes('resumePrevious') && !backup.includes('migrate'));
});
test('migration or new application failure never restarts old code against uncertain schema', async () => {
  for (const failure of ['migrate', 'startApplication', 'checkLocal']) {
    const events = await scenario(failure);
    assert.ok(events.includes('stopApplication')); assert.ok(!events.includes('resumePrevious'));
    assert.ok(!events.includes('activateProxy') && !events.includes('recordSuccess'));
  }
});
test('HTTPS failure preserves locally healthy application and does not claim success', async () => {
  const events = await scenario('checkHttps');
  assert.ok(!events.includes('stopApplication')); assert.ok(!events.includes('recordSuccess'));
});
