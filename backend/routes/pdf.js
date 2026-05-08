'use strict';

/**
 * Routes de traitement PDF.
 *
 * POST /api/pdf/:tool    — Traiter des fichiers PDF via un outil
 * GET  /api/pdf/download/:id — Télécharger un fichier traité
 *
 * Sécurité :
 *  - Rate limiting par IP / utilisateur
 *  - Authentification optionnelle (anonyme autorisé pour plan free)
 *  - Validation du paramètre :tool via whitelist
 *  - Validation magic-bytes des fichiers uploadés
 *  - Téléchargement via stream (pas de chemin direct exposé)
 *  - Auto-suppression après téléchargement ou TTL
 */

const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const { optionalAuth }     = require('../middleware/auth');
const { pdfLimiter }       = require('../middleware/rateLimit');
const { upload, validateFileType, handleMulterError } = require('../middleware/upload');
const { pdfToolSchema, validate, VALID_TOOLS } = require('../utils/validators');
const { processFiles }     = require('../services/pdfService');
const { getDB }            = require('../config/db');
const { FILE_TTL_MS }      = require('../config/constants');
const logger               = require('../utils/logger');

// ── Mapping outil → types de fichiers acceptés ───────────────────
const TOOL_ACCEPT = {
  'word-en-pdf':  ['word'],
  'excel-en-pdf': ['excel'],
  'ppt-en-pdf':   ['ppt'],
  'html-en-pdf':  ['html'],
  'pdf-en-word':  ['pdf'],
  'pdf-en-excel': ['pdf'],
  'pdf-en-ppt':   ['pdf'],
  'ocr-pdf':      ['pdf', 'image'],
  'fusionner-pdf':    ['pdf'],
  'diviser-pdf':      ['pdf'],
  'compresser-pdf':   ['pdf'],
  'faire-pivoter-pdf':['pdf'],
  'supprimer-pages-pdf': ['pdf'],
  'extraire-pages-pdf':  ['pdf'],
  'reorganiser-pages-pdf':['pdf'],
  'filigrane-pdf':    ['pdf'],
  'numeroter-pages-pdf':['pdf'],
  'proteger-pdf':     ['pdf'],
  'deverrouiller-pdf':['pdf'],
  'jpg-en-pdf':       ['image'],
  'pdf-en-jpg':       ['pdf'],
  'pdf-en-png':       ['pdf'],
};

// ── POST /api/pdf/:tool ───────────────────────────────────────────
router.post(
  '/:tool',
  pdfLimiter,
  optionalAuth,
  pdfToolSchema,
  validate,

  // Upload Multer
  (req, res, next) => {
    const uploader = upload.array('files', 20);
    uploader(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  // Validation magic-bytes selon l'outil
  (req, res, next) => {
    const toolKey     = req.params.tool;
    const categories  = TOOL_ACCEPT[toolKey] || ['pdf'];
    return validateFileType(categories)(req, res, next);
  },

  // Traitement principal
  async (req, res, next) => {
    const toolKey = req.params.tool;
    const files   = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error:   'Aucun fichier reçu.',
      });
    }

    // Vérification des limites selon le plan
    const plan = req.user?.plan || 'free';
    if (plan === 'free' && files.reduce((s, f) => s + f.size, 0) > 20 * 1024 * 1024) {
      return res.status(403).json({
        success: false,
        error:   'Limite dépassée. Les fichiers > 20 MB nécessitent un plan payant.',
      });
    }

    logger.info('Traitement demandé', {
      tool:  toolKey,
      files: files.map(f => ({ name: f.originalname, size: f.size })),
      user:  req.user?.id || 'anonyme',
    });

    try {
      const result = await processFiles(toolKey, files);

      // Enregistrer le fichier résultat en DB
      const fileId    = path.basename(result.path);
      const expiresAt = result.expiresAt || new Date(Date.now() + FILE_TTL_MS).toISOString();

      getDB().prepare(`
        INSERT OR IGNORE INTO temp_files (id, user_id, original_name, mime_type, size_bytes, path, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        fileId,
        req.user?.id || null,
        result.filename,
        result.mimeType,
        fs.statSync(result.path).size,
        result.path,
        expiresAt,
      );

      return res.json({
        success:  true,
        message:  'Traitement terminé.',
        download: {
          id:       fileId,
          filename: result.filename,
          url:      `/api/pdf/download/${fileId}`,
          expiresAt,
        },
      });

    } catch (err) {
      // Nettoyer les fichiers uploadés en cas d'erreur
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });

      if (err.status) {
        return res.status(err.status).json({ success: false, error: err.message });
      }
      next(err);
    }
  }
);

// ── GET /api/pdf/download/:id ─────────────────────────────────────
router.get('/download/:id', optionalAuth, (req, res, next) => {
  const fileId = req.params.id;

  // Validation : UUID v4 uniquement (empêche path traversal)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(fileId)) {
    return res.status(400).json({ success: false, error: 'ID de fichier invalide.' });
  }

  const row = getDB().prepare(`
    SELECT * FROM temp_files
    WHERE id = ? AND expires_at > datetime('now')
  `).get(fileId);

  if (!row) {
    return res.status(404).json({
      success: false,
      error: 'Fichier introuvable ou expiré.',
    });
  }

  if (!fs.existsSync(row.path)) {
    return res.status(404).json({ success: false, error: 'Fichier physique introuvable.' });
  }

  // Headers sécurisés pour le téléchargement
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(row.original_name)}"`
  );
  res.setHeader('Content-Length', row.size_bytes);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Stream du fichier (pas de mise en mémoire complète)
  const stream = fs.createReadStream(row.path);
  stream.on('error', (err) => {
    logger.error('Erreur stream fichier', { fileId, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Erreur lors du téléchargement.' });
    }
  });
  stream.pipe(res);
});

module.exports = router;
