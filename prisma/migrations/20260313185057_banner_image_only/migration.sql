/*
  Warnings:

  - You are about to drop the column `backgroundColor` on the `banners` table. All the data in the column will be lost.
  - You are about to drop the column `buttonText` on the `banners` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `banners` table. All the data in the column will be lost.
  - You are about to drop the column `subtitle` on the `banners` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `banners` table. All the data in the column will be lost.
  - Made the column `imageUrl` on table `banners` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "banners" DROP COLUMN "backgroundColor",
DROP COLUMN "buttonText",
DROP COLUMN "sortOrder",
DROP COLUMN "subtitle",
DROP COLUMN "title",
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "buttonLink" DROP NOT NULL,
ALTER COLUMN "imageUrl" SET NOT NULL;
