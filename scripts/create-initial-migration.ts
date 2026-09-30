import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)); dotenv({ path: resolve(root, '.env') });
const migration = resolve(root, 'packages/database/prisma/migrations/20260930000000_initial');
const result = spawnSync(process.execPath, [resolve(root, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve(root, 'packages/database/prisma/schema.prisma'), '--script'], { cwd: root, encoding: 'utf8', env: process.env });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
await mkdir(migration, { recursive: true });
await writeFile(resolve(migration, 'migration.sql'), result.stdout, { flag: 'wx' });
await writeFile(resolve(migration, '../migration_lock.toml'), 'provider = "postgresql"\n');
console.log('Generated immutable initial migration.');
