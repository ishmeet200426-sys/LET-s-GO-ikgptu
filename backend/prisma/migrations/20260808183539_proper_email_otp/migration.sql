/*
  Warnings:

  - You are about to drop the column `emailVerified` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `otp` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `otpExpiry` on the `Student` table. All the data in the column will be lost.
  - Made the column `email` on table `Student` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Student" DROP COLUMN "emailVerified",
DROP COLUMN "otp",
DROP COLUMN "otpExpiry",
ALTER COLUMN "email" SET NOT NULL;

-- CreateTable
CREATE TABLE "PendingRegistration" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "otpExpiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_phone_key" ON "PendingRegistration"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_email_key" ON "PendingRegistration"("email");
