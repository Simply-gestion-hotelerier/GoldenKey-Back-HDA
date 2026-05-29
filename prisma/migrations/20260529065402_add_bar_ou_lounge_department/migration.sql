/*
  Warnings:

  - The values [pub,spa] on the enum `Department` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Department_new" AS ENUM ('hotel', 'restaurant', 'bar', 'casino');
ALTER TABLE "Service" ALTER COLUMN "dept" DROP DEFAULT;
ALTER TABLE "Tab" ALTER COLUMN "dept" DROP DEFAULT;
ALTER TABLE "Store" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "Item" ALTER COLUMN "menuDept" TYPE "Department_new" USING ("menuDept"::text::"Department_new");
ALTER TABLE "FolioCharge" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "DiningTable" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "Order" ALTER COLUMN "dept" TYPE "Department_new" USING ("dept"::text::"Department_new");
ALTER TABLE "Tab" ALTER COLUMN "dept" TYPE "Department_new" USING ("dept"::text::"Department_new");
ALTER TABLE "CashSession" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "Payment" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "Invoice" ALTER COLUMN "department" TYPE "Department_new" USING ("department"::text::"Department_new");
ALTER TABLE "Service" ALTER COLUMN "dept" TYPE "Department_new" USING ("dept"::text::"Department_new");
ALTER TYPE "Department" RENAME TO "Department_old";
ALTER TYPE "Department_new" RENAME TO "Department";
DROP TYPE "Department_old";
ALTER TABLE "Service" ALTER COLUMN "dept" SET DEFAULT 'hotel';
ALTER TABLE "Tab" ALTER COLUMN "dept" SET DEFAULT 'restaurant';
COMMIT;

-- AlterTable
ALTER TABLE "DiningTable" ADD COLUMN     "assignedWaiterId" INTEGER;

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "dept" SET DEFAULT 'hotel';

-- AlterTable
ALTER TABLE "Tab" ALTER COLUMN "dept" SET DEFAULT 'restaurant';

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_assignedWaiterId_fkey" FOREIGN KEY ("assignedWaiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
