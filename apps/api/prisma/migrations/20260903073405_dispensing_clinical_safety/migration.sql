-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrescriptionStatus" ADD VALUE 'READY_FOR_COLLECTION';
ALTER TYPE "PrescriptionStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "dispensings" ADD COLUMN     "counsellingNotes" TEXT,
ADD COLUMN     "labelPrintCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overriddenWarnings" JSONB,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" UUID,
ADD COLUMN     "witnessedById" UUID;

-- AlterTable
ALTER TABLE "prescription_items" ADD COLUMN     "allowSubstitution" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "collectedBy" TEXT,
ADD COLUMN     "isUrgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "auxiliaryLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "breastfeedingCaution" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hepaticCaution" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxDailyDose" DECIMAL(18,4),
ADD COLUMN     "pregnancyCaution" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "renalCaution" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "dispensings_branchId_dispensedAt_idx" ON "dispensings"("branchId", "dispensedAt");

