CREATE TABLE `character_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`guest_id` text,
	`character_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_favorites_user_character_unique` ON `character_favorites` (`user_id`,`character_id`) WHERE "character_favorites"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `character_favorites_guest_character_unique` ON `character_favorites` (`guest_id`,`character_id`) WHERE "character_favorites"."guest_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `character_favorites_character_id_idx` ON `character_favorites` (`character_id`);--> statement-breakpoint
CREATE TABLE `character_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`guest_id` text,
	`character_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_likes_user_character_unique` ON `character_likes` (`user_id`,`character_id`) WHERE "character_likes"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `character_likes_guest_character_unique` ON `character_likes` (`guest_id`,`character_id`) WHERE "character_likes"."guest_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `character_likes_character_id_idx` ON `character_likes` (`character_id`);--> statement-breakpoint
CREATE TABLE `conversation_characters` (
	`conversation_id` text NOT NULL,
	`character_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `character_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `sender_character_id` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `media_url` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `client_msg_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `type` text DEFAULT 'dm' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `topic_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `last_read_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `headline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `heat` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `character_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `hue` integer DEFAULT 28 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_topics` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `user` ADD `favorite_team` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_conversation_id_client_msg_id_unique` ON `chat_messages` (`conversation_id`,`client_msg_id`) WHERE "chat_messages"."client_msg_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_handle_unique` ON `user` (`handle`);--> statement-breakpoint
UPDATE chat_messages SET seq = (
  SELECT COUNT(*) FROM chat_messages m2
  WHERE m2.conversation_id = chat_messages.conversation_id
    AND m2.rowid <= chat_messages.rowid);--> statement-breakpoint
INSERT INTO conversation_characters (conversation_id, character_id, joined_at)
  SELECT id, character_id, unixepoch() FROM conversations;--> statement-breakpoint
UPDATE chat_messages SET sender_character_id =
  (SELECT character_id FROM conversations c WHERE c.id = chat_messages.conversation_id)
  WHERE role = 'assistant';--> statement-breakpoint
UPDATE conversations SET last_read_seq =
  COALESCE((SELECT MAX(seq) FROM chat_messages m WHERE m.conversation_id = conversations.id), 0);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_conversation_id_seq_unique` ON `chat_messages` (`conversation_id`,`seq`);
