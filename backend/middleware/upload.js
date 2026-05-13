'use strict';

const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const FileType = require('file-type');
const { UPLOAD_TMP_DIR, MAX_FILE_SIZE, FILE_TTL_MS, ALLOWED_MIME } = require('../config/constants');
const { db }   = require('../config/db');
const logger   = require('../utils/logger');

if (!fs.existsSync(UPLOAD_TMP_DIR)) fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.jpg', '.jpeg', '.png',
  '.webp', '.bmp', '.gif', '.html', '.htm',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename:    (_req, _file, cb) => cb(null, uuidv4()),
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(Object.assign(new Error(`Extension non autorisée : ${ext}`), { status: 415 }), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 20, fields: 10 },
});

const validateFileType = (allowedCategories) => async (req, res, next) => {
  if (!req.files?.length) return next();

  const allowedMimes = new Set(allowedCategories.flatMap(cat => ALLOWED_MIME[cat] || []));

  for (const file of req.files) {
    let result;
    try { result = await FileType.fromFile(file.path); } catch {
      try { fs.unlinkSync(file.path); } catch {}
      return res.status(415).json({ success: false, error: 'Fichier illisible.' });
    }

    if (!result) {
      if (file.originalname.match(/\.html?$/i)) continue;
      try { fs.unlinkSync(file.path); } catch {}
      return res.status(415).json({ success: false, error: 'Type de fichier non reconnu.' });
    }

    if (!allowedMimes.has(result.mime)) {
      logger.warn('Fichier rejeté', { detected: result.mime, ip: req.ip });
      try { fs.unlinkSync(file.path); } catch {}
      return res.status(415).json({ success: false, error: `Type non autorisé : ${result.mime}` });
    }
    file.detectedMime = result.mime;
  }
  next();
};

const registerFilesInDB = async (req, _res, next) => {
  if (!req.files?.length) return next();
  const expiresAt = new Date(Date.now() + FILE_TTL_MS).toISOString();
  const userId    = req.user?.id || null;

  try {
    for (const file of req.files) {
      await db.run(
        `INSERT INTO temp_files (id, user_id, original_name, mime_type, size_bytes, path, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [path.basename(file.path), userId, file.originalname,
         file.detectedMime || file.mimetype, file.size, file.path, expiresAt]
      );
    }
    next();
  } catch (err) {
    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    next(err);
  }
};

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msgs = {
      LIMIT_FILE_SIZE:  'Fichier trop volumineux (max 50 MB).',
      LIMIT_FILE_COUNT: 'Trop de fichiers (max 20).',
      LIMIT_UNEXPECTED_FILE: 'Champ inattendu.',
    };
    return res.status(413).json({ success: false, error: msgs[err.code] || 'Erreur upload.' });
  }
  if (err?.status === 415) return res.status(415).json({ success: false, error: err.message });
  next(err);
};

module.exports = { upload, validateFileType, registerFilesInDB, handleMulterError };
