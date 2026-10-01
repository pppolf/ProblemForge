BEGIN;

ALTER TABLE "TestCase" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Keep immutable revisions for samples, frozen problems and historical tasks,
-- while allowing authors to reuse the numbers of deleted working data.
DROP INDEX "TestCase_problemId_number_key";
CREATE UNIQUE INDEX "TestCase_live_problemId_number_key"
  ON "TestCase"("problemId", "number") WHERE "deletedAt" IS NULL;
CREATE INDEX "TestCase_problemId_deletedAt_number_idx"
  ON "TestCase"("problemId", "deletedAt", "number");

COMMIT;
