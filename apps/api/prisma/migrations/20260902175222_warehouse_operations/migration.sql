-- AlterTable
ALTER TABLE "warehouse_locations" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "capacityUnits" DECIMAL(18,4),
ADD COLUMN     "isPickFace" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationType" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "maxWeightKg" DECIMAL(18,4),
ADD COLUMN     "pickSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "storageCondition" "StorageCondition" NOT NULL DEFAULT 'ROOM_TEMPERATURE',
-- Existing locations predate this column, so they are stamped with the
-- migration time rather than being rejected for a missing value. Prisma's
-- @updatedAt keeps it current from here on.
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "warehouse_tasks" (
    "id" UUID NOT NULL,
    "taskNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "productId" UUID,
    "batchId" UUID,
    "fromLocationId" UUID,
    "toLocationId" UUID,
    "suggestedLocationId" UUID,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityDone" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" UUID,
    "waveId" UUID,
    "assignedToId" UUID,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "notes" TEXT,
    "shortReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_waves" (
    "id" UUID NOT NULL,
    "waveNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'WAVE',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "zoneId" UUID,
    "releasedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_packages" (
    "id" UUID NOT NULL,
    "packageNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "waveId" UUID,
    "referenceType" TEXT,
    "referenceId" UUID,
    "status" TEXT NOT NULL DEFAULT 'PACKING',
    "weightKg" DECIMAL(18,4),
    "sealNumber" TEXT,
    "stagingLocationId" UUID,
    "dockId" UUID,
    "packedById" UUID,
    "packedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "departureTempC" DECIMAL(6,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_package_lines" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "verifiedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "shipment_package_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docks" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'BOTH',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_tasks_taskNo_key" ON "warehouse_tasks"("taskNo");

-- CreateIndex
CREATE INDEX "warehouse_tasks_warehouseId_status_idx" ON "warehouse_tasks"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "warehouse_tasks_assignedToId_status_idx" ON "warehouse_tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "warehouse_tasks_taskType_status_idx" ON "warehouse_tasks"("taskType", "status");

-- CreateIndex
CREATE INDEX "warehouse_tasks_waveId_idx" ON "warehouse_tasks"("waveId");

-- CreateIndex
CREATE INDEX "warehouse_tasks_referenceType_referenceId_idx" ON "warehouse_tasks"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "pick_waves_waveNo_key" ON "pick_waves"("waveNo");

-- CreateIndex
CREATE INDEX "pick_waves_warehouseId_status_idx" ON "pick_waves"("warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_packages_packageNo_key" ON "shipment_packages"("packageNo");

-- CreateIndex
CREATE INDEX "shipment_packages_warehouseId_status_idx" ON "shipment_packages"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "shipment_packages_referenceType_referenceId_idx" ON "shipment_packages"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "shipment_package_lines_packageId_idx" ON "shipment_package_lines"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "docks_warehouseId_code_key" ON "docks"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_barcode_key" ON "warehouse_locations"("barcode");

-- CreateIndex
CREATE INDEX "warehouse_locations_warehouseId_locationType_idx" ON "warehouse_locations"("warehouseId", "locationType");

-- AddForeignKey
ALTER TABLE "warehouse_tasks" ADD CONSTRAINT "warehouse_tasks_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_tasks" ADD CONSTRAINT "warehouse_tasks_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_tasks" ADD CONSTRAINT "warehouse_tasks_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "pick_waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_packages" ADD CONSTRAINT "shipment_packages_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "pick_waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_package_lines" ADD CONSTRAINT "shipment_package_lines_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "shipment_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

