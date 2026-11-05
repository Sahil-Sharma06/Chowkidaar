CREATE TABLE `oidc_states` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`purpose` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_agent` text,
	`step_up_scope` text,
	`step_up_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_account` ON `sessions` (`account_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `is_owner` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `is_merchant` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `merchant_nullifier` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `merchant_verified_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_login_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_merchant_nullifier_unique` ON `accounts` (`merchant_nullifier`);--> statement-breakpoint
UPDATE `accounts` SET `is_owner` = 1 WHERE `role` = 'owner';--> statement-breakpoint
UPDATE `accounts` SET `is_merchant` = 1 WHERE `role` = 'merchant';--> statement-breakpoint
UPDATE `accounts` SET `merchant_nullifier` = `world_nullifier`, `merchant_verified_at` = `created_at` WHERE `world_action` = 'merchant-register-v1';
