import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runCloudCommand } from './cloud-process.mjs';

test('deployment commands preserve captured results, failure handling and exclusive backup output', async () => {
  assert.equal(await runCloudCommand(process.execPath, ['-e', 'console.log("ready")'], { capture: true }), 'ready');
  assert.deepEqual(await runCloudCommand(process.execPath, ['-e', 'process.exit(7)'], { allowFailure: true }), { code: 7, text: '' });
  await assert.rejects(runCloudCommand('problemforge-nonexistent-test-command', [], { timeout: 1000 }), /ENOENT/);
  const folder = await mkdtemp(join(tmpdir(), 'pf-command-check-'));
  try {
    const output = join(folder, 'backup');
    await runCloudCommand(process.execPath, ['-e', 'process.stdout.write("fixture-data")'], { output });
    assert.equal(await readFile(output, 'utf8'), 'fixture-data');
    await assert.rejects(runCloudCommand(process.execPath, ['-e', 'process.stdout.write("overwrite")'], { output }), /EEXIST/);
    assert.equal(await readFile(output, 'utf8'), 'fixture-data');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('Linux build cancellation stops its child and plugin and restores signal handlers', { skip: process.platform !== 'linux' }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'pf-build-cancel-'));
  const active = async pid => {
    try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  try {
    for (const reason of ['timeout', 'SIGINT']) {
      const pidFile = join(folder, `${reason}.json`);
      const plugin = `process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.ppid,plugin:process.pid})); setInterval(()=>{},1000);`;
      // Parent exits on SIGTERM, while the detached group's plugin ignores it.
      const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(plugin)}],{stdio:'ignore'}); setInterval(()=>{},1000);`;
      const listeners = process.listenerCount('SIGINT');
      const running = runCloudCommand(process.execPath, ['-e', parent], { processGroup: true, capture: true, timeout: reason === 'timeout' ? 800 : 10000, killAfterMs: 100 });
      const signal = reason === 'SIGINT' ? setTimeout(() => process.emit('SIGINT'), 800) : undefined;
      try { await assert.rejects(running, reason === 'timeout' ? /超时/ : /中止/); }
      finally { clearTimeout(signal); }
      assert.equal(process.listenerCount('SIGINT'), listeners);
      const pids = JSON.parse(await readFile(pidFile, 'utf8'));
      for (let i = 0; i < 20 && (await active(pids.parent) || await active(pids.plugin)); i++) await delay(25);
      assert.equal(await active(pids.parent), false);
      assert.equal(await active(pids.plugin), false);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
