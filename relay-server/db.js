import { initEngagementStore } from '../shared-validation/engagement-store.js';
// db.js — MySQL connection, schema bootstrap, and query helpers
import mysql from 'mysql2/promise';
import fs from 'node:fs';

// Secure by default — verify the server cert. MYSQL_SSL_CA for private CAs,
// MYSQL_SSL_INSECURE=true for local dev only (mirrors gun-relay-enhanced.js).
function buildMysqlSsl() {
  if (process.env.MYSQL_SSL_CA) {
    return { ca: fs.readFileSync(process.env.MYSQL_SSL_CA), rejectUnauthorized: true };
  }
  if (process.env.MYSQL_SSL_INSECURE === 'true') {
    console.warn('MySQL TLS verification DISABLED (MYSQL_SSL_INSECURE=true) - dev only');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

export let db = null;

export async function initMySQL() {
  if (!process.env.MYSQL_HOST) return;
  try {
    db = await mysql.createPool({
      host:                  process.env.MYSQL_HOST,
      user:                  process.env.MYSQL_USER,
      password:              process.env.MYSQL_PASSWORD,
      database:              process.env.MYSQL_DATABASE,
      port:                  process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
      waitForConnections:    true,
      connectionLimit:       5,
      enableKeepAlive:       true,
      keepAliveInitialDelay: 10000,
      ssl:                   buildMysqlSsl(),
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_index (
        id         VARCHAR(100) PRIMARY KEY,
        type       ENUM('post', 'poll') NOT NULL,
        title      TEXT,
        content    TEXT,
        author     VARCHAR(200),
        community  VARCHAR(100),
        created_at BIGINT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FULLTEXT INDEX idx_title_content (title, content),
        INDEX idx_author    (author),
        INDEX idx_community (community),
        INDEX idx_created   (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ── Categorisation column migration (MySQL 5.7+ compatible) ──────────────
    const dbName = process.env.MYSQL_DATABASE;

    async function addColIfMissing(col, def) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND COLUMN_NAME = ?`,
        [dbName, col]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE search_index ADD COLUMN ${col} ${def}`);
      }
    }

    async function addIdxIfMissing(name, def) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND INDEX_NAME = ?`,
        [dbName, name]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE search_index ADD INDEX ${name} ${def}`).catch(() => {});
      }
    }

    async function ensureColType(col, expectedType, newDef) {
      const [rows] = await db.execute(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND COLUMN_NAME = ?`,
        [dbName, col]
      );
      if (rows.length === 0) return;
      const current = (rows[0].COLUMN_TYPE || '').toLowerCase();
      // Needs modification if: wrong base type, OR varchar but too narrow (e.g. varchar(16) → varchar(32))
      const wrongType   = !current.startsWith(expectedType.toLowerCase());
      const tooNarrow   = current.startsWith('varchar') && newDef.toLowerCase().includes('varchar(32)') && !current.includes('varchar(32)');
      if (wrongType || tooNarrow) {
        if (current.includes('tinyint')) {
          // Migrate old boolean values before changing type
          await db.execute(`UPDATE search_index SET ${col} = 'other-adult' WHERE ${col} = '1' OR ${col} = 1`).catch(() => {});
          await db.execute(`UPDATE search_index SET ${col} = 'none' WHERE ${col} = '0' OR ${col} = 0 OR ${col} IS NULL`).catch(() => {});
        }
        await db.execute(`ALTER TABLE search_index MODIFY COLUMN ${col} ${newDef}`);
        console.log(`[db] Migration: ${col} updated to ${newDef.split(' ')[0]}`);
      }
    }

    await addColIfMissing('category',     `VARCHAR(64)  DEFAULT NULL`);
    await addColIfMissing('tags',          `VARCHAR(500) DEFAULT NULL`);
    await addColIfMissing('sentiment',     `VARCHAR(16)  DEFAULT NULL`);
    await addColIfMissing('nsfw',          `VARCHAR(32)  DEFAULT 'none'`);
    // Ensure nsfw is VARCHAR(32) — older installs had TINYINT(1) or VARCHAR(16)
    await ensureColType  ('nsfw',          'varchar',    `VARCHAR(32) DEFAULT 'none'`);
    await addColIfMissing('controversial', `TINYINT(1)   NOT NULL DEFAULT 0`);
    await addColIfMissing('evergreen',     `TINYINT(1)   NOT NULL DEFAULT 1`);
    await addColIfMissing('locale',        `VARCHAR(16)  NOT NULL DEFAULT 'global'`);

    await addIdxIfMissing('idx_category',      '(category)');
    await addIdxIfMissing('idx_nsfw',          '(nsfw)');
    await addIdxIfMissing('idx_controversial', '(controversial)');
    await addIdxIfMissing('idx_evergreen',     '(evergreen)');
    await addIdxIfMissing('idx_locale',        '(locale)');

    // One-time nsfw boolean → enum migration
    await db.execute(`UPDATE search_index SET nsfw = 'other-adult' WHERE nsfw = '1'`).catch(() => {});
    await db.execute(`UPDATE search_index SET nsfw = 'none' WHERE nsfw = '0' OR nsfw IS NULL`).catch(() => {});

    // View tracking columns
    await addColIfMissing('view_count',     `INT NOT NULL DEFAULT 0`);
    await addColIfMissing('unique_viewers', `INT NOT NULL DEFAULT 0`);
    // Image reference columns — imageIPFS is the cid key, imageThumbnail is stored
    // separately in Gun but cached here for fast search result rendering
    await addColIfMissing('imageIPFS',      `VARCHAR(100) DEFAULT NULL`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id                VARCHAR(100) PRIMARY KEY,
        room_id           VARCHAR(200) NOT NULL,
        sender_id         VARCHAR(100) NOT NULL,
        recipient_id      VARCHAR(100) NOT NULL,
        encrypted_content TEXT         NOT NULL,
        timestamp         BIGINT       NOT NULL,
        read_at           BIGINT       DEFAULT NULL,
        delivered_at      BIGINT       DEFAULT NULL,
        INDEX idx_room      (room_id),
        INDEX idx_sender    (sender_id),
        INDEX idx_recipient (recipient_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_pending   (recipient_id, read_at, delivered_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id      VARCHAR(100) PRIMARY KEY,
        username     VARCHAR(100) UNIQUE,
        display_name VARCHAR(200),
        avatar_url   TEXT,
        public_key   TEXT,
        last_seen    BIGINT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS signal_bundles (
        user_id     VARCHAR(200) PRIMARY KEY,
        ik          TEXT         NOT NULL,
        ik_sign_pub TEXT         DEFAULT NULL,
        spk         TEXT         NOT NULL,
        opk         TEXT         NOT NULL,
        spk_sig     VARCHAR(200) DEFAULT NULL,
        updated_at  BIGINT       NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id    VARCHAR(64) PRIMARY KEY,
        user_id       VARCHAR(100) NOT NULL,
        ip_address    VARCHAR(45),
        user_agent    TEXT,
        created_at    BIGINT NOT NULL,
        expires_at    BIGINT NOT NULL,
        last_activity BIGINT NOT NULL,
        INDEX idx_user    (user_id),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS chain_blocks (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        block_index INT          NOT NULL,
        poll_id     VARCHAR(255),
        device_id   VARCHAR(255),
        action_type VARCHAR(64),
        vote_hash   VARCHAR(128),
        pubkey      VARCHAR(128),
        timestamp   BIGINT,
        INDEX idx_poll_device (poll_id, device_id),
        INDEX idx_action      (action_type)
      ) ENGINE=InnoDB;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS mod_queue (
        id             VARCHAR(100) PRIMARY KEY,
        soul           VARCHAR(500)                                      NOT NULL,
        content_type   ENUM('post','poll','comment','video')             NOT NULL DEFAULT 'post',
        content_snippet TEXT,
        flagged_at     BIGINT                                            NOT NULL,
        status         ENUM('pending','approved','removed')              NOT NULL DEFAULT 'pending',
        reason         TEXT,
        reviewed_by    VARCHAR(100),
        reviewed_at    BIGINT,
        INDEX idx_status  (status),
        INDEX idx_flagged (flagged_at),
        INDEX idx_type    (content_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS chat_media (
        id          VARCHAR(36)  PRIMARY KEY,
        sender_id   VARCHAR(128) NOT NULL,
        blob_path   VARCHAR(512) NOT NULL,
        mime_type   VARCHAR(128) NOT NULL,
        byte_size   INT          NOT NULL,
        uploaded_at BIGINT       NOT NULL,
        expires_at  BIGINT       NOT NULL,
        downloaded  TINYINT      DEFAULT 0,
        deleted     TINYINT      DEFAULT 0,
        INDEX idx_sender     (sender_id),
        INDEX idx_expires    (expires_at),
        INDEX idx_downloaded (downloaded)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS post_views (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        content_id   VARCHAR(128)        NOT NULL,
        content_type ENUM('post','poll') NOT NULL,
        viewer_pub   VARCHAR(128)        NOT NULL,
        viewed_at    BIGINT              NOT NULL,
        INDEX idx_content (content_id),
        INDEX idx_viewer  (viewer_pub),
        UNIQUE KEY uq_viewer_content (content_id, viewer_pub(64))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS blocklist (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        type     ENUM('soul','cid','pubkey') NOT NULL,
        value    VARCHAR(500)                NOT NULL,
        reason   TEXT,
        added_at BIGINT                      NOT NULL,
        UNIQUE KEY idx_type_value (type, value(200))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ── chat_messages live migrations (existing deployments) ─────────────────
    // These are no-ops on fresh installs where CREATE TABLE already has the
    // columns.  On existing deployments the table already exists so CREATE TABLE
    // IF NOT EXISTS is a no-op — we must ALTER to add new columns.
    async function addColIfMissingOnTable(table, col, def) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbName, table, col]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${def}`);
        console.log(`[db] Migration: added ${table}.${col}`);
      }
    }

    async function addIdxIfMissingOnTable(table, name, def) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [dbName, table, name]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE \`${table}\` ADD INDEX ${name} ${def}`).catch(() => {});
        console.log(`[db] Migration: added index ${table}.${name}`);
      }
    }

    // chat_messages: delivered_at (guards re-replay of offline messages on reconnect)
    await addColIfMissingOnTable('chat_messages', 'delivered_at', 'BIGINT DEFAULT NULL');

    // chat_messages: composite pending index (covers getPendingMessagesForUser query)
    await addIdxIfMissingOnTable(
      'chat_messages', 'idx_pending',
      '(recipient_id, read_at, delivered_at)'
    );

    // signal_bundles: spk_sig and ik_sign_pub (SPK signature + ECDSA signing key)
    await addColIfMissingOnTable('signal_bundles', 'ik_sign_pub', 'TEXT DEFAULT NULL');
    await addColIfMissingOnTable('signal_bundles', 'spk_sig', "VARCHAR(200) DEFAULT NULL");
    // Full authenticated (v1 device-binding) bundle JSON, served verbatim so clients can verify it.
    await addColIfMissingOnTable('signal_bundles', 'bundle_json', 'MEDIUMTEXT DEFAULT NULL');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS opk_pool (
        id           VARCHAR(64)  PRIMARY KEY,
        user_id      VARCHAR(200) NOT NULL,
        pub          TEXT         NOT NULL,
        consumed     TINYINT      NOT NULL DEFAULT 0,
        consumed_at  BIGINT       DEFAULT NULL,
        created_at   BIGINT       NOT NULL,
        INDEX idx_opk_user     (user_id),
        INDEX idx_opk_pending  (user_id, consumed, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ── OPK pool migrations (existing deployments) ────────────────────────────
    async function addColIfMissingOnTable2(table, col, def) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbName, table, col]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${def}`);
        console.log(`[db] Migration: added ${table}.${col}`);
      }
    }
    // consumed_at was added after initial schema — add it if missing
    await addColIfMissingOnTable2('opk_pool', 'consumed_at', 'BIGINT DEFAULT NULL');

    await initEngagementStore(db);
    console.log('✅ MySQL connected');
  } catch (err) {
    console.error('❌ MySQL failed:', err.message);
    db = null;
  }
}

export async function queryMySQL(sql, params) {
  if (!db) return null;
  let conn;
  try {
    conn = await db.getConnection();
    const [rows] = await conn.query(sql, params);
    return rows;
  } catch (err) {
    console.error('❌ MySQL query error:', err.message, '| SQL:', sql.substring(0, 120));
    return null;
  } finally {
    if (conn) conn.release();
  }
}