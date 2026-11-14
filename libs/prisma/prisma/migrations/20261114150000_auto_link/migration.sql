-- CreateTable
CREATE TABLE "AutoLinkRule" (
    "type" TEXT NOT NULL PRIMARY KEY,
    "controllerDeviceId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoLinkRule_controllerDeviceId_fkey" FOREIGN KEY ("controllerDeviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoLinkSuppression" (
    "autoKey" TEXT NOT NULL PRIMARY KEY,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
