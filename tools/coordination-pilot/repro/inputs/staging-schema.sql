-- Staging (prod-schema) definitions of the two tables the pilot reads, MySQL 8.0.46.
CREATE TABLE `engagement_actions_v1` (
  `id` char(64) NOT NULL,
  `actor` char(64) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `target_type` varchar(16) NOT NULL,
  `target_id` varchar(128) NOT NULL,
  `received_at` bigint NOT NULL,
  `payload` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `engagement_received_at` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `gun_nodes` (
  `soul` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`soul`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
