-- AlterTable
ALTER TABLE "ConnectionType" ADD COLUMN "utility" TEXT;

-- AlterTable
ALTER TABLE "Diagram" ADD COLUMN "utility" TEXT;

-- CreateTable
CREATE TABLE "UtilityProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utility" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "phone" TEXT,
    "emergencyPhone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "outageUrl" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Diagram_utility_idx" ON "Diagram"("utility");

-- CreateIndex
CREATE INDEX "UtilityProvider_utility_idx" ON "UtilityProvider"("utility");

-- Assign existing connection types to their utility map once (users can
-- change it afterwards in Settings).
UPDATE "ConnectionType" SET "utility" = 'electrical' WHERE "key" IN ('mains_230v','mains_120v','mains_240v','ac_24v','dc_24v','dc_12v');
UPDATE "ConnectionType" SET "utility" = 'gas' WHERE "key" IN ('gas');
UPDATE "ConnectionType" SET "utility" = 'water' WHERE "key" IN ('water_cold','water_hot','water_waste');
UPDATE "ConnectionType" SET "utility" = 'phone' WHERE "key" IN ('phone_line');
UPDATE "ConnectionType" SET "utility" = 'internet' WHERE "key" IN ('ethernet','wifi','coax','fiber');
UPDATE "ConnectionType" SET "utility" = 'solar' WHERE "key" IN ('solar_dc');
