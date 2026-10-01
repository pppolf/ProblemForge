CREATE INDEX "Problem_createdAt_id_idx" ON "Problem"("createdAt", "id");
CREATE INDEX "Build_requestedById_createdAt_id_idx" ON "Build"("requestedById", "createdAt", "id");
CREATE INDEX "Build_problemId_createdAt_id_idx" ON "Build"("problemId", "createdAt", "id");
CREATE INDEX "Build_contestId_createdAt_id_idx" ON "Build"("contestId", "createdAt", "id");
CREATE INDEX "TestRun_requestedById_createdAt_id_idx" ON "TestRun"("requestedById", "createdAt", "id");
CREATE INDEX "TestRun_problemId_createdAt_id_idx" ON "TestRun"("problemId", "createdAt", "id");
