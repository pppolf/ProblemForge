ALTER TABLE "Build"
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "retryOfId" TEXT,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cacheSourceId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Build_requestKey_key" ON "Build"("requestKey");
CREATE UNIQUE INDEX "Build_retryOfId_key" ON "Build"("retryOfId");
ALTER TABLE "TestRun"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "retryOfId" TEXT,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "TestRun_retryOfId_key" ON "TestRun"("retryOfId");
CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkerHeartbeat_kind_heartbeatAt_idx" ON "WorkerHeartbeat"("kind", "heartbeatAt");
CREATE TABLE "StoredObject" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "hash" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL,
  "ready" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CompileCache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "problemId" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
