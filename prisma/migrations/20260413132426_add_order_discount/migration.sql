-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('fixed', 'percent');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'fixed';
