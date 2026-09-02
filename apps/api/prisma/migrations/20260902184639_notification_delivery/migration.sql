-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerRef" TEXT;

-- CreateIndex
CREATE INDEX "notifications_channel_sentAt_idx" ON "notifications"("channel", "sentAt");

