/*
  Warnings:

  - You are about to drop the column `buttonLink` on the `banners` table. All the data in the column will be lost.
  - You are about to drop the column `order` on the `banners` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "banners" DROP COLUMN "buttonLink",
DROP COLUMN "order";
