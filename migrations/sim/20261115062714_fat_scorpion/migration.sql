CREATE TABLE `commits` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`hash` text NOT NULL,
	`bytes` integer NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sim_state` (
	`id` integer PRIMARY KEY,
	`indexed_seq` integer DEFAULT 0 NOT NULL,
	`gone_at` integer
);
