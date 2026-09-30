import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url)); dotenv({ path: resolve(root, '.env') });
process.env.PRISMA_GENERATE_SKIP_AUTOINSTALL = '1';
process.env.CHECKPOINT_DISABLE = '1';
// Reuse the installed, version-pinned native engines on Windows. Without an
// explicit path Prisma can attempt a second engine download during generation.
if (process.platform === 'win32') {
  const require = createRequire(resolve(root, 'packages/database/node_modules/prisma/package.json'));
  const engineDir = dirname(require.resolve('@prisma/engines/package.json'));
  const query = resolve(engineDir, 'query_engine-windows.dll.node');
  const schema = resolve(engineDir, 'schema-engine-windows.exe');
  if (existsSync(query)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = query;
  if (existsSync(schema)) process.env.PRISMA_SCHEMA_ENGINE_BINARY = schema;
}
const command = process.argv[2];
if (!['generate', 'migrate'].includes(command)) throw new Error('仅支持 generate / migrate deploy');
const cli = resolve(root, 'packages/database/node_modules/prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...(command === 'migrate' ? ['migrate', 'deploy'] : ['generate']), '--schema', resolve(root, 'packages/database/prisma/schema.prisma')], { cwd: root, env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 1);
