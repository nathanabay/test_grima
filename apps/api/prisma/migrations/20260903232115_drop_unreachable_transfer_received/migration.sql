-- A transfer goes PARTIALLY_RECEIVED -> COMPLETED. Nothing ever wrote
-- RECEIVED, so a caller filtering for it got an empty list that looked like
-- an answer rather than a state that does not exist. No row holds it.

-- AlterEnum
BEGIN;
CREATE TYPE "TransferStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PICKING', 'DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');
ALTER TABLE "stock_transfers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "stock_transfers" ALTER COLUMN "status" TYPE "TransferStatus_new" USING ("status"::text::"TransferStatus_new");
ALTER TYPE "TransferStatus" RENAME TO "TransferStatus_old";
ALTER TYPE "TransferStatus_new" RENAME TO "TransferStatus";
DROP TYPE "TransferStatus_old";
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

