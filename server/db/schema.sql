CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 email_normalized VARCHAR(254) GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
 password_hash VARCHAR(255) NOT NULL,
 role ENUM('worker','employer','admin') NOT NULL DEFAULT 'worker',
 admin_tier TINYINT NULL,
 first_name VARCHAR(100) NULL,
 last_name VARCHAR(100) NULL,
 phone VARCHAR(40) NULL,
 profile_picture LONGTEXT NULL,
 status ENUM('active','blocked','pending_deletion') NOT NULL DEFAULT 'active',
 email_verified_at DATETIME NULL,
 email_verification_token_hash CHAR(64) NULL,
 email_verification_expires_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_users_email_normalized (email_normalized),
 CHECK (admin_tier IS NULL OR admin_tier IN (1,2,3))
);
CREATE TABLE IF NOT EXISTS worker_profiles (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 bio TEXT NULL,
 skills JSON NULL,
 postcode VARCHAR(20) NULL,
 hourly_rate DECIMAL(8,2) NULL,
 national_insurance_hash CHAR(64) NULL,
 worker_permit_hash CHAR(64) NULL,
 right_to_work_status ENUM('not_started','pending','verified','rejected','manual_review') NOT NULL DEFAULT 'not_started',
identity_verification_status ENUM('not_started','pending','verified','rejected','manual_review') NOT NULL DEFAULT 'not_started',
 availability JSON NULL,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS businesses (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_user_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(200) NOT NULL,
 company_number VARCHAR(30) NULL,
 role_at_company VARCHAR(120) NULL,
 address_line_1 VARCHAR(255) NULL,
 city VARCHAR(120) NULL,
 postcode VARCHAR(20) NULL,
 verification_status ENUM('pending','verified','rejected','manual_review') NOT NULL DEFAULT 'pending',
identity_verification_status ENUM('not_started','pending','verified','rejected','manual_review') NOT NULL DEFAULT 'not_started',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (owner_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS shifts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 business_id BIGINT UNSIGNED NOT NULL,
 created_by BIGINT UNSIGNED NOT NULL,
 title VARCHAR(180) NOT NULL,
 description TEXT NULL,
 location VARCHAR(255) NOT NULL,
 starts_at DATETIME NOT NULL,
 ends_at DATETIME NOT NULL,
 break_minutes INT NOT NULL DEFAULT 0,
 hourly_pay DECIMAL(8,2) NOT NULL,
 slots INT NOT NULL DEFAULT 1,
 status ENUM('open','filled','cancelled','completed') NOT NULL DEFAULT 'open',
 auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (business_id) REFERENCES businesses(id),
 FOREIGN KEY (created_by) REFERENCES users(id),
 INDEX idx_shifts_status_start(status, starts_at)
);
CREATE TABLE IF NOT EXISTS applications (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 shift_id BIGINT UNSIGNED NOT NULL,
 worker_id BIGINT UNSIGNED NOT NULL,
 status ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY unique_application(shift_id, worker_id),
 FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
 FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS checkouts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 shift_id BIGINT UNSIGNED NOT NULL,
 worker_id BIGINT UNSIGNED NOT NULL,
 actual_start DATETIME NOT NULL,
 actual_end DATETIME NOT NULL,
 break_minutes INT NOT NULL DEFAULT 0,
 worker_comment TEXT NULL,
 employer_comment TEXT NULL,
 counter_start DATETIME NULL,
 counter_end DATETIME NULL,
 counter_break_minutes INT NULL,
 counter_gross_pay DECIMAL(10,2) NULL,
 status ENUM('submitted','approved','rejected','disputed') NOT NULL DEFAULT 'submitted',
 gross_pay DECIMAL(10,2) NOT NULL,
 platform_fee DECIMAL(10,2) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 reviewed_by BIGINT UNSIGNED NULL,
 reviewed_at DATETIME NULL,
 FOREIGN KEY (shift_id) REFERENCES shifts(id),
 FOREIGN KEY (worker_id) REFERENCES users(id),
 FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ratings (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 shift_id BIGINT UNSIGNED NOT NULL,
 reviewer_id BIGINT UNSIGNED NOT NULL,
 reviewee_id BIGINT UNSIGNED NOT NULL,
 score TINYINT NOT NULL,
 comment TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY unique_rating(shift_id, reviewer_id, reviewee_id),
 CHECK (score BETWEEN 1 AND 10),
 FOREIGN KEY (shift_id) REFERENCES shifts(id),
 FOREIGN KEY (reviewer_id) REFERENCES users(id),
 FOREIGN KEY (reviewee_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS invoices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 business_id BIGINT UNSIGNED NOT NULL,
 checkout_id BIGINT UNSIGNED NOT NULL UNIQUE,
 subtotal DECIMAL(10,2) NOT NULL,
 platform_fee DECIMAL(10,2) NOT NULL,
 total DECIMAL(10,2) NOT NULL,
 due_at DATE NOT NULL,
 status ENUM('draft','issued','paid','overdue','void') NOT NULL DEFAULT 'issued',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (business_id) REFERENCES businesses(id),
 FOREIGN KEY (checkout_id) REFERENCES checkouts(id)
);
CREATE TABLE IF NOT EXISTS disputes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 checkout_id BIGINT UNSIGNED NOT NULL,
 opened_by BIGINT UNSIGNED NOT NULL,
 reason TEXT NOT NULL,
 evidence_url VARCHAR(1000) NULL,
 status ENUM('open','assigned','resolved','rejected') NOT NULL DEFAULT 'open',
 resolution TEXT NULL,
 assigned_to BIGINT UNSIGNED NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 resolved_at DATETIME NULL,
 FOREIGN KEY (checkout_id) REFERENCES checkouts(id),
 FOREIGN KEY (opened_by) REFERENCES users(id),
 FOREIGN KEY (assigned_to) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_id BIGINT UNSIGNED NULL,
 action VARCHAR(120) NOT NULL,
 entity_type VARCHAR(80) NOT NULL,
 entity_id BIGINT UNSIGNED NULL,
 details JSON NULL,
 ip_address VARCHAR(45) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_key VARCHAR(190) NOT NULL,
 sender_id BIGINT UNSIGNED NOT NULL,
 body TEXT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (sender_id) REFERENCES users(id),
 INDEX idx_messages_conversation(conversation_key, created_at)
);

CREATE TABLE IF NOT EXISTS admin_login_names (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 username VARCHAR(80) NOT NULL UNIQUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS blocked_identifiers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 identifier_type ENUM('company_number','national_insurance','worker_permit') NOT NULL,
 identifier_hash CHAR(64) NOT NULL,
 blocked_user_id BIGINT UNSIGNED NULL,
 created_by BIGINT UNSIGNED NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_blocked_identifier(identifier_type,identifier_hash),
 FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS admin_message_meta (
 message_id BIGINT UNSIGNED PRIMARY KEY,
 recipient_id BIGINT UNSIGNED NOT NULL,
 category VARCHAR(40) NOT NULL DEFAULT 'enquiries',
 subject VARCHAR(200) NULL,
 opened_by BIGINT UNSIGNED NULL,
 read_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
 FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at DATETIME NOT NULL,
 used_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_password_reset_user_created (user_id,created_at),
 KEY idx_password_reset_expiry (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS shift_templates (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 employer_user_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL,
 template_data JSON NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_shift_templates_owner (employer_user_id,created_at),
 CONSTRAINT fk_shift_templates_employer FOREIGN KEY (employer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS referral_commissions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 referrer_user_id BIGINT UNSIGNED NOT NULL,
 referred_user_id BIGINT UNSIGNED NOT NULL,
 amount DECIMAL(10,2) NOT NULL,
 status ENUM('pending','approved','paid','cancelled') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 paid_at DATETIME NULL,
 UNIQUE KEY uq_referral_pair(referrer_user_id,referred_user_id),
 FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
);
