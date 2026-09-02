-- AlterTable
ALTER TABLE "temperature_sensors" ADD COLUMN     "calibrationDueAt" TIMESTAMP(3),
ADD COLUMN     "calibrationInterval" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "lastCalibratedAt" TIMESTAMP(3),
ADD COLUMN     "lastMaintenanceAt" TIMESTAMP(3),
ADD COLUMN     "nextMaintenanceAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sensor_calibrations" (
    "id" UUID NOT NULL,
    "sensorId" UUID NOT NULL,
    "calibratedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "certificateNo" TEXT,
    "performedBy" TEXT,
    "referenceTempC" DECIMAL(6,2),
    "measuredTempC" DECIMAL(6,2),
    "result" TEXT NOT NULL DEFAULT 'PASS',
    "notes" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_maintenance" (
    "id" UUID NOT NULL,
    "sensorId" UUID NOT NULL,
    "workType" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "performedBy" TEXT,
    "description" TEXT NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "tookOffline" BOOLEAN NOT NULL DEFAULT false,
    "offlineFrom" TIMESTAMP(3),
    "offlineUntil" TIMESTAMP(3),
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sensor_calibrations_sensorId_calibratedAt_idx" ON "sensor_calibrations"("sensorId", "calibratedAt");

-- CreateIndex
CREATE INDEX "sensor_maintenance_sensorId_performedAt_idx" ON "sensor_maintenance"("sensorId", "performedAt");

-- AddForeignKey
ALTER TABLE "sensor_calibrations" ADD CONSTRAINT "sensor_calibrations_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "temperature_sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_maintenance" ADD CONSTRAINT "sensor_maintenance_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "temperature_sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

