-- AlterTable
ALTER TABLE "dispensing_items" ADD COLUMN     "substitutedForProductId" UUID,
ADD COLUMN     "substitutionReason" TEXT;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "refillOfId" UUID;

-- CreateIndex
CREATE INDEX "prescriptions_branchId_status_idx" ON "prescriptions"("branchId", "status");

-- CreateIndex
CREATE INDEX "prescriptions_validUntil_idx" ON "prescriptions"("validUntil");

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_refillOfId_fkey" FOREIGN KEY ("refillOfId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

