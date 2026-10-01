ALTER TYPE "JudgePurpose" ADD VALUE 'STRESS';
ALTER TYPE "JudgePurpose" ADD VALUE 'REPLAY';
CREATE TABLE "StressConfig" (
  "problemId" TEXT NOT NULL PRIMARY KEY, "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "hash" TEXT NOT NULL,
  CONSTRAINT "StressConfig_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "StressConfigRevision" (
  "id" TEXT NOT NULL PRIMARY KEY, "problemId" TEXT NOT NULL, "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "hash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StressConfigRevision_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "StressConfig"("problemId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StressConfigRevision_problemId_version_key" ON "StressConfigRevision"("problemId", "version");
