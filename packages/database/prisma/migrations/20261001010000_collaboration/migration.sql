-- AlterEnum
ALTER TYPE "ResourceRole" ADD VALUE 'TRANSLATOR';

-- AlterTable
ALTER TABLE "Build" ADD COLUMN     "bundleId" TEXT,
ADD COLUMN     "contestId" TEXT,
ADD COLUMN     "contestRevisionId" TEXT;

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ProblemMember" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "ProblemGroupMember" (
    "problemId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "ResourceRole" NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ProblemGroupMember_pkey" PRIMARY KEY ("problemId","groupId")
);

-- CreateTable
CREATE TABLE "ProblemRevision" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "reviewHash" TEXT NOT NULL,
    "judgeHash" TEXT,
    "acceptanceRunId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "ProblemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" TEXT NOT NULL DEFAULT '',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reviewHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestMember" (
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ResourceRole" NOT NULL,

    CONSTRAINT "ContestMember_pkey" PRIMARY KEY ("contestId","userId")
);

-- CreateTable
CREATE TABLE "ContestGroupMember" (
    "contestId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "ResourceRole" NOT NULL,

    CONSTRAINT "ContestGroupMember_pkey" PRIMARY KEY ("contestId","groupId")
);

-- CreateTable
CREATE TABLE "ContestRevision" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" TEXT NOT NULL,
    "problemId" TEXT,
    "contestId" TEXT,
    "revisionId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "problemId" TEXT,
    "contestId" TEXT,
    "purpose" TEXT NOT NULL,
    "artifactId" TEXT,
    "exportId" TEXT,
    "token" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_name_key" ON "UserGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemRevision_problemId_number_key" ON "ProblemRevision"("problemId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ContestRevision_contestId_number_key" ON "ContestRevision"("contestId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ExportArtifact_key_key" ON "ExportArtifact"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Release_token_key" ON "Release"("token");

-- AddForeignKey
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemGroupMember" ADD CONSTRAINT "ProblemGroupMember_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemGroupMember" ADD CONSTRAINT "ProblemGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemRevision" ADD CONSTRAINT "ProblemRevision_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestMember" ADD CONSTRAINT "ContestMember_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestMember" ADD CONSTRAINT "ContestMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestGroupMember" ADD CONSTRAINT "ContestGroupMember_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestGroupMember" ADD CONSTRAINT "ContestGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestRevision" ADD CONSTRAINT "ContestRevision_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "ExportArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

