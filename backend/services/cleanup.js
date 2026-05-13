'use strict';

const fs     = require('fs');
const path   = require('path');
const cron   = require('node-cron');
const { db } = require('../config/db');
const logger = require('../utils/logger');

// ── Nettoyage des fichiers temporaires expirés ────────────────────
const cleanupTempFiles = async () => {
  try {
    const expired = await db.all(
      'SELECT * FROM temp_files WHERE expires_at < NOW()'
    );
    if (!expired.length) return;

    let deleted = 0;
    for (const file of expired) {
      try {
        if (fs.existsSync(file.path)) { fs.unlinkSync(file.path); deleted++; }
      } catch {}
      await db.run('DELETE FROM temp_files WHERE id = $1', [file.id]);
    }

    logger.info('Nettoyage fichiers temporaires', { found: expired.length, deleted });
  } catch (err) {
    logger.error('Erreur nettoyage fichiers', { error: err.message });
  }
};

// ── Nettoyage des refresh tokens expirés ─────────────────────────
const cleanupTokens = async () => {
  try {
    const { changes } = await db.run(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = 1'
    );
    if (changes > 0) logger.info('Refresh tokens supprimés', { count: changes });
  } catch (err) {
    logger.error('Erreur nettoyage tokens', { error: err.message });
  }
};

// ── Nettoyage des tentatives de connexion anciennes ───────────────
const cleanupLoginAttempts = async () => {
  try {
    await db.run("DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '24 hours'");
  } catch (err) {
    logger.error('Erreur nettoyage login_attempts', { error: err.message });
  }
};

// ── Démarrage du cron ─────────────────────────────────────────────
const startCleanupScheduler = () => {
  cron.schedule('*/30 * * * *', () => {
    cleanupTempFiles();
    cleanupTokens();
  });
  cron.schedule('0 * * * *', () => {
    cleanupLoginAttempts();
  });

  // Nettoyage immédiat au démarrage
  cleanupTempFiles();
  cleanupTokens();

  logger.info('Scheduler de nettoyage démarré (toutes les 30 min)');
};

module.exports = { startCleanupScheduler, cleanupTempFiles };
