-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "acceptedCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: las ofertas que ya tienen postulaciones aceptadas no pueden
-- arrancar en 0, o acceptedCount < seats quedaria mal desde el primer dia.
UPDATE "offers" o
SET "acceptedCount" = (
  SELECT count(*) FROM "applications" a
  WHERE a."offerId" = o.id AND a.status = 'ACCEPTED'
);
