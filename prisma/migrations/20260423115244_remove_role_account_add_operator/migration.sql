/*
  Warnings:

  - You are about to drop the column `roleAccountId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the `RoleAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_roleAccountId_fkey";

-- DropIndex
DROP INDEX "Payment_roleAccountId_idx";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "roleAccountId",
ADD COLUMN     "operatorId" INTEGER;

-- DropTable
DROP TABLE "RoleAccount";

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
