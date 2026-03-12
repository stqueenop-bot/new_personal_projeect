-- AlterTable
ALTER TABLE "special_offers" ADD COLUMN     "description" TEXT,
ADD COLUMN     "price" DOUBLE PRECISION,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "serviceId" INTEGER;
