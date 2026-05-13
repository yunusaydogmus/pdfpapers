'use strict';

/**
 * Base de données PostgreSQL via Supabase.
 * Remplace better-sqlite3 (SQLite local) par pg (PostgreSQL cloud).
 *
 * Avantages :
 *  - Données persistantes même sans volume Railway
 *  - Gratuit sur Supabase (500 MB)
 *  - Même SQL que SQLite (syntaxe très proche)
 *  - Connexion pool pour de meilleures performances
 */

const { Pool } = require('pg');
const logger   = require('../utils/logger');

let pool;

// ── Connexion ─────────────────────────────────────────────────────
const initDB = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error('DATABASE_URL manquant — configurez la variable sur Railway');
    process.exit(1);
  }

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Requis pour Supabase
    max: 10,
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 5000,
  });

  // Vérifier la connexion
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    await createSchema(client);
    logger.info('PostgreSQL (Supabase) connecté ✓');
  } finally {
    client.release();
  }
};

// ── Schéma ────────────────────────────────────────────────────────
const createSchema = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','team')),
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_banned   INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address  TEXT,
      user_agent  TEXT,
      revoked     INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS temp_files (
      id            TEXT PRIMARY KEY,
      user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      path          TEXT NOT NULL,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      company    TEXT,
      subject    TEXT NOT NULL,
      message    TEXT NOT NULL,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id         BIGSERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      success    INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Index
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_rt_user      ON refresh_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rt_hash      ON refresh_tokens(token_hash)',
    'CREATE INDEX IF NOT EXISTS idx_rt_expiry    ON refresh_tokens(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_tf_expires   ON temp_files(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_la_email     ON login_attempts(email, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_la_ip        ON login_attempts(ip_address, created_at)',
  ];
  for (const idx of indexes) await client.query(idx);
};

// ── Helpers de requête ────────────────────────────────────────────
const db = {
  /** Retourne toutes les lignes */
  all: async (text, params = []) => {
    const r = await pool.query(text, params);
    return r.rows;
  },

  /** Retourne la première ligne ou null */
  get: async (text, params = []) => {
    const r = await pool.query(text, params);
    return r.rows[0] || null;
  },

  /** Exécute une requête (INSERT/UPDATE/DELETE) */
  run: async (text, params = []) => {
    const r = await pool.query(text, params);
    return { changes: r.rowCount };
  },

  /** Transaction complète */
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = { initDB, db };
