import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface StorageAdapter { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer>; }
export class PrivateFileStorage implements StorageAdapter {
  private base: string;
  constructor(root: string) { this.base = resolve(root); }
  private path(key: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/.test(key) || key.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('非法存储键');
    const path = resolve(this.base, key);
    if (!path.startsWith(`${this.base}${sep}`)) throw new Error('存储路径越界');
    return path;
  }
  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' });
    await rename(tmp, path);
  }
  async get(key: string) { return readFile(this.path(key)); }
}
