-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "operatorName" TEXT,
ADD COLUMN     "roleAccountId" INTEGER;

-- CreateTable
CREATE TABLE "RoleAccount" (
    "id" SERIAL NOT NULL,
    "userName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleAccount_userName_key" ON "RoleAccount"("userName");

-- CreateIndex
CREATE INDEX "Payment_roleAccountId_idx" ON "Payment"("roleAccountId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_roleAccountId_fkey" FOREIGN KEY ("roleAccountId") REFERENCES "RoleAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
