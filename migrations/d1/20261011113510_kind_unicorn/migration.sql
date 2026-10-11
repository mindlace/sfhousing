CREATE TABLE `plan` (
	`id` text PRIMARY KEY,
	`schema` integer NOT NULL,
	`dataset_version` text NOT NULL,
	`body` text NOT NULL,
	`content_hash` text NOT NULL UNIQUE,
	`op_count` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plan_created_at_idx` ON `plan` (`created_at`);