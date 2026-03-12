-- CreateEnum
CREATE TYPE "SmmProvider" AS ENUM ('SUPPORTIVE', 'IND');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "provider" "SmmProvider" NOT NULL DEFAULT 'SUPPORTIVE';

-- AlterTable
ALTER TABLE "smm_orders" ADD COLUMN     "provider" "SmmProvider" NOT NULL DEFAULT 'SUPPORTIVE';
