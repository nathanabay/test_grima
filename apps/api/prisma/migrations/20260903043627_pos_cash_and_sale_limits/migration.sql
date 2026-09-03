-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "closedById" UUID,
ADD COLUMN     "denominations" JSONB,
ADD COLUMN     "isBlindClose" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isAgeRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxQuantityPerSale" DECIMAL(18,4),
ADD COLUMN     "minimumAgeYears" INTEGER;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "cashSessionId" UUID NOT NULL,
    "movementType" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "witnessedById" UUID,
    "reference" TEXT,
    "performedById" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_cashSessionId_occurredAt_idx" ON "cash_movements"("cashSessionId", "occurredAt");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

