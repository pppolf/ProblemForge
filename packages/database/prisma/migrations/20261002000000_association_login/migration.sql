-- Keep existing user IDs, memberships, sessions and historical credentials intact.
-- External identities are bound explicitly; never infer a binding from an email.
ALTER TABLE "User" ADD COLUMN "associationUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "associationAccount" TEXT;
CREATE UNIQUE INDEX "User_associationUserId_key" ON "User"("associationUserId");
