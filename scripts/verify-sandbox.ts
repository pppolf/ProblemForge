import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, root } from '@problemforge/domain';
import { SandboxClient, InfrastructureError, type SandboxCommand } from '../packages/judge-adapter/src/index.ts';

// Explicit integration entry; never called by test/test:quick.
const sandbox = new SandboxClient(config.sandboxUrl, config.sandboxToken);
const base: SandboxCommand = {
  args: ['/usr/bin/python3', '-c', `import os,json,socket
assert os.getuid() != 0
assert not os.path.exists('/etc/passwd')
assert not os.path.exists('/app/.env')
assert 'ES_AUTH_TOKEN' not in os.environ and 'DATABASE_URL' not in os.environ
try:
 open('/usr/problemforge-isolation-probe','w').write('probe')
 raise AssertionError('read-only toolchain is writable')
except (PermissionError, OSError): pass
s=socket.socket(); s.settimeout(1)
try:
 s.connect(('127.0.0.1',5050))
 raise AssertionError('host execution-service network is reachable')
except (ConnectionError,OSError): pass
finally: s.close()
print(json.dumps({'uid':os.getuid(),'privateFilesHidden':True,'toolchainReadOnly':True,'networkIsolated':True}))`],
  env: ['PATH=/usr/bin:/bin', 'HOME=/w', 'LANG=C.UTF-8'],
  files: [{ content: '' }, { name: 'stdout', max: 16384 }, { name: 'stderr', max: 16384 }],
  cpuLimit: 1e9, clockLimit: 3e9, memoryLimit: 128 * 1024 * 1024, stackLimit: 16 * 1024 * 1024,
  procLimit: 8, copyIn: {}, copyOutMax: 16384,
};
const [isolation] = await sandbox.execute(base);
assert.equal(isolation.status, 'Accepted', JSON.stringify(isolation));
assert.equal(isolation.exitStatus, 0, isolation.files?.stderr);
const proof = JSON.parse(isolation.files!.stdout);
assert(proof.uid > 0 && proof.privateFilesHidden && proof.toolchainReadOnly && proof.networkIsolated);
console.log('PASS Linux unprivileged execution / private filesystem / read-only toolchain / network namespace.');
const [limit] = await sandbox.execute({ ...base, args: ['/usr/bin/python3', '-c', 'while True: pass'], cpuLimit: 150e6, clockLimit: 2e9 });
assert.equal(limit.status, 'Time Limit Exceeded', JSON.stringify(limit));
console.log('PASS CPU limit terminates the sandbox process.');
await assert.rejects(() => new SandboxClient('http://127.0.0.1:1', config.sandboxToken).execute(base), InfrastructureError);
console.log('PASS unavailable sandbox fails explicitly; no host execution fallback.');
await writeFile(resolve(root, '.local/verify-sandbox.json'), JSON.stringify({ checkedAt: new Date().toISOString(), proof, limitStatus: limit.status, unavailable: 'InfrastructureError' }, null, 2));
