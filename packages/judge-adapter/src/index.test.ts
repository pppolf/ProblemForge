import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfrastructureError, SandboxClient } from './index.js';

const client = new SandboxClient('http://sandbox.invalid', 'private-token');

test('empty upload HTTP 500 identifies the failed operation without inventing a cause', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 500 }));
  await assert.rejects(client.upload('input.bin', Buffer.from('input')), error => {
    assert.ok(error instanceof InfrastructureError);
    assert.equal(error.code, 'SANDBOX_UNAVAILABLE');
    assert.match(error.message, /POST \/file HTTP 500/);
    assert.match(error.message, /请检查沙箱容器日志及 \/dev\/shm/);
    assert.doesNotMatch(error.message, /存储空间不足/);
    assert.match(error.message, /任务没有在宿主机执行/);
    return true;
  });
});

test('ENOSPC diagnostics classify storage exhaustion without exposing raw error bodies', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'write /dev/shm/private-path: no space left on device', token: 'private-token' }), { status: 500 }));
  await assert.rejects(client.upload('input.bin', Buffer.alloc(1)), error => {
    assert.ok(error instanceof InfrastructureError);
    assert.match(error.message, /沙箱临时文件存储空间不足/);
    assert.doesNotMatch(error.message, /private-path|private-token/);
    return true;
  });
});

test('large error responses are bounded and canceled; non-upload failures retain context', async t => {
  let pulls = 0, canceled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(Buffer.alloc(4096, 'x')); },
    cancel() { canceled = true; },
  }), { status: 503 }));
  await assert.rejects(client.download('private-file-id'), error => {
    assert.ok(error instanceof InfrastructureError);
    assert.match(error.message, /GET \/file\/:id HTTP 503/);
    assert.doesNotMatch(error.message, /private-file-id|空间不足/);
    return true;
  });
  assert.ok(canceled); assert.ok(pulls <= 2);
});

test('unreadable HTTP error bodies preserve the HTTP status', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('private upstream error')); },
  }), { status: 502 }));
  await assert.rejects(client.health(), /GET \/version HTTP 502/);
});

test('successful file and health requests keep their existing protocol', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
    if (String(url).endsWith('/version')) return Response.json({ buildVersion: 'v1.8.5', os: 'linux' });
    if (init?.method === 'POST') return Response.json('file-id');
    if (init?.method === 'DELETE') return new Response(null);
    return new Response(Buffer.from([0, 128, 255]));
  });
  assert.equal((await client.health()).os, 'linux');
  assert.equal(await client.upload('input.bin', Buffer.from('input')), 'file-id');
  assert.deepEqual(await client.download('file-id'), Buffer.from([0, 128, 255]));
  await client.delete('file-id');
});
