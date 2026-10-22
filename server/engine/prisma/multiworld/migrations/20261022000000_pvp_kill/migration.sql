-- CreateTable
CREATE TABLE `pvp_kill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `timestamp` DATETIME(3) NOT NULL,
    `profile` VARCHAR(191) NOT NULL DEFAULT 'main',
    `killer` VARCHAR(191) NOT NULL,
    `victim` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,
    `victim_skulled` INTEGER NOT NULL DEFAULT 0,
    `counted` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(191) NULL,

    INDEX `pvp_kill_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
