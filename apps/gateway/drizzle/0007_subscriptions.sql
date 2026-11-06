CREATE TABLE `subscription_runs` (
	`schedule_id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`n` integer NOT NULL,
	`execute_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`payment_id` text,
	`error` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_runs_subscription` ON `subscription_runs` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`every_sec` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_agent` ON `subscriptions` (`agent_id`);