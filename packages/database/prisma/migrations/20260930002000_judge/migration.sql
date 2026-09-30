-- CreateEnum
CREATE TYPE "ProgramRole" AS ENUM ('MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE', 'GENERATOR', 'VALIDATOR', 'EXTRA_VALIDATOR', 'CHECKER', 'INTERACTOR');

-- CreateEnum
CREATE TYPE "ProgramLanguage" AS ENUM ('CPP17', 'CPP20', 'PYTHON3');

-- CreateEnum
CREATE TYPE "JudgePurpose" AS ENUM ('COMPILE', 'GENERATE', 'VALIDATE', 'ANSWERS', 'SELF_TEST', 'ACCEPTANCE');

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "judgeSettings" JSONB,
ADD COLUMN     "judgeVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CompileProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" "ProgramLanguage" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompileProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ProgramRole" NOT NULL,
    "profileId" TEXT NOT NULL,
    "expectedVerdicts" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRevision" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT 'main',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseRevision" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "inputKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputBytes" INTEGER NOT NULL,
    "answerKey" TEXT,
    "answerHash" TEXT,
    "answerBytes" INTEGER,
    "provenance" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorPlan" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorPlanRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolSelfTest" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "programId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolSelfTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolSelfTestRevision" (
    "id" TEXT NOT NULL,
    "selfTestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolSelfTestRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "purpose" "JudgePurpose" NOT NULL,
    "state" "BuildState" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "dependencyHash" TEXT NOT NULL,
    "accepted" BOOLEAN,
    "report" JSONB,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT '等待入队',
    "log" TEXT NOT NULL DEFAULT '',
    "errorCode" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunCase" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "inputKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputBytes" INTEGER NOT NULL,
    "answerKey" TEXT,
    "answerHash" TEXT,
    "answerBytes" INTEGER,
    "origin" JSONB NOT NULL,
    "validation" TEXT NOT NULL DEFAULT 'NOT_RUN',

    CONSTRAINT "RunCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invocation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "programId" TEXT,
    "programRevisionId" TEXT,
    "caseRef" TEXT,
    "selfTestId" TEXT,
    "phase" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitStatus" INTEGER NOT NULL,
    "timeMs" DOUBLE PRECISION NOT NULL,
    "wallTimeMs" DOUBLE PRECISION NOT NULL,
    "memoryBytes" INTEGER NOT NULL,
    "stdoutKey" TEXT,
    "stdoutHash" TEXT,
    "stdoutBytes" INTEGER NOT NULL DEFAULT 0,
    "stderrKey" TEXT,
    "stderrBytes" INTEGER NOT NULL DEFAULT 0,
    "diagnostic" TEXT NOT NULL DEFAULT '',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_currentRevisionId_key" ON "Program"("currentRevisionId");

-- CreateIndex
CREATE INDEX "Program_problemId_role_idx" ON "Program"("problemId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRevision_programId_version_key" ON "ProgramRevision"("programId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_currentRevisionId_key" ON "TestCase"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_problemId_number_key" ON "TestCase"("problemId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseRevision_testCaseId_version_key" ON "TestCaseRevision"("testCaseId", "version");

-- CreateIndex
CREATE INDEX "GeneratorPlan_problemId_idx" ON "GeneratorPlan"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratorPlanRevision_planId_version_key" ON "GeneratorPlanRevision"("planId", "version");

-- CreateIndex
CREATE INDEX "ToolSelfTest_problemId_idx" ON "ToolSelfTest"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolSelfTestRevision_selfTestId_version_key" ON "ToolSelfTestRevision"("selfTestId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_requestKey_key" ON "TestRun"("requestKey");

-- CreateIndex
CREATE INDEX "TestRun_state_queuedAt_idx" ON "TestRun"("state", "queuedAt");

-- CreateIndex
CREATE INDEX "TestRun_problemId_createdAt_idx" ON "TestRun"("problemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunCase_runId_ref_key" ON "RunCase"("runId", "ref");

-- CreateIndex
CREATE INDEX "Invocation_runId_phase_idx" ON "Invocation"("runId", "phase");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CompileProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ProgramRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRevision" ADD CONSTRAINT "ProgramRevision_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "TestCaseRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseRevision" ADD CONSTRAINT "TestCaseRevision_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorPlan" ADD CONSTRAINT "GeneratorPlan_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorPlan" ADD CONSTRAINT "GeneratorPlan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorPlanRevision" ADD CONSTRAINT "GeneratorPlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GeneratorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSelfTest" ADD CONSTRAINT "ToolSelfTest_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSelfTest" ADD CONSTRAINT "ToolSelfTest_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSelfTestRevision" ADD CONSTRAINT "ToolSelfTestRevision_selfTestId_fkey" FOREIGN KEY ("selfTestId") REFERENCES "ToolSelfTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunCase" ADD CONSTRAINT "RunCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invocation" ADD CONSTRAINT "Invocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

