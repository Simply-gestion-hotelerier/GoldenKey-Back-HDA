-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "meta" TEXT,
ADD COLUMN     "targetRoles" TEXT,
ADD COLUMN     "targetUserId" INTEGER,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'info';
