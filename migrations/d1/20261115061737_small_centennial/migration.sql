CREATE TABLE `sim_commit` (
	`sim_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`actor` text NOT NULL,
	`at` integer NOT NULL,
	`build` text NOT NULL,
	`dataset_version` text NOT NULL,
	`bytes` integer NOT NULL,
	`restores_position` integer,
	`restores_as` text,
	CONSTRAINT `sim_commit_pk` PRIMARY KEY(`sim_id`, `seq`)
);
--> statement-breakpoint
ALTER TABLE `sim_index` ADD `remixed_from` text;--> statement-breakpoint
ALTER TABLE `sim_index` ADD `remixed_from_position` integer;--> statement-breakpoint
ALTER TABLE `sim_index` ADD `positions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sim_index` ADD `last_change_at` integer;--> statement-breakpoint
ALTER TABLE `sim_index` ADD `dataset_version` text;--> statement-breakpoint
CREATE INDEX `sim_commit_actor_idx` ON `sim_commit` (`actor`);--> statement-breakpoint
CREATE INDEX `sim_commit_dataset_version_idx` ON `sim_commit` (`dataset_version`);