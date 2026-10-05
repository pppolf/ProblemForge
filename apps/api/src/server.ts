import { db } from '@problemforge/database';
import { config } from '@problemforge/domain';
import { createApp } from './app.ts';

const app = await createApp();
try { await app.listen({ host: config.host, port: config.port }); process.send?.('ready'); }
catch (error) { app.log.error(error); await db.$disconnect(); process.exit(1); }
let closing = false;
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, async () => {
  if (closing) return; closing = true;
  await app.close(); await db.$disconnect(); process.exit(0);
});
