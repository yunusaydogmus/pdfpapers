'use strict';

const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');

const { optionalAuth }     = require('../middleware/auth');
const { pdfLimiter }       = require('../middleware/rateLimit');
const { upload, validateFileType, handleMulterError } = require('../middleware/upload');
const { pdfToolSchema, validate } = require('../utils/validators');
const { processFiles }     = require('../services/pdfService');
const { db }               = require('../config/db');
const { FILE_TTL_MS }      = require('../config/constants');
const logger               = require('../utils/logger');

const TOOL_ACCEPT = {
  'word-en-pdf':  ['word'],  'excel-en-pdf': ['excel'],
  'ppt-en-pdf':   ['ppt'],   'html-en-pdf':  ['html'],
  'pdf-en-word':  ['pdf'],   'pdf-en-excel': ['pdf'],
  'pdf-en-ppt':   ['pdf'],   'ocr-pdf':      ['pdf', 'image'],
  'fusionner-pdf':     ['pdf'], 'diviser-pdf':       ['pdf'],
  'compresser-pdf':    ['pdf'], 'faire-pivoter-pdf': ['pdf'],
  'supprimer-pages-pdf':  ['pdf'], 'extraire-pages-pdf':   ['pdf'],
  'reorganiser-pages-pdf':['pdf'], 'filigrane-pdf':        ['pdf'],
  'numeroter-pages-pdf':  ['pdf'], 'proteger-pdf':         ['pdf'],
  'deverrouiller-pdf':    ['pdf'], 'jpg-en-pdf':           ['image'],
  'pdf-en-jpg':    ['pdf'],  'pdf-en-png': ['pdf'],
};

// ── POST /api/pdf/:tool ───────────────────────────────────────────
router.post(
  '/:tool',
  pdfLimiter, optionalAuth, pdfToolSchema, validate,

  (req, res, next) => {
    upload.array('files', 20)(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },

  (req, res, next) => {
    const categories = TOOL_ACCEPT[req.params.tool] || ['pdf'];
    return validateFileType(categories)(req, res, next);
  },

  async (req, res, next) => {
    const toolKey = req.params.tool;
    const files   = req.files || [];

    if (!files.length) return res.status(400).json({ success: false, error: 'Aucun fichier reçu.' });

    const plan = req.user?.plan || 'free';
    if (plan === 'free' && files.reduce((s, f) => s + f.size, 0) > 20 * 1024 * 1024) {
      return res.status(403).json({ success: false, error: 'Fichiers > 20 MB nécessitent un plan payant.' });
    }

    try {
      const result    = await processFiles(toolKey, files);
      const fileId    = path.basename(result.path);
      const expiresAt = result.expiresAt || new Date(Date.now() + FILE_TTL_MS).toISOString();

      await db.run(
        `INSERT INTO temp_files (id, user_id, original_name, mime_type, size_bytes, path, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [fileId, req.user?.id || null, result.filename, result.mimeType,
         fs.statSync(result.path).size, result.path, expiresAt]
      );

      return res.json({
        success: true, message: 'Traitement terminé.',
        download: { id: fileId, filename: result.filename, url: `/api/pdf/download/${fileId}`, expiresAt },
      });

    } catch (err) {
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      if (err.status) return res.status(err.status).json({ success: false, error: err.message });
      next(err);
    }
  }
);

// ── GET /api/pdf/download/:id ─────────────────────────────────────
router.get('/download/:id', optionalAuth, async (req, res, next) => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(400).json({ success: false, error: 'ID invalide.' });
  }

  try {
    const row = await db.get(
      'SELECT * FROM temp_files WHERE id = $1 AND expires_at > NOW()',
      [req.params.id]
    );

    if (!row || !fs.existsSync(row.path)) {
      return res.status(404).json({ success: false, error: 'Fichier introuvable ou expiré.' });
    }

    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_name)}"`);
    res.setHeader('Content-Length', row.size_bytes);
    res.setHeader('Cache-Control', 'no-store');

    fs.createReadStream(row.path).pipe(res);

  } catch (err) { next(err); }
});

module.exports = router;
