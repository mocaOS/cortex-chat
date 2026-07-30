ALTER TABLE `login_events` ADD `method` text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `oidc_sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `oidc_issuer` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_oidc_identity` ON `users` (`oidc_issuer`,`oidc_sub`);