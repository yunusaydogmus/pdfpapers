'use strict';

/* ════════════════════════════════════════════════════════════════
   PDFPAPERS — Serveur Node.js (Express)
   ════════════════════════════════════════════════════════════════ */

// ── 0. Variables d'environnement ──────────────────────────────────
require('dotenv').config();

// Validation critique au démarrage
const REQUIRED_ENV = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].startsWith('CHANGE_ME')) {
    console.error(`\n❌ ERREUR FATALE : ${key} non configuré dans .env\n`);
    process.exit(1);
  }
  if (process.env[key].length < 32) {
    console.error(`\n❌ ERREUR FATALE : ${key} trop court (min 32 chars)\n`);
    process.exit(1);
  }
}

// ── 1. Imports ────────────────────────────────────────────────────
const express     = require('express');
const path        = require('path');
const morgan      = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { PORT, NODE_ENV, IS_PROD } = require('./config/constants');
const { initDB }    = require('./config/db');
const logger        = require('./utils/logger');
const {
  corsMiddleware,
  helmetMiddleware,
  requestId,
  antiHPP,
} = require('./middleware/security');
const { globalLimiter } = require('./middleware/rateLimit');
const { startCleanupScheduler } = require('./services/cleanup');
const { verifyConnection: verifySMTP } = require('./services/mailer');

// ── 2. Initialisation DB ──────────────────────────────────────────
initDB();

// ── 3. Application Express ────────────────────────────────────────
const app = express();

// ── 4. Trust proxy (Vercel, Nginx, etc.) ─────────────────────────
// IMPORTANT : en prod, faire confiance à un seul proxy
app.set('trust proxy', IS_PROD ? 1 : false);

// ── 5. Middleware globaux (ordre important) ───────────────────────

// Sécurité HTTP (Helmet doit être en premier)
app.use(helmetMiddleware);

// ID unique par requête (pour les logs)
app.use(requestId);

// CORS avant les routes
app.use(corsMiddleware);
app.options('*', corsMiddleware); // Pré-vol OPTIONS

// Compression gzip
app.use(compression());

// Parser des cookies httpOnly
app.use(cookieParser());

// Body parsing (avec limites strictes)
app.use(express.json({
  limit: '10kb',        // 10 KB max pour les payloads JSON
  strict: true,         // Rejeter les non-objets/arrays
  verify: (req, res, buf) => {
    // Détecter les body mal formés avant parsing
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({
  extended: false,
  limit: '10kb',
  parameterLimit: 20,
}));

// Anti-HPP
app.use(antiHPP);

// Rate limiting global (fail-safe)
app.use(globalLimiter);

// Logging HTTP (en prod : format combined sans tokens sensibles)
if (IS_PROD) {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === '/health', // Ne pas logger les health checks
  }));
} else {
  app.use(morgan('dev'));
}

// ── 6. Fichiers statiques (frontend) ─────────────────────────────
// Servir le frontend depuis le dossier parent
const FRONTEND_DIR = path.join(__dirname, '..');

app.use(express.static(FRONTEND_DIR, {
  maxAge:      IS_PROD ? '1d' : 0,
  etag:        true,
  lastModified: true,
  // Ne pas exposer les fichiers sensibles
  index: false, // Géré manuellement ci-dessous
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    // Headers de sécurité spécifiques aux assets
    if (filePath.endsWith('.js')) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache'); // HTML jamais caché longtemps
    }
  },
}));

// ── 7. Routes API ─────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/pdf',     require('./routes/pdf'));
app.use('/api/contact', require('./routes/contact'));

// ── 8. Route santé (health check pour Vercel / monitoring) ────────
app.get('/health', (_req, res) => {
  res.json({
    status:      'ok',
    version:     process.env.npm_package_version || '1.0.0',
    environment: NODE_ENV,
    timestamp:   new Date().toISOString(),
  });
});

// ── 9. Routes HTML (SPA fallback) ────────────────────────────────
// Servir les pages HTML du frontend pour les URLs connues
const HTML_ROUTES = {
  '/':         'index.html',
  '/contact':  'contact.html',
  '/outil':    'tool.html',
};

for (const [route, file] of Object.entries(HTML_ROUTES)) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, file));
  });
}

// Outils PDF individuels
app.get('/outils/:tool', (req, res, next) => {
  const toolFile = path.join(FRONTEND_DIR, 'outils', req.params.tool + '.html');
  res.sendFile(toolFile, (err) => {
    if (err) next(); // 404 si l'outil n'existe pas
  });
});

// ── 10. Gestion d'erreurs ─────────────────────────────────────────

// 404 — Route non trouvée
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error:   'Endpoint non trouvé.',
    });
  }
  // HTML 404 pour les routes frontend
  res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Gestionnaire d'erreurs global
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status  = err.status || err.statusCode || 500;
  const isServer = status >= 500;

  if (isServer) {
    logger.error('Erreur serveur', {
      requestId: req.requestId,
      method:    req.method,
      path:      req.path,
      error:     err.message,
      stack:     IS_PROD ? undefined : err.stack,
    });
  }

  // Ne jamais exposer les détails d'erreur en production
  const message = (IS_PROD && isServer)
    ? 'Une erreur interne est survenue.'
    : err.message || 'Erreur interne.';

  return res.status(status).json({
    success: false,
    error:   message,
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });
});

// ── 11. Démarrage ─────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`✅ PDFPapers backend démarré`, {
    port:    PORT,
    env:     NODE_ENV,
    pid:     process.pid,
  });

  // Démarrer le nettoyage automatique des fichiers
  startCleanupScheduler();

  // Vérifier la connexion SMTP
  verifySMTP().catch(() => {}); // Non bloquant
});

// ── 12. Graceful shutdown ─────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`Signal ${signal} reçu — arrêt propre`);

  server.close(() => {
    logger.info('Connexions HTTP fermées');

    // Fermer SQLite proprement
    try {
      const { getDB } = require('./config/db');
      const db = getDB();
      if (db && db.open) db.close();
      logger.info('SQLite fermé');
    } catch { /* silencieux */ }

    logger.info('Arrêt terminé');
    process.exit(0);
  });

  // Forcer l'arrêt après 10 secondes
  setTimeout(() => {
    logger.error('Arrêt forcé après timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── 13. Gestion des erreurs non attrapées ─────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('Exception non attrapée', { error: err.message, stack: err.stack });
  // Redémarrer proprement (process manager comme PM2 le relancera)
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise non gérée', { reason: String(reason) });
  // Ne pas crasher sur une promise rejetée non gérée en prod
  if (!IS_PROD) process.exit(1);
});

module.exports = app; // Pour les tests
