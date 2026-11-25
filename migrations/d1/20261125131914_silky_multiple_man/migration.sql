CREATE TABLE `game_save` (
	`identity_id` text NOT NULL,
	`id` text NOT NULL,
	`rev` integer NOT NULL,
	`name` text NOT NULL,
	`phase` text NOT NULL,
	`rung` integer NOT NULL,
	`body` text NOT NULL,
	`saved_at` integer NOT NULL,
	`removed_at` integer,
	CONSTRAINT `game_save_pk` PRIMARY KEY(`identity_id`, `id`),
	CONSTRAINT `fk_game_save_identity_id_user_identity_id_fk` FOREIGN KEY (`identity_id`) REFERENCES `user_identity`(`id`)
);
