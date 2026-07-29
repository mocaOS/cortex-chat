CREATE TABLE `assistants` (
	`id` text PRIMARY KEY NOT NULL,
	`builtin_key` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`soul` text NOT NULL,
	`starters` text DEFAULT '[]' NOT NULL,
	`mode` text,
	`collection_id` text,
	`scope` text NOT NULL,
	`group_id` text,
	`user_id` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`source_url` text,
	`verified_signer` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistants_builtin_key_unique` ON `assistants` (`builtin_key`);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `assistant_id` text REFERENCES assistants(id) ON DELETE SET NULL;