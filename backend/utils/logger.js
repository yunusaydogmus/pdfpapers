'use strict';

/**
 * Logger Winston structuré.
 * - En production : fichiers rotatifs + console JSON
 * - En développement : console colorée lisible
 * - JAMAIS de données sensibles (passwords, tokens) dans les logs
 */

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf, splat } = format;

const LOGS_DIR = path.join(__dirname, '../logs');
const isProd   = process.env.NODE_ENV === 'production';

// ── Format dev : lisible en console ──────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    let out = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length) out += ' ' + JSON.stringify(meta);
    if (stack) out += '\n' + stack;
    return out;
  })
);

// ── Format prod : JSON structuré ─────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json()
);

// ── Transports ───────────────────────────────────────────────────
const prodTransports = [
  new transports.Console({ format: prodFormat }),
  new DailyRotateFile({
    dirname: LOGS_DIR,
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m',
    format: prodFormat,
    level: 'info',
  }),
  new DailyRotateFile({
    dirname: LOGS_DIR,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    maxSize: '10m',
    format: prodFormat,
    level: 'error',
  }),
];

const devTransports = [
  new transports.Console({ format: devFormat }),
];

const logger = createLogger({
  level: isProd ? 'info' : 'debug',
  transports: isProd ? prodTransports : devTransports,
  // Ne pas crasher sur uncaughtException — on le gère dans server.js
  exitOnError: false,
});

// ── Helpers sécurité : retire les champs sensibles des logs ──────
logger.safe = (obj = {}) => {
  const SENSITIVE = ['password', 'pwd', 'token', 'secret', 'authorization', 'cookie', 'credit_card'];
  const clean = { ...obj };
  SENSITIVE.forEach(k => { if (k in clean) clean[k] = '[REDACTED]'; });
  return clean;
};

module.exports = logger;
