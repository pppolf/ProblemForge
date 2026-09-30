-- AlterTable
ALTER TABLE "ContentRevision" ADD COLUMN     "sampleRevisionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

