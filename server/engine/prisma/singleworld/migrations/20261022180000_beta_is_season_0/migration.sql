-- pvp-sdk: the open beta is season 0, so Season 1 is SEASON=1 (the beta used to run as season 1).
-- Every bot slot so far was made during the beta: move them to season 0, so none of them counts
-- against Season 1's slots.
UPDATE "player_bot" SET "season" = 0 WHERE "season" = 1;
