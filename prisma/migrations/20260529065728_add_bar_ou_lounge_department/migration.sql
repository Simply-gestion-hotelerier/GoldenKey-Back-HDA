/*
  Warnings:

  - The values [bar] on the enum `Department` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Department_new" AS ENUM ('hotel', 'restaurant', 'lounge', 'casino');
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
