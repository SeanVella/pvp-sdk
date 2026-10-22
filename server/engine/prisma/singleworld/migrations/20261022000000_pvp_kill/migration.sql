-- CreateTable
CREATE TABLE "pvp_kill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "profile" TEXT NOT NULL DEFAULT 'main',
    "killer" TEXT NOT NULL,
    "victim" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "victim_skulled" INTEGER NOT NULL DEFAULT 0,
    "counted" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT
);

-- CreateIndex
CREATE INDEX "pvp_kill_timestamp_idx" ON "pvp_kill"("timestamp");
