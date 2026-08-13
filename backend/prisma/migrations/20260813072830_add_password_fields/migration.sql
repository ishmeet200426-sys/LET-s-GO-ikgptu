/*
  Warnings:

  - Added the required column `passwordHash` to the `PendingRegistration` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passwordHash` to the `Student` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PendingRegistration" ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "passwordHash" TEXT NOT NULL;
