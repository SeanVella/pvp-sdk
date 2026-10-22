-- AlterTable
ALTER TABLE "player" ADD COLUMN "note" TEXT;
ALTER TABLE "player" ADD COLUMN "first_sign_in" DATETIME;
ALTER TABLE "player" ADD COLUMN "disabled" INTEGER NOT NULL DEFAULT 0;
