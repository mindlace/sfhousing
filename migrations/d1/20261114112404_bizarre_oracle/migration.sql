CREATE TABLE `principal` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_identity` (
	`id` text PRIMARY KEY,
	`superseded_by_id` text,
	`superseded_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_user_identity_id_principal_id_fk` FOREIGN KEY (`id`) REFERENCES `principal`(`id`),
	CONSTRAINT `fk_user_identity_superseded_by_id_user_identity_id_fk` FOREIGN KEY (`superseded_by_id`) REFERENCES `user_identity`(`id`)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL UNIQUE,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	CONSTRAINT `fk_passkey_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_identity` text NOT NULL,
	`handle` text NOT NULL UNIQUE,
	`handle_skeleton` text,
	`is_anonymous` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_user_user_identity_user_identity_id_fk` FOREIGN KEY (`user_identity`) REFERENCES `user_identity`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `sim_index` (
	`sim_id` text PRIMARY KEY,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sim_invite` (
	`id` text PRIMARY KEY,
	`sim_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_email` text,
	`invited_user_id` text,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_sent_at` integer,
	`accepted_by_user_id` text,
	CONSTRAINT `fk_sim_invite_invited_user_id_user_identity_id_fk` FOREIGN KEY (`invited_user_id`) REFERENCES `user_identity`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sim_invite_invited_by_user_id_user_identity_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `user_identity`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sim_invite_accepted_by_user_id_user_identity_id_fk` FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user_identity`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `user_version` (
	`id` text PRIMARY KEY,
	`user_identity` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`captured_at` integer NOT NULL,
	CONSTRAINT `fk_user_version_user_identity_user_identity_id_fk` FOREIGN KEY (`user_identity`) REFERENCES `user_identity`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `capability_event` (
	`id` text PRIMARY KEY,
	`principal_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`ability` text NOT NULL,
	`action` text NOT NULL,
	`caveats` text,
	`parent_id` text,
	`actor_id` text,
	`created_at` integer NOT NULL,
	`created_at_counter` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_capability_event_principal_id_principal_id_fk` FOREIGN KEY (`principal_id`) REFERENCES `principal`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `handle_tombstone` (
	`handle` text PRIMARY KEY,
	`released_by` text NOT NULL,
	`released_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`skeleton` text,
	CONSTRAINT `fk_handle_tombstone_released_by_user_identity_id_fk` FOREIGN KEY (`released_by`) REFERENCES `user_identity`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_handle_skeleton_unique` ON `user` (`handle_skeleton`);--> statement-breakpoint
CREATE UNIQUE INDEX `sim_invite_token_hash_idx` ON `sim_invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `user_version_identity_idx` ON `user_version` (`user_identity`);--> statement-breakpoint
CREATE INDEX `capability_event_principal_idx` ON `capability_event` (`principal_id`);--> statement-breakpoint
CREATE INDEX `capability_event_resource_idx` ON `capability_event` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `capability_event_created_idx` ON `capability_event` (`created_at`,`created_at_counter`);--> statement-breakpoint
CREATE INDEX `handle_tombstone_skeleton_idx` ON `handle_tombstone` (`skeleton`);