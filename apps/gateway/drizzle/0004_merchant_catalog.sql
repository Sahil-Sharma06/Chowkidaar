ALTER TABLE `merchants` ADD `category` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `keywords` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `description` text;--> statement-breakpoint
ALTER TABLE `merchants` ADD `sample_prompt` text;