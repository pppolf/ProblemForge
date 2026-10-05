// Explicit ordering lets the installer fail before public activation and avoids
// restarting old code after a possibly partial database migration.
export async function deployWorkflow(ops, upgrading) {
  let stopped = false, migrationStarted = false, applicationHealthy = false;
  try {
    await ops.prepare();
    await ops.buildSandboxes();
    if (upgrading) { await ops.quiesce(); stopped = true; await ops.backup(); }
    await ops.startInfrastructure();
    migrationStarted = true;
    await ops.migrate();
    await ops.bootstrap();
    await ops.startApplication();
    await ops.checkLocal(); applicationHealthy = true;
    await ops.activateVersion();
    await ops.installStartup();
    await ops.activateProxy();
    await ops.checkHttps();
    await ops.recordSuccess();
  } catch (error) {
    if (stopped && !migrationStarted) await ops.resumePrevious();
    else if (migrationStarted && !applicationHealthy) await ops.stopApplication();
    await ops.reportFailure({ migrationStarted, applicationHealthy });
    throw error;
  }
}
