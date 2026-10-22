CREATE TABLE "ContestAsset" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContestAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContestAsset_key_key" ON "ContestAsset"("key");
CREATE INDEX "ContestAsset_contestId_createdAt_idx" ON "ContestAsset"("contestId", "createdAt");
ALTER TABLE "ContestAsset" ADD CONSTRAINT "ContestAsset_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
