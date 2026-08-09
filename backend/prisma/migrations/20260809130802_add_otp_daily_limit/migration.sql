-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OtpUsage" (
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OtpUsage_pkey" PRIMARY KEY ("date")
);
