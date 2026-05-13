'use strict';

/**
 * Constantes centralisées — toutes lues depuis process.env.
 * Jamais de valeurs sensibles en dur ici.
 */

const path = require('path');

module.exports = {
  // ── Serveur
  PORT:         parseInt(process.env.PORT || '3001', 10),
  NODE_ENV:     process.env.NODE_ENV || 'development',
  IS_PROD:      process.env.NODE_ENV === 'production',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5500',

  // ── JWT
  JWT_ACCESS_SECRET:  process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY:  process.env.JWT_ACCESS_EXPIRY  || '15m',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '7d',

  // ── Base de données
  // Sur Railway : DB_PATH=/data/pdfpapers.db (volume persistant monté sur /data)
  // En local    : ./data/pdfpapers.db
  DB_PATH: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../data/pdfpapers.db'),

  // ── Fichiers temporaires
  // Sur Railway : UPLOAD_TMP_DIR=/data/tmp (même volume persistant)
  // En local    : ./tmp
  UPLOAD_TMP_DIR: process.env.UPLOAD_TMP_DIR
    ? path.resolve(process.env.UPLOAD_TMP_DIR)
    : path.join(__dirname, '../tmp'),
  FILE_TTL_MS:    parseInt(process.env.FILE_TTL_MS || '7200000', 10), // 2h
  MAX_FILE_SIZE:  parseInt(process.env.MAX_FILE_SIZE || '52428800', 10), // 50 MB

  // ── Rate limiting
  RATE_WINDOW_MS:  parseInt(process.env.RATE_WINDOW_MS  || '900000', 10), // 15 min
  RATE_AUTH_MAX:   parseInt(process.env.RATE_AUTH_MAX   || '10', 10),
  RATE_PDF_MAX:    parseInt(process.env.RATE_PDF_MAX    || '30', 10),
  RATE_CONTACT_MAX:parseInt(process.env.RATE_CONTACT_MAX|| '5',  10),

  // ── Bcrypt
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // ── Email
  SMTP_HOST:        process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT:        parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE:      process.env.SMTP_SECURE === 'true',
  SMTP_USER:        process.env.SMTP_USER || '',
  SMTP_PASS:        process.env.SMTP_PASS || '',
  CONTACT_RECEIVER: process.env.CONTACT_RECEIVER || '',

  // ── Types MIME autorisés par catégorie
  ALLOWED_MIME: {
    pdf:   ['application/pdf'],
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'],
    word:  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'],
    excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'],
    ppt:   ['application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint'],
    html:  ['text/html'],
  },
};
