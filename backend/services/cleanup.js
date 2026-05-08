'use strict';

/**
 * Service de nettoyage automatique des fichiers temporaires.
 *
 * - Cron toutes les 30 minutes
 * - Supprime les fichiers dont le TTL est expiré (défaut : 2h)
 * - Nettoie aussi les entrées DB correspondantes
 * - Nettoie les refresh tokens expirés
 * - Nettoie les tentatives de connexion anciennes (> 24h)
 */

const fs     = require('fs');
const cron   = require('node-cron');
const { getDB, getStmts } = require('../config/db');
const logger = require('../utils/logger');

// ── Nettoyage des fichiers temporaires ───────────────────────────
const cleanupTempFiles = () => {
  const db    = getDB();
  const stmts = getStmts();

  try {
    const expired = stmts.findExpiredFiles.all();

    if (expired.length === 0) return;

    let deleted = 0;
    let errors  = 0;

    const doCleanup = db.transaction((files) => {
      for (const file of files) {
        // Supprimer le fichier physique
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            deleted++;
          }
        } catch (e) {
          errors++;
          logger.warn('Impossible de supprimer le fichier', { path: file.path, error: e.message });
        }
        // Supprimer l'entrée DB dans tous les cas
        stmts.deleteTempFileRecord.run(file.id);
      }
    });

    doCleanup(expired);

    logger.info('Nettoyage fichiers temporaires', {
      found: expired.length,
      deleted,
      errors,
    });

  } catch (err) {
    logger.error('Erreur nettoyage fichiers', { error: err.message });
  }
};

// ── Nettoyage des tokens expirés ─────────────────────────────────
const cleanupTokens = () => {
  try {
    const { changes } = getStmts().deleteExpiredTokens.run();
    if (changes > 0) {
      logger.info('Refresh tokens expirés supprimés', { count: changes });
    }
  } catch (err) {
    logger.error('Erreur nettoyage tokens', { error: err.message });
  }
};

// ── Nettoyage des tentatives de connexion anciennes ───────────────
const cleanupLoginAttempts = () => {
  try {
    const { changes } = getDB()
      .prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-24 hours')")
      .run();
    if (changes > 0) {
      logger.debug('Tentatives de connexion supprimées', { count: changes });
    }
  } catch (err) {
    logger.error('Erreur nettoyage login_attempts', { error: err.message });
  }
};

// ── Nettoyage manuel du dossier tmp/ (orphelins) ─────────────────
// Fichiers sur disque sans entrée DB (ex: crash pendant upload)
const cleanupOrphans = () => {
  const { UPLOAD_TMP_DIR } = require('../config/constants');
  const db = getDB();

  try {
    if (!fs.existsSync(UPLOAD_TMP_DIR)) return;

    const files = fs.readdirSync(UPLOAD_TMP_DIR);
    let orphans = 0;

    for (const filename of files) {
      if (filename === '.gitkeep') continue;

      // Vérifier si ce fichier est en DB
      const row = db
        .prepare('SELECT id FROM temp_files WHERE id = ?')
        .get(filename);

      if (!row) {
        // Orphelin : vérifier l'ancienneté (ne pas supprimer les très récents)
        const filePath = require('path').join(UPLOAD_TMP_DIR, filename);
        try {
          const stat = fs.statSync(filePath);
          const ageMs = Date.now() - stat.mtimeMs;
          // Supprimer seulement si > 3 heures (marge de sécurité)
          if (ageMs > 3 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
            orphans++;
          }
        } catch { /* silencieux */ }
      }
    }

    if (orphans > 0) {
      logger.info('Fichiers orphelins supprimés', { count: orphans });
    }
  } catch (err) {
    logger.error('Erreur nettoyage orphelins', { error: err.message });
  }
};

// ── Démarrage du cron ────────────────────────────────────────────
const startCleanupScheduler = () => {
  // Toutes les 30 minutes : nettoyage fichiers + tokens
  cron.schedule('*/30 * * * *', () => {
    logger.debug('Cron nettoyage lancé');
    cleanupTempFiles();
    cleanupTokens();
  });

  // Toutes les heures : nettoyage tentatives de connexion + orphelins
  cron.schedule('0 * * * *', () => {
    cleanupLoginAttempts();
    cleanupOrphans();
  });

  // Nettoyage immédiat au démarrage
  cleanupTempFiles();
  cleanupTokens();

  logger.info('Scheduler de nettoyage démarré (cron toutes les 30 min)');
};

module.exports = { startCleanupScheduler, cleanupTempFiles };
