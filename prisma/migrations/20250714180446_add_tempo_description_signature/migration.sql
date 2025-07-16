/*
  Warnings:

  - Added the required column `signature` to the `Beat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tempo` to the `Beat` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Beat" ADD COLUMN     "description" TEXT,
ADD COLUMN     "signature" TEXT NOT NULL,
ADD COLUMN     "tempo" INTEGER NOT NULL;
