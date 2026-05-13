'use strict';

/**
 * Middleware Multer pour les uploads de fichiers.
 *
 * Sécurité multi-couches :
 *  1. Limite de taille (50 MB par fichier)
 *  2. Filtre par extension (whitelist stricte)
 *  3. Validation magic-bytes via file-type (après upload)
 *     → Un fichier malveillant renommé en .pdf sera rejeté
 *  4. Noms UUID → impossible de deviner le chemin d'un fichier
 *  5. Stockage hors de la racine web (pas accessible directement)
 *  6. Enregistrement en DB avec TTL → nettoyage automatique
 */

const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const FileType = require('file-type');
const { UPLOAD_TMP_DIR, MAX_FILE_SIZE, FILE_TTL_MS, ALLOWED_MIME } = require('../config/constants');
const { getDB, getStmts } = require('../config/db');
const logger   = require('../utils/logger');

// Créer le dossier tmp/ si besoin
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

// ── Extensions autorisées ─────────────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.jpg', '.jpeg', '.png',
  '.webp', '.bmp', '.gif', '.html', '.htm',
]);

// ── Storage Multer : disk avec UUID ──────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename:    (_req, _file, cb) => {
    // UUID pur : aucune info sur le fichier original dans le nom
    cb(null, uuidv4());
  },
});

// ── Filtre Multer (côté stream, avant écriture complète) ──────────
const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    // Rejeter : NE PAS sauvegarder sur disque
    return cb(Object.assign(new Error(`Type de fichier non autorisé : ${ext}`), { status: 415 }), false);
  }

  // Vérification basique du MIME déclaré (le vrai sera vérifié après)
  const allAllowed = Object.values(ALLOWED_MIME).flat();
  if (!allAllowed.includes(file.mimetype) && file.mimetype !== 'application/octet-stream') {
    return cb(Object.assign(new Error('Type MIME non autorisé.'), { status: 415 }), false);
  }

  cb(null, true);
};

// ── Instance Multer ───────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:  MAX_FILE_SIZE,
    files:     20,           // Max 20 fichiers par requête (pour fusion)
    fieldSize: 1024,         // 1 KB pour les champs texte
    fields:    10,
  },
});

// ── Validation magic-bytes (post-upload) ─────────────────────────
/**
 * Middleware à appliquer APRÈS multer.
 * Lit les vrais magic bytes du fichier pour confirmer son type.
 * Supprime et rejette si le type ne correspond pas à l'attendu.
 */
const validateFileType = (allowedCategories) => async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  const allowedMimes = new Set(
    allowedCategories.flatMap(cat => ALLOWED_MIME[cat] || [])
  );

  const rejectFile = async (file, reason) => {
    try { fs.unlinkSync(file.path); } catch { /* silencieux */ }
    logger.warn('Fichier rejeté (magic bytes)', { reason, originalname: file.originalname, ip: req.ip });
    return res.status(415).json({ success: false, error: reason });
  };

  for (const file of req.files) {
    let fileTypeResult;
    try {
      fileTypeResult = await FileType.fromFile(file.path);
    } catch (e) {
      return rejectFile(file, 'Impossible de lire le fichier.');
    }

    if (!fileTypeResult) {
      // Cas HTML : pas de magic bytes, lire les premiers octets
      if (file.originalname.match(/\.html?$/i)) {
        const sample = fs.readFileSync(file.path, { encoding: 'utf8', flag: 'r' }).slice(0, 100).toLowerCase();
        if (!sample.includes('<html') && !sample.includes('<!doctype')) {
          return rejectFile(file, 'Fichier HTML invalide.');
        }
        continue; // OK
      }
      return rejectFile(file, 'Type de fichier non reconnu.');
    }

    if (!allowedMimes.has(fileTypeResult.mime)) {
      return rejectFile(file, `Type réel du fichier non autorisé : ${fileTypeResult.mime}`);
    }

    // Mettre à jour le mime type avec la vraie valeur
    file.detectedMime = fileTypeResult.mime;
  }

  next();
};

// ── Enregistrement en DB + TTL ────────────────────────────────────
const registerFilesInDB = async (req, _res, next) => {
  if (!req.files || req.files.length === 0) return next();

  const stmts     = getStmts();
  const expiresAt = new Date(Date.now() + FILE_TTL_MS).toISOString();
  const userId    = req.user?.id || null;

  const register = getDB().transaction((files) => {
    for (const file of files) {
      stmts.createTempFile.run({
        id:           path.basename(file.path), // UUID = nom du fichier
        userId,
        originalName: file.originalname,
        mimeType:     file.detectedMime || file.mimetype,
        sizeBytes:    file.size,
        path:         file.path,
        expiresAt,
      });
    }
  });

  try {
    register(req.files);
    next();
  } catch (err) {
    logger.error('Erreur enregistrement fichier en DB', { error: err.message });
    // Nettoyer les fichiers déjà écrits
    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    next(err);
  }
};

// ── Gestion des erreurs Multer ────────────────────────────────────
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msgs = {
      LIMIT_FILE_SIZE:  'Fichier trop volumineux (max 50 MB).',
      LIMIT_FILE_COUNT: 'Trop de fichiers (max 20).',
      LIMIT_FIELD_VALUE:'Champ trop volumineux.',
      LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu.',
    };
    return res.status(413).json({
      success: false,
      error: msgs[err.code] || 'Erreur d\'upload.',
    });
  }
  if (err?.status === 415) {
    return res.status(415).json({ success: false, error: err.message });
  }
  next(err);
};

module.exports = {
  upload,
  validateFileType,
  registerFilesInDB,
  handleMulterError,
};
