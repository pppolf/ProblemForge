import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateFileStorage } from './index.ts';
test('private byte storage survives reopening and rejects traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'problemforge-storage-'));
  try {
    const bytes = Buffer.from([0, 13, 10, 32, 255]);
    await new PrivateFileStorage(dir).put('problem/input.bin', bytes);
    assert.deepEqual(await new PrivateFileStorage(dir).get('problem/input.bin'), bytes);
    await assert.rejects(new PrivateFileStorage(dir).get('../outside'));
  } finally { await rm(dir, { recursive: true }); }
});
