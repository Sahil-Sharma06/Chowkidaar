CREATE TABLE `funding_schedules` (
	`schedule_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`amount` integer NOT NULL,
	`execute_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_funding_agent` ON `funding_schedules` (`agent_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `uaid` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `uaid_seq` integer;