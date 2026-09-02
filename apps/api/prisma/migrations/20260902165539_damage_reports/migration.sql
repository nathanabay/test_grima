-- CreateEnum
CREATE TYPE "DamageStatus" AS ENUM ('REPORTED', 'VERIFIED', 'REJECTED', 'DISPOSED');

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" UUID NOT NULL,
    "reportNo" TEXT NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "damageType" TEXT NOT NULL,
    "status" "DamageStatus" NOT NULL DEFAULT 'REPORTED',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" UUID,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "verificationNotes" TEXT,
    "rejectionReason" TEXT,
    "disposalId" UUID,
    "incidentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "damage_reports_reportNo_key" ON "damage_reports"("reportNo");

-- CreateIndex
CREATE INDEX "damage_reports_status_idx" ON "damage_reports"("status");

-- CreateIndex
CREATE INDEX "damage_reports_batchId_idx" ON "damage_reports"("batchId");
