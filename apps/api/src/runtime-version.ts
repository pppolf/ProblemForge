import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from '@problemforge/database';
import { root } from '@problemforge/domain';
export async function runtimeVersion() {
  let release:any=null;
  try { release=JSON.parse(await readFile(resolve(root,'release.json'),'utf8')); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
  const applied=await db.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const expected=release?.migrations??null;
  return {mode:release?.gitCommit?'release':release?'unversioned':'development',buildId:release?.buildId??'development',gitCommit:release?.gitCommit??null,gitTree:release?.gitTree??null,builtAt:release?.builtAt??null,migrations:applied.map(m=>({name:m.migration_name,checksum:m.checksum})),migrationsMatch:expected?JSON.stringify(expected)===JSON.stringify(applied.map(m=>({name:m.migration_name,checksum:m.checksum}))):null};
}
