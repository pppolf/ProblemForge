import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)); dotenv({ path: resolve(root, '.env') });
const name = process.argv[2]; if (!name || !/^[a-z0-9_]+$/.test(name)) throw new Error('必须指定安全的迁移名称');
const directory = resolve(root, `packages/database/prisma/migrations/${name}`);
const schema = resolve(root, 'packages/database/prisma/schema.prisma');
const result = spawnSync(process.execPath, [resolve(root, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--script'], { cwd: root, encoding: 'utf8', env: process.env });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, 'migration.sql'), result.stdout, { flag: 'wx' });
console.log(`Generated ${name}; no database mutation has been performed.`);
