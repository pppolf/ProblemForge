import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
dotenv();
const { db } = await import('@problemforge/database');
const { root, hashObject } = await import('@problemforge/domain');
const { validateTemplate, loadTemplateDirectory } = await import('@problemforge/template-engine');
const builtins = [
  { folder: 'statement', name: 'CWNU 比赛题面', kind: 'STATEMENT' as const },
  { folder: 'editorial-document', name: '经典书面题解', kind: 'EDITORIAL_DOCUMENT' as const },
  { folder: 'editorial-beamer', name: 'CWNU 讲解 · 4:3', kind: 'EDITORIAL_BEAMER' as const },
];
try {
  for (const builtin of builtins) {
    const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
    if (only && only !== builtin.folder) continue;
    const existing = await db.template.findFirst({ where: { name: builtin.name, kind: builtin.kind }, include: { versions: { orderBy: { number: 'desc' }, take: 1 } } });
    if (existing && !process.argv.includes('--new-drafts')) { console.log(`保留现有模板：${builtin.name}`); continue; }
    const path = resolve(root, 'templates/builtin', builtin.folder);
    const files = await loadTemplateDirectory(path);
    validateTemplate(files, builtin.kind);
    if (existing) await db.templateVersion.create({ data: { templateId: existing.id, number: existing.versions[0].number + 1, files, hash: hashObject(files) } });
    else await db.template.create({ data: { name: builtin.name, kind: builtin.kind, versions: { create: { number: 1, files, hash: hashObject(files) } } } });
    console.log(`创建模板草稿：${builtin.name}；需真实编译、预览确认后发布。`);
  }
} finally { await db.$disconnect(); }
