CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`world_action` text NOT NULL,
	`world_nullifier` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_nullifier` ON `accounts` (`world_nullifier`,`world_action`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`hedera_account_id` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`per_call_cap` integer NOT NULL,
	`daily_cap` integer NOT NULL,
	`approval_threshold` integer NOT NULL,
	`min_score` integer DEFAULT 80 NOT NULL,
	`allowlist_only` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_hedera_account_id_unique` ON `agents` (`hedera_account_id`);--> statement-breakpoint
CREATE TABLE `allowed_merchants` (
	`agent_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_allow` ON `allowed_merchants` (`agent_id`,`merchant_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bond_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`tx_id` text,
	`payment_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bond_ledger_tx_id_unique` ON `bond_ledger` (`tx_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer NOT NULL,
	`done_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`endpoint_url` text NOT NULL,
	`payout_account_id` text NOT NULL,
	`price` integer NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`response_schema` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`bond_balance` integer DEFAULT 0 NOT NULL,
	`bond_locked` integer DEFAULT 0 NOT NULL,
	`total_calls` integer DEFAULT 0 NOT NULL,
	`failed_calls` integer DEFAULT 0 NOT NULL,
	`score` integer,
	`arkiv_entity_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_slug_unique` ON `merchants` (`slug`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`failure_detail` text,
	`fault_case` text,
	`agent_tx_id` text NOT NULL,
	`merchant_tx_id` text,
	`merchant_paid` integer,
	`refund_tx_id` text,
	`refund_amount` integer,
	`slash_amount` integer,
	`http_status` integer,
	`latency_ms` integer,
	`response_hash` text,
	`hcs_sequence` integer,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_agent_tx_id_unique` ON `payments` (`agent_tx_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_agent` ON `payments` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_merchant` ON `payments` (`merchant_id`,`created_at`);