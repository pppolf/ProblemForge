ALTER TABLE "User" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordReset_userId_key" ON "PasswordReset"("userId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
