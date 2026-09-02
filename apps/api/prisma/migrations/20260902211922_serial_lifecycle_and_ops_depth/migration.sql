-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "anonymizedById" UUID,
ADD COLUMN     "anonymizedReason" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedById" UUID;

-- AlterTable
ALTER TABLE "serial_numbers" ADD COLUMN     "lastMovedAt" TIMESTAMP(3),
ADD COLUMN     "lastReferenceId" UUID,
ADD COLUMN     "lastReferenceType" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "stock_adjustment_items" ADD COLUMN     "lossType" TEXT;

-- AlterTable
ALTER TABLE "stock_counts" ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "isBlind" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFrozen" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "driverPhone" TEXT,
ADD COLUMN     "expectedArrival" TIMESTAMP(3),
ADD COLUMN     "trackingNumber" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
ADD COLUMN     "riskNotes" TEXT;

-- CreateTable
CREATE TABLE "serial_events" (
    "id" UUID NOT NULL,
    "serialId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" UUID,
    "referenceNo" TEXT,
    "warehouseId" UUID,
    "branchId" UUID,
    "performedById" UUID,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serial_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serial_events_serialId_occurredAt_idx" ON "serial_events"("serialId", "occurredAt");

-- CreateIndex
CREATE INDEX "serial_events_eventType_idx" ON "serial_events"("eventType");

-- CreateIndex
CREATE INDEX "serial_numbers_status_idx" ON "serial_numbers"("status");

-- AddForeignKey
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "serial_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

