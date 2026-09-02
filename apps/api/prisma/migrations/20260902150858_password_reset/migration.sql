-- AlterTable
ALTER TABLE "users" ADD COLUMN     "resetTokenExpires" TIMESTAMP(3),
ADD COLUMN     "resetTokenHash" TEXT;
