ALTER TABLE "Program" ADD COLUMN "expectedScore" JSONB;
ALTER TABLE "Program" ADD COLUMN "validatorScope" TEXT NOT NULL DEFAULT 'GLOBAL';
CREATE TABLE "TestGroupConfig" (
  "problemId" TEXT NOT NULL PRIMARY KEY, "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "hash" TEXT NOT NULL,
  CONSTRAINT "TestGroupConfig_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "TestGroupConfigRevision" (
  "id" TEXT NOT NULL PRIMARY KEY, "problemId" TEXT NOT NULL, "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "hash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestGroupConfigRevision_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "TestGroupConfig"("problemId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TestGroupConfigRevision_problemId_version_key" ON "TestGroupConfigRevision"("problemId", "version");
