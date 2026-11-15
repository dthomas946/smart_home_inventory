-- CreateTable
CREATE TABLE "NetworkLayout" (
    "mode" TEXT NOT NULL PRIMARY KEY,
    "positions" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
