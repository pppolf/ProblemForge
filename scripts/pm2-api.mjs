// A native ESM entry point lets PM2 cluster load the TS application via --import tsx.
await import('../apps/api/src/server.ts');
