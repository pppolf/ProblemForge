import { createHash } from 'node:crypto';
import type { SandboxClient, SandboxResult } from '@problemforge/judge-adapter';

type FileClient = Pick<SandboxClient, 'upload' | 'delete'>;

// go-judge keeps /file and copyOutCached bytes in its shared-memory filesystem.
// Own them per invocation, retaining only compiled programs for the whole run.
export class SandboxFiles {
  private ids = new Set<string>();
  constructor(private sandbox: FileClient) {}
  async using<T>(body: (files: SandboxFileScope) => Promise<T>): Promise<T> {
    const files = new SandboxFileScope(this, this.sandbox);
    try { return await body(files); } finally { await files.close(); }
  }
  track(id: string) { this.ids.add(id); }
  async release(ids: Iterable<string>) {
    const removed = new Set<string>();
    await Promise.allSettled([...new Set(ids)].map(async id => {
      if (!this.ids.has(id)) { removed.add(id); return; }
      await this.sandbox.delete(id);
      this.ids.delete(id); removed.add(id);
    }));
    // Failed deletes remain owned, so the final task cleanup retries them.
    return removed;
  }
  async cleanup() { await this.release(this.ids); }
}

export class SandboxFileScope {
  private ids = new Set<string>();
  private inputs = new Set<string>();
  private hashes = new Map<string, string>();
  constructor(private owner: SandboxFiles, private sandbox: FileClient) {}
  async upload(bytes: Buffer) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const cached = this.hashes.get(hash);
    if (cached) return cached;
    const id = await this.sandbox.upload('input.bin', bytes);
    this.track(id); this.inputs.add(id); this.hashes.set(hash, id);
    return id;
  }
  track(id: string) { this.ids.add(id); this.owner.track(id); }
  trackResult(result: SandboxResult) { for (const id of Object.values(result.fileIds ?? {})) this.track(id); }
  // Promotion is used only after a successful compile/cache load. Its ID stays
  // with the task owner while all other scope files are disposed in finally.
  keep(id: string) { this.ids.delete(id); this.inputs.delete(id); }
  async release(ids: Iterable<string>) {
    const removed = await this.owner.release([...ids].filter(id => this.ids.has(id)));
    for (const id of removed) { this.ids.delete(id); this.inputs.delete(id); }
    for (const [hash, id] of this.hashes) if (removed.has(id)) this.hashes.delete(hash);
  }
  async releaseInputs() { await this.release(this.inputs); }
  async close() { await this.release(this.ids); }
}
