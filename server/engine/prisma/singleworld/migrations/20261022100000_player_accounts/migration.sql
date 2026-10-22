-- CreateTable
CREATE TABLE "player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "phone_hash" TEXT NOT NULL,
    "api_key_hash" TEXT,
    "created" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "player_bot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "player_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "created" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "player_phone_hash_key" ON "player"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "player_api_key_hash_key" ON "player"("api_key_hash");

-- CreateIndex
CREATE INDEX "player_bot_player_id_season_idx" ON "player_bot"("player_id", "season");

-- CreateIndex
CREATE UNIQUE INDEX "player_bot_account_id_season_key" ON "player_bot"("account_id", "season");
