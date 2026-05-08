'use strict';

/**
 * Initialisation SQLite avec better-sqlite3.
 *
 * Choix SQLite :
 *  - Aucun serveur externe requis
 *  - Accès synchrone → code plus simple, pas de race conditions
 *  - Requêtes préparées → immunité SQL injection native
 *  - WAL mode → meilleures perfs en lecture concurrente
 *  - Léger pour un projet early-stage (migration vers Postgres facile)
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { DB_PATH } = require('./constants');
const logger   = require('../utils/logger');

// Créer le dossier data/ si besoin
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db;

const initDB = () => {
  try {
    db = new Database(DB_PATH, {
      // Mode strict : erreur si la colonne n'existe pas
      verbose: process.env.NODE_ENV === 'development' ? (msg) => logger.debug('[SQL] ' + msg) : null,
    });

    // ── Pragmas de sécurité et performance ──────────────────────
    db.pragma('journal_mode = WAL');     // Meilleure concurrence
    db.pragma('foreign_keys = ON');      // Intégrité référentielle
    db.pragma('synchronous = NORMAL');   // Bon compromis perf/sécurité
    db.pragma('cache_size = -32000');    // 32 MB cache
    db.pragma('temp_store = MEMORY');

    // ── Schéma ──────────────────────────────────────────────────
    db.exec(`
      -- ─── Utilisateurs ───────────────────────────────────────
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,           -- UUID v4
        first_name  TEXT NOT NULL,
        last_name   TEXT NOT NULL,
        email       TEXT NOT NULL UNIQUE,
        password    TEXT NOT NULL,              -- bcrypt hash
        plan        TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','team')),
        is_verified INTEGER NOT NULL DEFAULT 0, -- email vérifié
        is_banned   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      -- ─── Tokens de rafraîchissement ──────────────────────────
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          TEXT PRIMARY KEY,           -- UUID v4
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,       -- SHA-256 du token brut
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        ip_address  TEXT,
        user_agent  TEXT,
        revoked     INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_rt_user   ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_rt_hash   ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_rt_expiry ON refresh_tokens(expires_at);

      -- ─── Fichiers temporaires ────────────────────────────────
      CREATE TABLE IF NOT EXISTS temp_files (
        id          TEXT PRIMARY KEY,           -- UUID v4 = nom sur disque
        user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        original_name TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        size_bytes  INTEGER NOT NULL,
        path        TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tf_expires ON temp_files(expires_at);
      CREATE INDEX IF NOT EXISTS idx_tf_user    ON temp_files(user_id);

      -- ─── Messages de contact ─────────────────────────────────
      CREATE TABLE IF NOT EXISTS contacts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        company     TEXT,
        subject     TEXT NOT NULL,
        message     TEXT NOT NULL,
        ip_address  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ─── Tentatives de connexion (brute-force tracking) ──────
      CREATE TABLE IF NOT EXISTS login_attempts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT NOT NULL,
        ip_address  TEXT NOT NULL,
        success     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_la_email ON login_attempts(email, created_at);
      CREATE INDEX IF NOT EXISTS idx_la_ip    ON login_attempts(ip_address, created_at);
    `);

    logger.info('Base de données SQLite initialisée', { path: DB_PATH });
    return db;

  } catch (err) {
    logger.error('Erreur initialisation SQLite', { error: err.message });
    process.exit(1);
  }
};

// Requêtes préparées — compilées une seule fois, réutilisées ──────
const getStmts = () => ({
  // Users
  createUser: db.prepare(`
    INSERT INTO users (id, first_name, last_name, email, password)
    VALUES (@id, @firstName, @lastName, @email, @password)
  `),
  findUserByEmail: db.prepare(`
    SELECT id, first_name, last_name, email, password, plan, is_verified, is_banned, created_at
    FROM users WHERE email = ? LIMIT 1
  `),
  findUserById: db.prepare(`
    SELECT id, first_name, last_name, email, plan, is_verified, is_banned, created_at
    FROM users WHERE id = ? LIMIT 1
  `),
  updateUserPassword: db.prepare(`
    UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?
  `),

  // Refresh tokens
  createRefreshToken: db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @tokenHash, @expiresAt, @ipAddress, @userAgent)
  `),
  findRefreshToken: db.prepare(`
    SELECT * FROM refresh_tokens
    WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now')
    LIMIT 1
  `),
  revokeRefreshToken: db.prepare(`
    UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?
  `),
  revokeAllUserTokens: db.prepare(`
    UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?
  `),
  deleteExpiredTokens: db.prepare(`
    DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1
  `),

  // Temp files
  createTempFile: db.prepare(`
    INSERT INTO temp_files (id, user_id, original_name, mime_type, size_bytes, path, expires_at)
    VALUES (@id, @userId, @originalName, @mimeType, @sizeBytes, @path, @expiresAt)
  `),
  findExpiredFiles: db.prepare(`
    SELECT * FROM temp_files WHERE expires_at < datetime('now')
  `),
  deleteTempFileRecord: db.prepare(`
    DELETE FROM temp_files WHERE id = ?
  `),

  // Contacts
  createContact: db.prepare(`
    INSERT INTO contacts (name, email, company, subject, message, ip_address)
    VALUES (@name, @email, @company, @subject, @message, @ipAddress)
  `),

  // Login attempts
  recordAttempt: db.prepare(`
    INSERT INTO login_attempts (email, ip_address, success)
    VALUES (@email, @ipAddress, @success)
  `),
  countRecentFailures: db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts
    WHERE email = ? AND success = 0
    AND created_at > datetime('now', '-15 minutes')
  `),
  countRecentIpFailures: db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts
    WHERE ip_address = ? AND success = 0
    AND created_at > datetime('now', '-15 minutes')
  `),
});

module.exports = { initDB, getDB: () => db, getStmts };
