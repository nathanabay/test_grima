-- AlterTable
ALTER TABLE "stock_reservations" ADD COLUMN     "balanceId" UUID;

-- AlterTable
ALTER TABLE "warehouse_locations" ALTER COLUMN "updatedAt" DROP DEFAULT;

