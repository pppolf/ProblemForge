import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = 'packages/database/prisma/migrations';
const migrations = readdirSync(directory,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({name:x.name,checksum:hash(readFileSync(`${directory}/${x.name}/migration.sql`))})).sort((a,b)=>a.name.localeCompare(b.name));
const release = {format:1,buildId:process.env.PF_BUILD_ID||'unversioned',gitCommit:process.env.PF_GIT_COMMIT||null,gitTree:process.env.PF_GIT_TREE||null,builtAt:process.env.PF_BUILD_AT||null,migrations};
writeFileSync('release.json',JSON.stringify(release,null,2)+'\n');
