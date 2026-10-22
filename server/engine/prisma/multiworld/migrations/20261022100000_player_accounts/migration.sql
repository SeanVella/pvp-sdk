-- CreateTable
CREATE TABLE `player` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone_hash` VARCHAR(191) NOT NULL,
    `api_key_hash` VARCHAR(191) NULL,
    `created` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_phone_hash_key`(`phone_hash`),
    UNIQUE INDEX `player_api_key_hash_key`(`api_key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_bot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `player_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `season` INTEGER NOT NULL,
    `created` DATETIME(3) NOT NULL,

    INDEX `player_bot_player_id_season_idx`(`player_id`, `season`),
    UNIQUE INDEX `player_bot_account_id_season_key`(`account_id`, `season`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
