-- 002_chat: conversations between employers and workers, linked to an application.
CREATE TABLE IF NOT EXISTS conversations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 application_id BIGINT UNSIGNED NOT NULL UNIQUE,
 shift_id BIGINT UNSIGNED NOT NULL,
 worker_id BIGINT UNSIGNED NOT NULL,
 employer_id BIGINT UNSIGNED NOT NULL,
 last_message_at TIMESTAMP NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
 FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
 FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (employer_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX idx_conversations_worker(worker_id, last_message_at),
 INDEX idx_conversations_employer(employer_id, last_message_at)
);
CREATE TABLE IF NOT EXISTS conversation_members (
 conversation_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 typing_until DATETIME NULL,
 PRIMARY KEY (conversation_id, user_id),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id BIGINT UNSIGNED NOT NULL,
 sender_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('text','gif') NOT NULL DEFAULT 'text',
 body TEXT NULL,
 gif_url VARCHAR(1000) NULL,
 gif_preview_url VARCHAR(1000) NULL,
 gif_title VARCHAR(255) NULL,
 reply_to_id BIGINT UNSIGNED NULL,
 deleted_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY (sender_id) REFERENCES users(id),
 FOREIGN KEY (reply_to_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
 INDEX idx_chat_messages_conversation(conversation_id, id)
);
CREATE TABLE IF NOT EXISTS chat_message_reactions (
 message_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 emoji VARCHAR(32) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (message_id, user_id),
 FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
